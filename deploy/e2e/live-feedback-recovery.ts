/** Production input/feedback UI + recovery, real Qwen and isolated PostgreSQL.
 * Only native IPC transport is bridged; no model decision or storage receipt is mocked. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect, webkit } from '@playwright/test'
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
const modelId = 'deepseek/deepseek-v4-flash-0731' // Client catalog alias, backed by Qwen in this isolated proof.
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: modelId,
				label: 'Synthetic Qwen proof',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	})
)!
const out = await mkdtemp('/tmp/aven-feedback-recovery-')
const evidence: any = {
	synthetic: true,
	model,
	scope:
		'Browser production feedback controls/admission/recovery, bridged native IPC to real Qwen and SQL; not native authentication or acoustic speech.',
	passed: false,
	checks: [],
	decisions: []
}
const admin = new pg.Pool({ connectionString: databaseUrl }),
	database = `feedback_recovery_${randomUUID().replaceAll('-', '')}`
let pool: pg.Pool | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
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
	const origin = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional pottery guide',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const destination = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional garden club',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const result = await gateway.complete({
		modelId,
		requiredCapabilities: ['text-generation', 'structured-output'],
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: 'Give a fictional beginner two ways to label pottery. One sentence only.'
					}
				]
			}
		],
		output: {
			format: 'json',
			name: 'answer',
			schema: {
				type: 'object',
				additionalProperties: false,
				required: ['text'],
				properties: { text: { type: 'string' } }
			}
		},
		maxOutputTokens: 256,
		temperature: 0
	})
	const answer = (result.output as any).value.text
	assert(answer)
	const reply = await store.append(owner, origin.id, {
		id: randomUUID(),
		contributorKind: 'agent',
		kind: 'message',
		text: answer,
		payload: {}
	})
	let lostAck = true,
		routeCalls = 0,
		feedbackCalls = 0,
		unavailableChecks = 0
	const engine = process.env.UI_BROWSER === 'webkit' ? webkit : chromium
	browser = await engine.launch({ headless: true })
	const page = await browser.newPage({ viewport: { width: 980, height: 760 } })
	await page.exposeFunction('__feedbackTransport', async (command: string, args: any) => {
		if (command === 'input_decision') {
			if (args.request.kind === 'route') routeCalls++
			else feedbackCalls++
			const deadline = args.request.kind === 'route' ? 30 : unavailableChecks-- > 0 ? 1 : undefined
			const r = await gateway.inputDecision(
				args.request,
				owner,
				deadline ? AbortSignal.timeout(deadline) : undefined
			)
			evidence.decisions.push({ request: args.request, result: r })
			return r
		}
		if (command === 'intent_message_get') return store.message(owner, args.messageId)
		if (command === 'intent_append_contribution') {
			assert([origin.id, destination.id].includes(args.intentId))
			const saved = await store.append(owner, args.intentId, args.contribution)
			if (
				lostAck &&
				args.contribution.kind === 'response-feedback' &&
				args.contribution.payload.inferredFrom
			) {
				lostAck = false
				throw Error('Synthetic lost acknowledgement after actual SQL commit')
			}
			return saved
		}
		throw Error(`Unsupported synthetic IPC: ${command}`)
	})
	async function setup() {
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		const saved = await store.message(owner, reply.id)
		await page.evaluate(
			async ({ origin, destination, reply, saved }) => {
				const w = window as any
				w.__TAURI_INTERNALS__ = { invoke: w.__feedbackTransport }
				const { mount } = await import('/@id/svelte')
				const { default: ResponseFeedback } = await import('/src/lib/chat/ResponseFeedback.svelte')
				const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
				const { FeedbackRecovery } = await import('/src/lib/chat/feedback-recovery.ts')
				const { InputInboxController } = await import('/src/lib/chat/input-inbox-controller.ts')
				const { routeInput, assessInputFeedback } = await import('/src/lib/chat/input-routing.ts')
				const { saveFeedbackAssessment } = await import('/src/lib/chat/feedback.ts')
				chatActor.core.hydrate(origin.id, [
					{
						id: reply.id,
						role: 'assistant',
						content: reply.text,
						persisted: true,
						feedback: saved.feedback
					}
				])
				const turn = chatActor.core.thread(origin.id).turns[0]
				const panel = document.createElement('div')
				panel.style.cssText =
					'position:fixed;inset:80px 30px auto;background:white;padding:24px;z-index:99999'
				document.body.append(panel)
				mount(ResponseFeedback, { target: panel, props: { turn, intentId: origin.id } })
				w.feedbackTurn = turn
				w.recovery = new FeedbackRecovery({
					assess: (input: any, check: any, signal: AbortSignal) =>
						assessInputFeedback(input.content, check.recent, check.locale, signal),
					commit: (...args: any[]) => saveFeedbackAssessment(args, turn)
				})
				const intents = [origin, destination].map((i) => ({ id: i.id, title: i.title }))
				const controller = new InputInboxController(
					{
						inspect: async (item: any, signal: AbortSignal) => {
							controller.addCandidates(item.id, intents)
							return {
								intents,
								route: await routeInput(
									item.text,
									{ selectedId: origin.id, intents, recent: item.feedbackCheck.recent },
									signal,
									'fr-FR'
								)
							}
						},
						reply: () => {
							throw Error('No destination reply expected')
						},
						assign: async (item: any, target: any) => {
							await w.__feedbackTransport('intent_append_contribution', {
								intentId: target.id,
								contribution: {
									id: item.id,
									contributorKind: 'human',
									kind: 'message',
									text: item.text,
									payload: { feedbackCheck: item.feedbackCheck }
								}
							})
							w.recovery.enqueue(target.id, {
								id: item.id,
								content: item.text,
								feedbackCheck: item.feedbackCheck
							})
							return target.id
						}
					},
					() => {},
					20
				)
				w.feedbackController = controller
				w.feedbackOrigin = origin.id
				w.feedbackDestination = destination.id
			},
			{ origin, destination, reply, saved }
		)
	}
	await setup()
	const text =
		'Ton explication est bonne, mais ta voix s’est arrêtée au milieu. Je suis vraiment déçu de cette réponse.'
	const inputId = randomUUID(),
		check = {
			commandId: randomUUID(),
			intentId: origin.id,
			locale: 'fr-FR',
			recent: [{ role: 'assistant', content: answer, responseId: reply.id }]
		}
	await page.evaluate(
		({ text, inputId, check }) => {
			const w = window as any
			w.admitted = false
			void w.feedbackController
				.submit(text, w.feedbackOrigin, 0, undefined, inputId, 'fr-FR', check)
				.then(() => (w.admitted = true))
		},
		{ text, inputId, check }
	)
	await page.waitForFunction(() => (window as any).feedbackController.active?.stage === 'failed')
	assert.equal(
		(await store.detail(owner, destination.id)).contributions.some((c) => c.id === inputId),
		false
	)
	await page.evaluate(() => {
		const w = window as any
		w.feedbackController.choose(w.feedbackController.active.id, {
			kind: 'existing',
			id: w.feedbackDestination
		})
	})
	await page.waitForFunction(() => (window as any).admitted)
	assert.equal(
		(await store.message(owner, inputId)).feedbackCheckComplete,
		false,
		'Admission must not wait for optional feedback'
	)
	const controls = page.locator(`[data-response-id="${reply.id}"]`)
	await expect(
		controls.getByRole('button', { name: 'Unhelpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
	await expect(controls).toContainText('Automatically detected')
	const stored = await store.message(owner, reply.id)
	assert.equal(stored.feedback.vote, 'down')
	assert.equal(stored.feedback.inferredFrom, inputId)
	assert.equal(stored.feedback.reason, '')
	assert.equal((await store.message(owner, inputId)).feedbackCheckComplete, true)
	assert.equal(routeCalls, 1)
	assert.equal(feedbackCalls, 1, 'A lost save acknowledgement must not repeat model classification')
	assert.equal(
		Number(
			(await pool.query("SELECT count(*) FROM contributions WHERE kind='response-feedback'"))
				.rows[0].count
		),
		1
	)
	evidence.checks.push(
		'Timeout keeps draft; manual cross-Intent admission proceeds immediately; feedback retains the original reply target',
		'French inferred downvote is visible after lost SQL acknowledgement, exactly once, without another model call'
	)
	await page.screenshot({ path: `${out}/automatic.png` })
	await controls.getByRole('button', { name: 'Unhelpful response', exact: true }).click()
	await expect(
		controls.getByRole('button', { name: 'Unhelpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'false')
	assert.equal((await store.message(owner, reply.id)).feedback.vote, null)
	await controls.getByRole('button', { name: 'Helpful response', exact: true }).click()
	await controls.getByRole('button', { name: 'Add a reason', exact: true }).click()
	await controls
		.getByRole('textbox', { name: 'Reason for response feedback', exact: true })
		.fill('The pottery examples helped; I chose this rating myself.')
	await controls.getByRole('button', { name: 'Save reason', exact: true }).click()
	await expect(controls).toContainText('Edit reason')
	const laterId = randomUUID(),
		laterCheck = { ...check, commandId: randomUUID() }
	await store.append(owner, destination.id, {
		id: laterId,
		contributorKind: 'human',
		kind: 'message',
		text,
		payload: { feedbackCheck: laterCheck }
	})
	await page.evaluate(
		({ laterId, text, laterCheck }) =>
			(window as any).recovery.enqueue((window as any).feedbackDestination, {
				id: laterId,
				content: text,
				feedbackCheck: laterCheck
			}),
		{ laterId, text, laterCheck }
	)
	for (let n = 0; !(await store.message(owner, laterId)).feedbackCheckComplete; n++) {
		assert(n < 150)
		await Bun.sleep(200)
	}
	assert.equal((await store.message(owner, reply.id)).feedback.vote, 'up')
	await setup()
	await expect(
		page
			.locator(`[data-response-id="${reply.id}"]`)
			.getByRole('button', { name: 'Helpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'true')
	assert.equal(
		(await store.message(owner, reply.id)).feedback.reason,
		'The pottery examples helped; I chose this rating myself.'
	)
	evidence.checks.push(
		'Unpress, manual override and inline reason survive delayed conflicting inference and full browser reload'
	)
	await page.screenshot({ path: `${out}/manual-reloaded.png` })
	// Genuine unavailable requests must stay unresolved, then recover from the
	// saved input in a new client lifecycle; they are not neutral votes.
	const recoveringId = randomUUID(),
		recoveringCheck = { ...check, commandId: randomUUID() }
	const neutralText = 'The clay shipment arrived damaged. Can we request a replacement?'
	await store.append(owner, destination.id, {
		id: recoveringId,
		contributorKind: 'human',
		kind: 'message',
		text: neutralText,
		payload: { feedbackCheck: recoveringCheck }
	})
	unavailableChecks = 2
	const callsBefore = feedbackCalls
	await page.evaluate(
		({ recoveringId, neutralText, recoveringCheck }) =>
			(window as any).recovery.enqueue((window as any).feedbackDestination, {
				id: recoveringId,
				content: neutralText,
				feedbackCheck: recoveringCheck
			}),
		{ recoveringId, neutralText, recoveringCheck }
	)
	for (let n = 0; feedbackCalls < callsBefore + 2; n++) {
		assert(n < 100)
		await Bun.sleep(50)
	}
	await Bun.sleep(50)
	assert.equal((await store.message(owner, recoveringId)).feedbackCheckComplete, false)
	const pending = (await store.detail(owner, destination.id)).contributions.find(
		(c) => c.id === recoveringId
	)!
	assert(pending.payload.feedbackCheck && !pending.feedbackCheckComplete)
	await setup()
	await page.evaluate(
		async ({ detail, destinationId }) => {
			const { persistentTurns } = await import('/src/lib/intents/persistent-turns.ts')
			for (const turn of persistentTurns(detail))
				(window as any).recovery.enqueue(destinationId, turn)
		},
		{ detail: await store.detail(owner, destination.id), destinationId: destination.id }
	)
	for (let n = 0; !(await store.message(owner, recoveringId)).feedbackCheckComplete; n++) {
		assert(n < 150)
		await Bun.sleep(200)
	}
	assert.equal(evidence.decisions.at(-1).result.decision, null)
	assert.equal((await store.message(owner, reply.id)).feedback.vote, 'up')
	evidence.checks.push(
		'Two failed real-provider checks remain unresolved; reloaded saved input recovers; neutral completion does not clear a vote'
	)
	// Reuse actual model output/source material for negative authority checks,
	// never invented votes standing in for a semantic-model test.
	const forged = {
		id: randomUUID(),
		contributorKind: 'human' as const,
		kind: 'response-feedback',
		text: null,
		payload: {
			responseId: reply.id,
			vote: 'down',
			reason: '',
			previousFeedbackId: null,
			inferredFrom: inputId,
			sourceQuote: text
		}
	}
	await assert.rejects(store.append(owner, origin.id, forged), /source not found/)
	await assert.rejects(store.append(randomUUID(), origin.id, forged), /not found/)
	await assert.rejects(
		store.append(owner, origin.id, {
			...forged,
			id: check.commandId,
			payload: { ...forged.payload, sourceQuote: 'A phrase absent from the source' }
		}),
		/conflicts/
	)
	evidence.checks.push(
		'Unknown check identity, wrong owner and mutated replay are rejected by SQL service authority'
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(out)
	await browser?.close()
	await pool?.end()
	await admin.query(`DROP DATABASE IF EXISTS ${database}`)
	await admin.end()
}
