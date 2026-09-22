/** Real Qwen + production feedback capture/recovery/controls + isolated SQL.
 * Only native IPC is bridged. Faults delay persistence/acknowledgement, not model output. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import pg from 'pg'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import {
	IntentConflictError,
	IntentNotFoundError,
	IntentStore
} from '../../services/intent-service/src/store'

const base = process.env.LIVE_LLM_BASE_URL,
	databaseUrl = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
assert(base && databaseUrl, 'Use a real model and a disposable PostgreSQL server')
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
const out = await mkdtemp('/tmp/aven-pending-feedback-')
const evidence: any = {
	synthetic: true,
	model,
	passed: false,
	checks: [],
	decisions: [],
	answers: [],
	fingerprints: {},
	scope:
		'Production browser feedback capture, controls and recovery with real Qwen/SQL; not native authentication or acoustic speech.'
}
const complete = gateway.complete.bind(gateway)
gateway.complete = async (...args) => {
	const result = await complete(...args)
	if (args[0].output?.name === 'input_decision') {
		evidence.rawDecisions ??= []
		evidence.rawDecisions.push(result.output)
	}
	return result
}
for (const path of [
	'app/src/lib/chat/feedback-recovery.ts',
	'app/src/lib/chat/feedback.ts',
	'libs/aven-chat-engine/src/response-feedback.ts',
	'libs/aven-intents/src/feedback.ts',
	'libs/aven-llm-client/src/input-decision.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts',
	'services/intent-service/src/store.ts',
	'deploy/e2e/live-pending-feedback.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const admin = new pg.Pool({ connectionString: databaseUrl }),
	database = `pending_feedback_${randomUUID().replaceAll('-', '')}`
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
	const intent = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional community ceramics workshop',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const other = await store.create(owner, {
		id: randomUUID(),
		title: 'Fictional seed library',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	async function answer(prompt: string) {
		const r = await gateway.complete({
			modelId,
			requiredCapabilities: ['text-generation', 'structured-output'],
			messages: [
				{ role: 'user', content: [{ type: 'text', text: `${prompt} One short sentence only.` }] }
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
		const text = (r.output as any).value.text
		assert(text)
		evidence.answers.push({ prompt, text })
		return text as string
	}
	const olderText = await answer('Suggest labels for a fictional seed library.')
	const currentText = await answer(
		'Suggest a shelf organization for a fictional ceramics workshop.'
	)
	const older = await store.append(owner, intent.id, {
		id: randomUUID(),
		contributorKind: 'agent',
		kind: 'message',
		text: olderText,
		payload: {}
	})
	browser = await chromium.launch({ headless: true })
	const page = await browser.newPage({ viewport: { width: 980, height: 760 } })
	let calls = 0,
		misses = 0,
		heldTarget: string | undefined,
		releaseLookup: (() => void) | undefined,
		holding = false
	await page.exposeFunction('__pendingTransport', async (command: string, args: any) => {
		try {
			if (command === 'input_decision') {
				calls++
				const result = await gateway.inputDecision(args.request, owner)
				evidence.decisions.push({ request: args.request, result })
				return result
			}
			if (command === 'intent_message_get') {
				try {
					return await store.message(owner, args.messageId)
				} catch (error) {
					if (error instanceof IntentNotFoundError) {
						misses++
						if (args.messageId === heldTarget) {
							heldTarget = undefined
							holding = true
							await new Promise<void>((resolve) => {
								releaseLookup = resolve
							})
						}
					}
					throw error
				}
			}
			if (command === 'intent_append_contribution')
				return await store.append(owner, args.intentId, args.contribution)
			throw Error(`Unsupported test IPC ${command}`)
		} catch (error) {
			// Match the native transport's JSON error envelope; do not fabricate outcomes.
			if (error instanceof IntentNotFoundError || error instanceof IntentConflictError)
				throw Error(
					JSON.stringify({
						message: error.message,
						status: error instanceof IntentNotFoundError ? 404 : 409,
						retryable: false
					})
				)
			throw error
		}
	})
	async function setup(turns: any[]) {
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(
			async ({ turns, intentId }) => {
				const w = window as any
				w.__TAURI_INTERNALS__ = { invoke: w.__pendingTransport }
				const { mount } = await import('/@id/svelte')
				const { default: ResponseFeedback } = await import('/src/lib/chat/ResponseFeedback.svelte')
				const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
				const { captureFeedbackContext } = await import(
					'/@id/@avenos/chat-engine/response-feedback'
				)
				const { FeedbackRecovery } = await import('/src/lib/chat/feedback-recovery.ts')
				const { assessInputFeedback } = await import('/src/lib/chat/input-routing.ts')
				const { saveFeedbackAssessment } = await import('/src/lib/chat/feedback.ts')
				chatActor.core.hydrate(intentId, turns)
				w.turns = chatActor.core.thread(intentId).turns
				w.capture = () => captureFeedbackContext(w.turns)
				w.commits = []
				w.recovery = new FeedbackRecovery({
					assess: (input: any, check: any, signal: AbortSignal) =>
						assessInputFeedback(input.content, check.recent, check.locale, signal),
					commit: async (...args: any[]) => {
						const result = await saveFeedbackAssessment(
							args,
							w.turns.find((t: any) => t.id === args[3]?.responseId)
						)
						w.commits.push({ id: args[1].id, result: result ?? 'saved' })
						return result
					}
				})
				const panel = document.createElement('div')
				panel.style.cssText =
					'position:fixed;inset:70px 30px auto;background:white;padding:24px;z-index:99999'
				document.body.append(panel)
				for (const turn of w.turns.filter((t: any) => t.role === 'assistant')) {
					const label = document.createElement('p')
					label.textContent = turn.content || 'Response is still being prepared'
					panel.append(label)
					mount(ResponseFeedback, { target: panel, props: { turn, intentId } })
				}
			},
			{ turns, intentId: intent.id }
		)
	}
	async function until(condition: () => Promise<boolean> | boolean) {
		const deadline = Date.now() + 60000
		while (!(await condition())) {
			assert(Date.now() < deadline, 'Timed out waiting for test condition')
			await Bun.sleep(50)
		}
	}
	async function pending(includeOlder = false) {
		const requestId = randomUUID(),
			responseId = randomUUID()
		const text = 'How should the workshop shelves be organized?'
		await store.append(owner, intent.id, {
			id: requestId,
			contributorKind: 'human',
			kind: 'message',
			text,
			payload: {}
		})
		const turns = [
			...(includeOlder
				? [{ id: older.id, role: 'assistant', content: olderText, persisted: true }]
				: []),
			{ id: requestId, role: 'user', content: text, persisted: true },
			{ id: responseId, role: 'assistant', content: '', pending: true, inReplyTo: [requestId] }
		]
		await setup(turns)
		const recent = await page.evaluate(() => (window as any).capture())
		assert.equal(recent.at(-1).responseId, responseId)
		assert.equal(recent.at(-1).pending, true)
		return { requestId, responseId, turns, recent }
	}
	async function input(text: string, recent: any[], locale: string) {
		const id = randomUUID(),
			feedbackCheck = { commandId: randomUUID(), intentId: intent.id, locale, recent }
		await store.append(owner, other.id, {
			id,
			contributorKind: 'human',
			kind: 'message',
			text,
			payload: { feedbackCheck }
		})
		const item = { id, content: text, feedbackCheck }
		await page.evaluate(({ item, intentId }) => (window as any).recovery.enqueue(intentId, item), {
			item,
			intentId: other.id
		})
		return item
	}
	async function publish(p: Awaited<ReturnType<typeof pending>>) {
		await store.append(owner, intent.id, {
			id: p.responseId,
			contributorKind: 'agent',
			kind: 'message',
			text: currentText,
			payload: { inReplyTo: [p.requestId] }
		})
		await page.evaluate(
			({ responseId, text }) => {
				const w = window as any,
					turn = w.turns.find((t: any) => t.id === responseId)
				turn.content = text
				turn.pending = false
				turn.persisted = true
				w.recovery.resume()
			},
			{ responseId: p.responseId, text: currentText }
		)
	}
	// First response: no completed assistant exists to fall back to.
	const first = await pending(),
		firstCalls = calls
	const reaction = await input(
		'Ich warte immer noch auf deine erste Antwort. Das dauert mir viel zu lange!',
		first.recent,
		'de-DE'
	)
	await page.waitForFunction(
		(id) => (window as any).commits.some((c: any) => c.id === id && c.result === 'deferred'),
		reaction.id
	)
	assert.equal(calls, firstCalls + 1)
	assert.equal((await store.message(owner, reaction.id)).feedbackCheckComplete, false)
	assert.equal((await store.message(owner, older.id)).feedback, null)
	// Waiting on one unfinished target must not hold unrelated feedback hostage.
	const neutral = await input(
		'The seed parcel is late. Could you draft a replacement request?',
		[{ role: 'assistant', content: olderText, responseId: older.id }],
		'en-GB'
	)
	await until(async () => (await store.message(owner, neutral.id)).feedbackCheckComplete === true)
	assert.equal(evidence.decisions.at(-1).result.decision, null)
	const afterClassification = calls
	await publish(first)
	await until(async () => (await store.message(owner, reaction.id)).feedbackCheckComplete === true)
	assert.equal(calls, afterClassification, 'Persistence must not repeat classification')
	assert.equal((await store.message(owner, first.responseId)).feedback.vote, 'down')
	const controls = page.locator(`[data-response-id="${first.responseId}"]`)
	await expect(
		controls.getByRole('button', { name: 'Unhelpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'true')
	await controls.getByRole('button', { name: 'Unhelpful response', exact: true }).click()
	await expect(
		controls.getByRole('button', { name: 'Unhelpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'false')
	await controls.getByRole('button', { name: 'Helpful response', exact: true }).click()
	await controls.getByRole('button', { name: 'Add a reason', exact: true }).click()
	await controls
		.getByRole('textbox', { name: 'Reason for response feedback', exact: true })
		.fill('I changed my rating after reading the shelf suggestion.')
	await controls.getByRole('button', { name: 'Save reason', exact: true }).click()
	await expect(controls).toContainText('Edit reason')
	const saved = await store.message(owner, first.responseId)
	await setup([
		{
			id: first.responseId,
			role: 'assistant',
			content: currentText,
			persisted: true,
			feedback: saved.feedback
		}
	])
	await expect(
		page
			.locator(`[data-response-id="${first.responseId}"]`)
			.getByRole('button', { name: 'Helpful response', exact: true })
	).toHaveAttribute('aria-pressed', 'true')
	assert.equal(saved.feedback.reason, 'I changed my rating after reading the shelf suggestion.')
	await page.screenshot({ path: `${out}/manual-after-pending.png` })
	evidence.checks.push(
		'German first-response complaint waits for its exact reply; unrelated English neutral feedback completes; no older vote; no repeated classification; clear/reason/override survive reload'
	)
	// Retain the SQL result of a missing-target read while publication races it.
	const racing = await pending(true)
	heldTarget = racing.responseId
	const race = await input(
		'La respuesta anterior estaba bien; esta nueva está tardando demasiado y no aparece nada.',
		racing.recent,
		'es-ES'
	)
	await until(() => holding)
	const raceCalls = calls
	await publish(racing)
	releaseLookup!()
	holding = false
	await until(async () => (await store.message(owner, race.id)).feedbackCheckComplete === true)
	assert.equal((await store.message(owner, racing.responseId)).feedback.vote, 'down')
	assert.equal((await store.message(owner, older.id)).feedback, null)
	assert.equal(calls, raceCalls)
	evidence.checks.push(
		'Spanish contrast targets the current pending response; persistence during an in-flight 404 does not lose the wakeup or rerun the classifier'
	)
	// Recreate the browser while waiting; recover only from the saved input snapshot.
	const reloaded = await pending(true)
	const recovering = await input(
		'La nouvelle réponse tarde vraiment trop. Ce délai est pénible.',
		reloaded.recent,
		'fr-FR'
	)
	await page.waitForFunction(
		(id) => (window as any).commits.some((c: any) => c.id === id && c.result === 'deferred'),
		recovering.id
	)
	await setup(reloaded.turns)
	const storedInput = (await store.detail(owner, other.id)).contributions.find(
		(c) => c.id === recovering.id
	)!
	await page.evaluate(
		({ c, intentId }) =>
			(window as any).recovery.enqueue(intentId, {
				id: c.id,
				content: c.text,
				feedbackCheck: c.payload.feedbackCheck
			}),
		{ c: storedInput, intentId: other.id }
	)
	await page.waitForFunction(
		(id) => (window as any).commits.some((c: any) => c.id === id && c.result === 'deferred'),
		recovering.id
	)
	await publish(reloaded)
	await until(
		async () => (await store.message(owner, recovering.id)).feedbackCheckComplete === true
	)
	assert.equal((await store.message(owner, reloaded.responseId)).feedback.vote, 'down')
	evidence.checks.push(
		'French pending reaction survives a full browser reload using its saved target/request anchor'
	)
	// Genuine no-vote and explicit older-target controls with an unfinished reply present.
	const contextual = await pending(true)
	const refined = await input(
		'Please include a shelf for donated supplies in the answer you are preparing.',
		contextual.recent,
		'en-GB'
	)
	await until(async () => (await store.message(owner, refined.id)).feedbackCheckComplete === true)
	assert.equal(evidence.decisions.at(-1).result.decision, null)
	const olderReaction = await input(
		'The earlier seed-label suggestion was genuinely useful. I am not rating the unfinished shelf answer.',
		contextual.recent,
		'en-GB'
	)
	await until(
		async () => (await store.message(owner, olderReaction.id)).feedbackCheckComplete === true
	)
	assert.equal((await store.message(owner, older.id)).feedback.vote, 'up')
	evidence.checks.push(
		'Pending clarification stays neutral; an explicit earlier-answer evaluation still targets that earlier answer'
	)
	// Chronology/authority negatives reuse an actual Qwen judgment, not a mock vote.
	const judgment = evidence.decisions.find(
		(d: any) => d.result.decision?.responseId === first.responseId
	).result.decision
	for (const flaw of [
		'missing-pending',
		'wrong-request',
		'wrong-intent',
		'future-request',
		'answer-without-anchor'
	]) {
		const targetId = randomUUID(),
			requestId = randomUUID(),
			sourceId = randomUUID(),
			commandId = randomUUID()
		if (flaw !== 'future-request')
			await store.append(owner, flaw === 'wrong-intent' ? other.id : intent.id, {
				id: requestId,
				contributorKind: 'human',
				kind: 'message',
				text: 'Suggest a ceramics storage layout.',
				payload: {}
			})
		const recent = [
			{
				role: 'assistant',
				content: '',
				responseId: targetId,
				...(flaw === 'missing-pending'
					? {}
					: { pending: true, requestId: flaw === 'wrong-request' ? randomUUID() : requestId })
			}
		]
		await store.append(owner, other.id, {
			id: sourceId,
			contributorKind: 'human',
			kind: 'message',
			text: reaction.content,
			payload: { feedbackCheck: { commandId, intentId: intent.id, locale: 'de-DE', recent } }
		})
		if (flaw === 'future-request')
			await store.append(owner, intent.id, {
				id: requestId,
				contributorKind: 'human',
				kind: 'message',
				text: 'Suggest a ceramics storage layout.',
				payload: {}
			})
		await store.append(owner, intent.id, {
			id: targetId,
			contributorKind: 'agent',
			kind: 'message',
			text: currentText,
			payload: flaw === 'answer-without-anchor' ? {} : { inReplyTo: [requestId] }
		})
		await assert.rejects(
			store.append(owner, intent.id, {
				id: commandId,
				contributorKind: 'human',
				kind: 'response-feedback',
				text: null,
				payload: {
					responseId: targetId,
					vote: judgment.vote,
					reason: '',
					previousFeedbackId: null,
					inferredFrom: sourceId,
					sourceQuote: judgment.quote
				}
			}),
			/Feedback source not found/
		)
	}
	evidence.checks.push(
		'SQL rejects a future response lacking the captured pending marker, wrong/missing request, cross-Intent request, request admitted after feedback, and answer lacking inReplyTo'
	)
	evidence.calls = calls
	evidence.missingTargetReads = misses
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
