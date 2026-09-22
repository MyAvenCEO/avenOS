/** Production ChatThreads admission/navigation with real Qwen routing and streamed
 * answers, isolated SQL, and a controlled persistence delay. No customer content. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import pg from 'pg'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { IntentStore } from '../../services/intent-service/src/store'

const base = process.env.LIVE_LLM_BASE_URL,
	databaseUrl = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
assert(base && databaseUrl)
const models = await fetch(`${base}/models`).then((r) => r.json())
const model = models.data.find((m: any) => /qwen/i.test(m.id))?.id
assert(model)
const modelId = 'deepseek/deepseek-v4-flash-0731'
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: modelId,
				label: 'Navigation proof',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	})
)!
const out = await mkdtemp('/tmp/aven-input-navigation-')
const evidence: any = {
	synthetic: true,
	model,
	passed: false,
	checks: [],
	decisions: [],
	replies: [],
	fingerprints: {},
	scope:
		'Production browser ChatThreads with real routing/streaming Qwen and SQL; not native authentication or visual/voice qualification.'
}
for (const path of [
	'app/src/lib/chat/threads.svelte.ts',
	'app/src/lib/chat/input-inbox-controller.ts',
	'app/src/lib/chat/input-capture.ts',
	'libs/aven-chat-engine/src/source-context.ts',
	'libs/aven-chat-engine/src/input-admission.ts',
	'libs/aven-llm-client/src/input-decision.ts',
	'deploy/e2e/live-input-navigation.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const admin = new pg.Pool({ connectionString: databaseUrl }),
	database = `navigation_${randomUUID().replaceAll('-', '')}`
let pool: pg.Pool | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const testToken = randomUUID()
const server = Bun.serve({
	hostname: '127.0.0.1',
	port: 0,
	idleTimeout: 255,
	fetch: async (request) => {
		const headers = {
			'access-control-allow-origin': 'http://127.0.0.1:1457',
			'access-control-allow-headers': 'authorization,content-type'
		}
		if (request.method === 'OPTIONS') return new Response(null, { headers })
		if (request.headers.get('authorization') !== `Bearer ${testToken}`)
			return new Response(null, { status: 403, headers })
		try {
			const result = await gateway.openAiChatCompletion(await request.json(), request.signal, {
				owner: 'synthetic-navigation'
			})
			return new Response(result.body, {
				status: result.status,
				headers: { ...Object.fromEntries(result.headers), ...headers }
			})
		} catch (error) {
			return Response.json({ error: String(error) }, { status: 502, headers })
		}
	}
})
try {
	await admin.query(`CREATE DATABASE ${database}`)
	const url = new URL(databaseUrl)
	url.pathname = `/${database}`
	pool = new pg.Pool({
		connectionString: url.toString(),
		options: '-c search_path=aven_intents,public'
	})
	await pool.query('CREATE SCHEMA aven_intents')
	await pool.query(
		await readFile(
			new URL(
				'../../services/platform-provisioner/components/intents/0001_intents.sql',
				import.meta.url
			),
			'utf8'
		)
	)
	const store = new IntentStore(pool),
		owner = randomUUID()
	const a = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional Lantern Workshop',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const b = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional Herb Circle',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const c = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional Puppet Rehearsal',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const destinations = [a, b, c]
	let hold = false,
		blocked = false,
		release: (() => void) | undefined
	browser = await chromium.launch({ headless: true })
	const page = await browser.newPage()
	await page.exposeFunction('__navigationTransport', async (command: string, args: any) => {
		if (command === 'input_decision') {
			const result = await gateway.inputDecision(args.request, owner)
			evidence.decisions.push({ request: args.request, result })
			return result
		}
		if (command === 'assign') {
			if (args.target.kind === 'new') {
				const created = await store.create(owner, {
					id: args.id,
					title: args.target.title,
					intentType: 'test',
					sourceLabel: 'Chat',
					deadline: null
				})
				destinations.push(created)
				return { session: created.id }
			}
			return { session: (await store.detail(owner, args.target.id)).id }
		}
		if (command === 'persist') {
			if (hold && args.turn.role === 'user') {
				hold = false
				blocked = true
				await new Promise<void>((resolve) => {
					release = resolve
				})
			}
			return store.append(owner, args.intentId, {
				id: args.turn.id,
				contributorKind: args.turn.role === 'user' ? 'human' : 'agent',
				kind: 'message',
				text: args.turn.content,
				payload: args.payload
			})
		}
		throw Error(`Unsupported test IPC ${command}`)
	})
	await page.goto('http://127.0.0.1:1457/dashboard')
	await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
	await page.evaluate(
		async ({ destinations, origin, endpoint, testToken }) => {
			const w = window as any
			w.__TAURI_INTERNALS__ = { invoke: w.__navigationTransport }
			const { ChatThreads } = await import('/src/lib/chat/threads.svelte.ts')
			const { createGatewayModelStream } = await import('/@id/@avenos/chat-engine/gateway')
			const { openAiGatewayRequest } = await import('/src/lib/chat/redpill.ts')
			const { turnPayload } = await import('/@id/@avenos/chat-engine/turn-payload')
			const stream = createGatewayModelStream({
				request: openAiGatewayRequest,
				open: async (request: any, signal: AbortSignal) => {
					const response = await fetch(endpoint, {
						method: 'POST',
						signal,
						headers: { 'content-type': 'application/json', authorization: `Bearer ${testToken}` },
						body: JSON.stringify(request)
					})
					if (!response.ok || !response.body)
						throw Error(`Real gateway stream failed: ${response.status}`)
					return (async function* () {
						const reader = response.body!.getReader(),
							decoder = new TextDecoder()
						try {
							for (;;) {
								const part = await reader.read()
								if (part.done) break
								yield decoder.decode(part.value, { stream: true })
							}
						} finally {
							await reader.cancel()
						}
					})()
				}
			})
			w.threads = new ChatThreads(
				{},
				() => ({
					specs: [],
					run: () => {
						throw Error('No action tools in this navigation proof')
					}
				}),
				stream
			)
			w.selected = origin
			w.selectionEvents = []
			w.saved = []
			w.persistenceErrors = []
			w.threads.onSelect = (id: string) => {
				w.selected = id
				w.selectionEvents.push(id)
			}
			w.threads.inputCatalog = async () =>
				destinations.map((d: any) => ({ id: d.id, title: d.title }))
			w.threads.assignInput = (target: any, id: string) =>
				w.__navigationTransport('assign', { target, id })
			w.threads.context = () =>
				'Fictional design conversation. Answer a brief welcome or suggestion; no saved-task operations were requested.'
			w.threads.persistInput = async (intentId: string, turn: any) => {
				await w.__navigationTransport('persist', {
					intentId,
					turn: { id: turn.id, role: turn.role, content: turn.content },
					payload: turnPayload(turn)
				})
				turn.persisted = true
			}
			w.threads.onExchange = (intentId: string, _user: any, answer: any) => {
				void w
					.__navigationTransport('persist', {
						intentId,
						turn: { id: answer.id, role: answer.role, content: answer.content },
						payload: turnPayload(answer)
					})
					.then(
						() => {
							answer.persisted = true
							w.saved.push(answer.id)
						},
						(error: unknown) => w.persistenceErrors.push(String(error))
					)
			}
			w.select = (id: string) => {
				w.selected = id
				w.threads.use(id)
			}
			w.select(origin)
		},
		{ destinations, origin: a.id, endpoint: `http://127.0.0.1:${server.port}/chat`, testToken }
	)
	async function start(text: string) {
		await page.evaluate((text) => {
			const w = window as any
			w.done = false
			w.failure = null
			void w.threads.send(text).then(
				() => (w.done = true),
				(e: unknown) => {
					w.failure = String(e)
					w.done = true
				}
			)
		}, text)
	}
	async function finish() {
		await page.waitForFunction(() => (window as any).done, undefined, { timeout: 180000 })
		const state = await page.evaluate(() => {
			const w = window as any
			return {
				failure: w.failure,
				selected: w.selected,
				session: w.threads.session,
				turns: w.threads.turns.map((t: any) => ({
					id: t.id,
					role: t.role,
					content: t.content,
					pending: t.pending,
					failed: t.failed
				}))
			}
		})
		assert.equal(state.failure, null)
		evidence.replies.push(state)
		return state
	}
	async function waitBlocked() {
		const deadline = Date.now() + 15000
		while (!blocked) {
			const failure = await page.evaluate(
				() => (window as any).threads.input.items.find((i: any) => i.stage === 'failed')?.error
			)
			assert(!failure, failure)
			assert(Date.now() < deadline, 'Did not reach input persistence')
			await Bun.sleep(50)
		}
	}
	// Delay the actual admitted write, not Qwen's decision.
	hold = true
	await start('Switch to Fictional Herb Circle and suggest a friendly greeting for its members.')
	await waitBlocked()
	assert.equal(
		await page.evaluate(() => (window as any).selected),
		a.id,
		'No premature selection before admission'
	)
	release!()
	blocked = false
	let result = await finish()
	assert.equal(result.selected, b.id)
	assert.equal(result.session, b.id)
	assert.equal(
		result.turns.filter((t: any) => t.role === 'assistant' && !t.pending && !t.failed).length,
		1
	)
	evidence.checks.push(
		'Explicit existing destination selects its actual view only after successful persistence'
	)
	await page.evaluate((id) => (window as any).select(id), a.id)
	hold = true
	await start('Wechsle bitte zu Fictional Herb Circle. Welche Begrüßung passt dort?')
	await waitBlocked()
	await page.evaluate((id) => (window as any).select(id), c.id)
	release!()
	blocked = false
	result = await finish()
	assert.equal(result.selected, c.id)
	assert.equal(result.session, c.id)
	const destinationTurns = await page.evaluate(
		(id) =>
			(window as any).threads.thread(id).turns.map((t: any) => ({
				id: t.id,
				role: t.role,
				content: t.content,
				pending: t.pending,
				failed: t.failed
			})),
		b.id
	)
	assert.equal(
		destinationTurns.filter((t: any) => t.role === 'assistant' && !t.pending && !t.failed).length,
		2
	)
	evidence.replies.push({ destinationTurns })
	evidence.checks.push(
		'Intervening manual view change is preserved while the accepted destination continues independently'
	)
	await start(
		'Start a new Intent called Fictional Paper Lanterns. Let us discuss decorative shapes there.'
	)
	result = await finish()
	assert(![a.id, b.id, c.id].includes(result.selected))
	assert.equal(result.session, result.selected)
	const created = await store.detail(owner, result.selected)
	assert.equal(created.title, 'Fictional Paper Lanterns')
	evidence.checks.push('Explicit new destination still creates exactly one Intent and selects it')
	await page.waitForFunction(() => (window as any).saved.length === 3)
	await page.evaluate((id) => (window as any).select(id), a.id)
	await start(
		'For this fictional workshop poster, I choose a teal owl emblem and the slogan "Make small wonders". Briefly describe the poster using these choices. Do not save anything.'
	)
	result = await finish()
	assert.match(result.turns.at(-1)!.content, /owl/i)
	await page.waitForFunction(() => (window as any).saved.length === 4)
	await start(
		'Create a new Intent called Fictional Poster Printing. Carry over the poster design we just discussed and tell me which emblem, colour and slogan we chose. Only answer here; no stored task.'
	)
	result = await finish()
	assert.notEqual(result.selected, a.id)
	assert.match(result.turns.at(-1)!.content, /teal/i)
	assert.match(result.turns.at(-1)!.content, /owl/i)
	assert.match(result.turns.at(-1)!.content, /Make small wonders/i)
	await page.waitForFunction(() => (window as any).saved.length === 5)
	const routed = await store.detail(owner, result.selected)
	const routedUser = routed.contributions.find((c) => c.contributorKind === 'human')!
	assert.equal((routedUser.payload.inputAdmission as any).sourceContext.intentId, a.id)
	assert.equal((routedUser.payload.inputAdmission as any).sourceContext.messages.length, 2)
	evidence.checks.push(
		'Cross-Intent reference carries its bounded source dialogue, including a real-Qwen answer, into the actual admitted message'
	)
	// Rebuild from SQL only: no in-memory origin thread or transient submission context.
	await page.evaluate(
		async ({ intentId, contributions }) => {
			const w = window as any
			const { readInputAdmission } = await import('/@id/@avenos/chat-engine/input-admission')
			w.threads.resetForEnvironment()
			w.threads.hydrate(
				intentId,
				contributions
					.filter((c: any) => c.kind === 'message')
					.map((c: any) => ({
						id: c.id,
						role: c.contributorKind === 'human' ? 'user' : 'assistant',
						content: c.text,
						inputAdmission: readInputAdmission(c.payload.inputAdmission),
						persisted: true
					}))
			)
			w.threads.inputCatalog = async () => [{ id: intentId, title: 'Fictional Poster Printing' }]
			w.select(intentId)
		},
		{ intentId: result.selected, contributions: routed.contributions }
	)
	await start(
		'Rappelle-moi seulement la couleur et l’animal du motif choisi, en français. Ne crée rien.'
	)
	result = await finish()
	assert.match(result.turns.at(-1)!.content, /hibou|chouette/i)
	assert.match(result.turns.at(-1)!.content, /sarcelle|bleu[- ]?vert|turquoise|teal/i)
	await page.waitForFunction(() => (window as any).saved.length === 6)
	evidence.checks.push(
		'SQL-only reload retains the admitted origin excerpt and answers a French continuation without rereading or changing the origin'
	)
	// Capture before the asynchronous router starts, then reconstruct with a
	// different visible screen. Only the persistence boundary is paused; the
	// resumed route and answer are actual Qwen calls.
	const capturedArtifact = randomUUID(),
		laterArtifact = randomUUID()
	await page.evaluate(
		async ({ capturedArtifact, laterArtifact }) => {
			const w = window as any
			const { captureInputContext } = await import('/src/lib/chat/input-capture.ts')
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			let snapshot: any[] = []
			w.threads.captureInputContext = () =>
				captureInputContext(
					{
						prompt:
							'\nCaptured display draft: a violet fox illustration. This is an unsaved suggestion, not a completed file.\n',
						references: [{ kind: 'artifact', id: capturedArtifact }]
					},
					'Pacific/Auckland'
				)
			w.threads.input.setPersistence(async (items: any[]) => {
				snapshot = JSON.parse(JSON.stringify(items))
				await held
			})
			void w.threads.send(
				'For the display draft I was looking at when submitting, what animal and colour did it show? Only report that suggestion; do not save or create anything.'
			)
			await Promise.resolve()
			await Promise.resolve()
			if (snapshot.length !== 1) throw Error('Capture did not reach the private save boundary')
			w.threads.resetForEnvironment()
			w.threads.captureInputContext = () =>
				captureInputContext(
					{
						prompt: '\nDifferent screen: an orange badger illustration.\n',
						references: [{ kind: 'artifact', id: laterArtifact }]
					},
					'America/Vancouver'
				)
			w.threads.input.setPersistence(async () => {})
			w.threads.input.restore(snapshot)
			release()
			w.threads.input.retry(snapshot[0].id)
			w.captureBeforeRecovery = snapshot[0].capture
		},
		{ capturedArtifact, laterArtifact }
	)
	await page.waitForFunction(() => (window as any).saved.length === 7, undefined, {
		timeout: 180000
	})
	const recoveredScreen = await page.evaluate(() => {
		const w = window as any
		return {
			capture: w.captureBeforeRecovery,
			turns: w.threads
				.thread(w.selected)
				.turns.map((t: any) => ({ role: t.role, content: t.content }))
		}
	})
	assert.equal(recoveredScreen.capture.timezone, 'Pacific/Auckland')
	assert.deepEqual(recoveredScreen.capture.references, [{ kind: 'artifact', id: capturedArtifact }])
	const savedAnswers = await pool.query(
		"SELECT text FROM contributions WHERE contributor_kind='agent' AND kind='message' ORDER BY created_at DESC LIMIT 1"
	)
	const recoveredAnswer = savedAnswers.rows[0].text
	assert.match(recoveredAnswer, /violet|purple/i)
	assert.match(recoveredAnswer, /fox/i)
	assert.doesNotMatch(recoveredAnswer, /badger|orange/i)
	evidence.replies.push({ recoveredScreen, recoveredAnswer })
	evidence.checks.push(
		'Recovered pending input retains its original display excerpt, artifact identity and timezone instead of the newly selected screen'
	)
	assert.deepEqual(await page.evaluate(() => (window as any).persistenceErrors), [])
	assert.equal(
		Number(
			(
				await pool.query(
					"SELECT count(*) FROM contributions WHERE contributor_kind='human' AND kind='message'"
				)
			).rows[0].count
		),
		7
	)
	assert.equal(
		Number(
			(
				await pool.query(
					"SELECT count(*) FROM contributions WHERE contributor_kind='agent' AND kind='message'"
				)
			).rows[0].count
		),
		7
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(out)
	await browser?.close()
	server.stop(true)
	await pool?.end()
	await admin.query(`DROP DATABASE IF EXISTS ${database}`)
	await admin.end()
}
