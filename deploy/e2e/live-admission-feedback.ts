/** Real Qwen, signed facade admission and isolated customer SQL. No customer fixtures. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import {
	automaticFeedbackCommand,
	feedbackCommand,
	type ResponseFeedback
} from '@avenos/chat-engine/response-feedback'
import { admissionDigest, type InputAdmission } from '@avenos/intents/admission'
import { readFeedbackCheck } from '@avenos/intents/feedback'
import { turnPageSchema } from '@avenos/intents/turn-status'
import type { InputFeedback } from '../../libs/aven-llm-client/src/input-decision'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'

const database = process.env.TEST_TASK_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL,
	upstream = process.env.LIVE_LLM_MODEL
assert(database && base && upstream && /qwen/i.test(upstream))
const directory = await mkdtemp('/tmp/aven-admission-feedback-')
const evidence: any = {
	synthetic: true,
	passed: false,
	upstream,
	cases: [],
	fingerprints: {},
	scope:
		'Actual Qwen answer/feedback, signed HTTP admission and feedback receipts in isolated PostgreSQL. No native UI or background feedback worker claim.'
}
for (const path of [
	'libs/aven-intents/src/feedback.ts',
	'libs/aven-intents/src/admission.ts',
	'services/intent-service/src/store.ts',
	'libs/aven-llm-client/src/input-decision.ts',
	'deploy/e2e/live-admission-feedback.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'feedback-qwen',
				label: 'Qwen admission proof',
				baseUrl: base,
				upstreamModel: upstream,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	})
)!
const owner = randomUUID(),
	origin = randomUUID()
let f: Awaited<ReturnType<typeof taskServiceFixture>> | undefined
try {
	f = await taskServiceFixture(database, owner, origin)
	const complete = await gateway.complete({
		modelId: 'feedback-qwen',
		requiredCapabilities: ['text-generation'],
		instructions:
			'Answer briefly. This is a fictional planning discussion; do not claim to perform actions.',
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: 'Suggest two labels for organizing a community kite workshop. One sentence.'
					}
				]
			}
		],
		output: { format: 'text' },
		maxOutputTokens: 256,
		temperature: 0
	})
	assert.equal(complete.output.format, 'text')
	const answer = (complete.output as { format: 'text'; text: string }).text
	assert(answer.trim())
	evidence.answer = answer
	const reply = await f.store.append(owner, origin, {
		id: randomUUID(),
		contributorKind: 'agent',
		kind: 'message',
		text: answer,
		payload: {}
	})
	const cases: [string, string, 'up' | 'down' | null][] = [
		['fr-FR', 'Cette réponse ne m’aide pas du tout, elle est beaucoup trop vague.', 'down'],
		['es-ES', 'Tu explicación me resultó muy útil, ahora lo entiendo.', 'up'],
		['de-DE', 'Welche Materialien eignen sich für die Etiketten?', null],
		['ja-JP', 'とても分かりやすい回答でした。役に立ちました。', 'up']
	]
	let lastCheck: NonNullable<ReturnType<typeof readFeedbackCheck>> | undefined,
		lastInput: InputAdmission | undefined,
		lastDecision: InputFeedback | null = null
	for (const [locale, text, expected] of cases) {
		const feedbackCheck = {
			commandId: randomUUID(),
			intentId: origin,
			locale,
			recent: [{ role: 'assistant' as const, content: answer.slice(0, 1200), responseId: reply.id }]
		}
		// The user deliberately chooses a different destination. Feedback keeps its captured origin.
		const input = {
			inputId: randomUUID(),
			revision: 1,
			text,
			originalText: text,
			corrections: [],
			target: { kind: 'new' as const, title: 'Invented kite material discussion' },
			locale,
			timezone: 'Europe/Paris',
			capturedAt: new Date().toISOString(),
			decisionId: randomUUID(),
			confirmed: true,
			references: [],
			feedbackCheck
		}
		const response = await f.admission.request('/input', input)
		const admitted = await response.json()
		evidence.cases.push({ locale, text, expected, admissionStatus: response.status })
		assert.equal(
			response.status,
			201,
			`Feedback scope must survive admission: ${JSON.stringify(admitted)}`
		)
		assert.notEqual(admitted.intentId, origin)
		assert.notEqual(
			admitted.contributionId,
			input.inputId,
			'Feedback must use the committed contribution identity, not the local input ID.'
		)
		// Simulate a lost acknowledgement by resolving/replaying exactly the same accepted material.
		assert.deepEqual(await f.admission.admit(input), admitted)
		const saved = await f.store.message(owner, admitted.contributionId)
		const detail: { contributions: { id: string; payload: Record<string, unknown> }[] } = await (
			await f.admission.request(`/${admitted.intentId}`)
		).json()
		const payload: Record<string, unknown> | undefined = detail.contributions.find(
			(c) => c.id === admitted.contributionId
		)?.payload
		assert.deepEqual(payload?.feedbackCheck, feedbackCheck)
		assert(payload)
		const recovered = readFeedbackCheck(payload.feedbackCheck)
		assert(recovered)
		const { decision } = await gateway.inputDecision(
			{
				kind: 'feedback',
				modelId: 'feedback-qwen',
				text: saved.content,
				locale: recovered.locale,
				recent: recovered.recent
			},
			owner
		)
		const assessed = decision as InputFeedback | null
		Object.assign(evidence.cases.at(-1), { assessed })
		assert.equal(assessed?.vote ?? null, expected)
		if (assessed) assert.equal(assessed.responseId, reply.id)
		const command: {
			id: string
			contributorKind: 'human'
			kind: string
			text: null
			payload: Record<string, unknown>
		} = assessed
			? automaticFeedbackCommand(
					{ ...assessed, intentId: recovered.intentId, commandId: recovered.commandId },
					admitted.contributionId,
					(await f.store.message(owner, reply.id)).feedback,
					undefined,
					assessed.quote
				)!
			: {
					id: recovered.commandId,
					contributorKind: 'human',
					kind: 'feedback-assessment',
					text: null,
					payload: { sourceId: admitted.contributionId }
				}
		const target = assessed ? recovered.intentId : admitted.intentId
		const persisted = await f.admission.request(`/${target}`, command)
		assert.equal(persisted.status, 201, JSON.stringify(await persisted.clone().json()))
		assert.deepEqual(
			await (await f.admission.request(`/${target}`, command)).json(),
			await persisted.json()
		)
		assert.equal(
			(await f.store.message(owner, admitted.contributionId)).feedbackCheckComplete,
			true
		)
		if (assessed) {
			const vote: ResponseFeedback = (await f.store.message(owner, reply.id)).feedback
			assert.equal(vote.inferredFrom, admitted.contributionId)
			assert.equal(vote.vote, expected)
			assert.equal(vote.reason, '')
		}
		assert.notEqual(
			await admissionDigest(input),
			await admissionDigest({
				...input,
				feedbackCheck: { ...feedbackCheck, commandId: randomUUID() }
			})
		)
		assert.equal(
			(
				await f.admission.request('/input', {
					...input,
					feedbackCheck: { ...feedbackCheck, commandId: randomUUID() }
				})
			).status,
			409,
			'An accepted feedback scope cannot be changed on replay.'
		)
		lastCheck = feedbackCheck
		lastInput = input
		lastDecision = assessed
	}
	assert(lastCheck && lastInput && lastDecision)
	const current = (await f.store.message(owner, reply.id)).feedback
	await f.store.append(owner, origin, feedbackCommand(reply.id, current, null, ''))
	const clear = (await f.store.message(owner, reply.id)).feedback
	assert.equal(clear.vote, null)
	assert.equal(clear.inferredFrom, undefined)
	const afterClear = {
		...lastInput,
		inputId: randomUUID(),
		decisionId: randomUUID(),
		feedbackCheck: { ...lastCheck, commandId: randomUUID() }
	}
	const acceptedAfterClear = await f.admission.admit(afterClear)
	const command = automaticFeedbackCommand(
		{ ...lastDecision, intentId: origin, commandId: afterClear.feedbackCheck.commandId },
		acceptedAfterClear.contributionId,
		null,
		undefined,
		lastDecision.quote
	)!
	assert.equal((await f.admission.request(`/${origin}`, command)).status, 409)
	assert.equal((await f.store.message(owner, reply.id)).feedback.vote, null)
	// A reaction to the unfinished response is persisted before that response.
	// It must wait for its exact request/reply pair, never rate the older answer.
	const question = await f.admission.admit({
		...lastInput,
		inputId: randomUUID(),
		decisionId: randomUUID(),
		target: { kind: 'existing', id: origin },
		text: 'Suggest two labels for organizing a community kite workshop.',
		originalText: 'Suggest two labels for organizing a community kite workshop.',
		feedbackCheck: undefined
	})
	const pendingTurn = turnPageSchema
		.parse(await (await f.admission.request(`/${origin}/turns`)).json())
		.turns.find((turn) => turn.turnId === question.turnId)!
	assert.equal(pendingTurn.state, 'queued')
	assert.equal(pendingTurn.outputContributionId, null)
	const pendingResponse = pendingTurn.responseId
	const pendingCheck = {
		...lastCheck,
		commandId: randomUUID(),
		recent: [
			{
				role: 'assistant' as const,
				content: '',
				responseId: pendingResponse,
				pending: true as const,
				requestId: question.contributionId
			}
		]
	}
	const pendingInput = {
		...lastInput,
		inputId: randomUUID(),
		decisionId: randomUUID(),
		text: 'Your response has been stuck for ages. This waiting experience is really frustrating.',
		originalText:
			'Your response has been stuck for ages. This waiting experience is really frustrating.',
		locale: 'en-GB',
		feedbackCheck: pendingCheck
	}
	const pendingAdmission = await f.admission.admit(pendingInput)
	const pendingDecision = (
		await gateway.inputDecision(
			{
				kind: 'feedback',
				modelId: 'feedback-qwen',
				text: pendingInput.text,
				locale: 'en-GB',
				recent: pendingCheck.recent
			},
			owner
		)
	).decision as InputFeedback | null
	assert.equal(pendingDecision?.responseId, pendingResponse)
	assert.equal(pendingDecision?.vote, 'down')
	const pendingCommand = automaticFeedbackCommand(
		{
			...pendingDecision!,
			intentId: origin,
			commandId: pendingCheck.commandId
		},
		pendingAdmission.contributionId,
		null,
		undefined,
		pendingDecision!.quote
	)!
	assert.equal((await f.admission.request(`/${origin}`, pendingCommand)).status, 404)
	assert.equal(
		(await f.store.message(owner, pendingAdmission.contributionId)).feedbackCheckComplete,
		false
	)
	await f.store.append(owner, origin, {
		id: pendingResponse,
		contributorKind: 'agent',
		kind: 'message',
		text: answer,
		payload: { inReplyTo: [question.contributionId] }
	})
	assert.equal((await f.admission.request(`/${origin}`, pendingCommand)).status, 201)
	assert.equal((await f.store.message(owner, pendingResponse)).feedback.vote, 'down')
	assert.equal((await f.store.message(owner, reply.id)).feedback.vote, null)
	assert.equal(
		(await f.store.message(owner, pendingAdmission.contributionId)).feedbackCheckComplete,
		true
	)
	evidence.pendingResponse = {
		exactTarget: true,
		deferredUntilSaved: true,
		olderAnswerUntouched: true,
		decision: pendingDecision
	}
	// Closed boundaries must reject authority, unlimited snapshots and invalid pending identities.
	for (const feedbackCheck of [
		{ ...lastCheck, accessToken: 'not-authority' },
		{ ...lastCheck, recent: Array.from({ length: 7 }, () => lastCheck.recent[0]) },
		{ ...lastCheck, recent: [{ ...lastCheck.recent[0], pending: true }] }
	])
		assert.equal(
			(
				await f.admission.request('/input', {
					...lastInput,
					inputId: randomUUID(),
					feedbackCheck
				})
			).status,
			400
		)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await f?.close()
	await writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(JSON.stringify({ evidence: `${directory}/evidence.json`, passed: evidence.passed }))
}
