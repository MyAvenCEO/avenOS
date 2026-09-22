/** Synthetic tasks, real Qwen, real PostgreSQL, and the shared production Actor/Chat engine. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Turn } from '@avenos/chat-engine/chat'
import { executeDurableChat } from '@avenos/chat-engine/durable'
import { journalDigest, type TurnJournal } from '@avenos/chat-engine/journal'
import type { ModelStream } from '@avenos/chat-engine/model'
import { streamEvents } from '@avenos/chat-engine/stream'
import { callsFromPayload, turnPayload } from '@avenos/chat-engine/turn-payload'
import { createTaskActor, taskManifest } from '@avenos/productivity/actor'
import { TaskRequestError } from '@avenos/productivity/remote'
import { type TaskCause, type TaskRepository, taskCommandSchema } from '@avenos/productivity/tasks'
import { TrialTaskRepository } from '@avenos/productivity/trial'
import type pg from 'pg'
import { verifyWorkGrant } from '../../libs/aven-customer-contracts/src/index'
import { SqlChatJournal } from '../../services/actor-runner/src/chat-journal'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'
import { taskUiJourney } from './task-ui-journey'

const base = process.env.LIVE_LLM_BASE_URL,
	database = process.env.TEST_TASK_DATABASE_URL
assert(base && database, 'A real Qwen endpoint and disposable PostgreSQL URL are required.')
const available = await fetch(`${base.replace(/\/$/, '')}/models`, {
	signal: AbortSignal.timeout(10_000)
}).then((r) => {
	assert(r.ok)
	return r.json()
})
const upstream =
	process.env.LIVE_LLM_MODEL ?? available.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(upstream && /qwen/i.test(upstream), 'This proof requires Qwen.')
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'proof-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: upstream,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const out = await mkdtemp(join(tmpdir(), 'aven-live-durable-tasks-'))
const evidence: any = {
	synthetic: true,
	scope:
		'Facade admission, customer-local outbox and history, Task Actor, shared Chat journal, actual provisioning and restricted PostgreSQL roles; not native or a production dispatcher',
	upstream,
	startedAt: new Date().toISOString(),
	passed: false,
	cases: [],
	fingerprints: {}
}
for (const path of [
	'libs/aven-productivity/src/tasks.ts',
	'libs/aven-productivity/src/postgres.ts',
	'libs/aven-productivity/src/trial.ts',
	'libs/aven-productivity/src/actor.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/model.ts',
	'libs/aven-chat-engine/src/journal.ts',
	'libs/aven-chat-engine/src/durable.ts',
	'services/actor-runner/src/chat-journal.ts',
	'deploy/e2e/live-durable-tasks.ts',
	'deploy/e2e/task-service-fixture.ts',
	'libs/aven-productivity/src/remote.ts',
	'services/intent-service/src/productivity.ts',
	'services/intent-service/src/store.ts',
	'deploy/e2e/input-facade-fixture.ts',
	'libs/aven-intents/src/admission.ts',
	'services/aven-api/src/customers/handler.ts',
	'services/aven-api/src/facade.ts',
	'services/intent-service/src/work-authority.ts',
	'services/intent-service/src/turn-outbox.ts',
	'services/platform-provisioner/components/intents/0002_input_admission.sql',
	'libs/aven-intents/src/work.ts',
	'services/intent-service/src/turn-work-handler.ts',
	'services/actor-runner/src/turn-work-client.ts',
	'services/intent-service/src/turn-lifecycle-handler.ts',
	'services/actor-runner/src/turn-lifecycle-client.ts',
	'services/intent-service/src/turn-dispatch-client.ts',
	'services/actor-runner/src/turn-admission-handler.ts',
	'services/aven-api/src/customers/work-dispatch.ts',
	'services/aven-api/src/customers/work-exchange.ts',
	'services/actor-runner/src/work-lease.ts',
	'services/aven-api/src/customers/work-http.ts',
	'services/intent-service/src/work-guard.ts',
	'libs/aven-customer-runtime/src/work-guard.ts',
	'services/aven-api/src/customers/worker-placement.ts',
	'libs/aven-customer-contracts/src/worker-placement.ts',
	'libs/aven-customer-runtime/src/worker-placement.ts',
	'libs/aven-customer-runtime/src/work-client.ts',
	'libs/aven-customer-runtime/src/pools.ts',
	'libs/aven-customer-runtime/src/admission.ts',
	'libs/aven-customer-contracts/src/grant.ts',
	'libs/aven-chat-engine/src/restored-history.ts',
	'libs/aven-chat-engine/src/history-selection.ts',
	'libs/aven-chat-engine/src/turn-payload.ts',
	'deploy/e2e/task-ui-journey.ts',
	'app/src/lib/actors/TaskWindow.svelte',
	'app/src/lib/actors/todo.svelte.ts',
	'app/src/lib/actors/task-client.ts',
	'app/src/lib/chat/TaskResultCard.svelte',
	'app/src/lib/chat/ToolResultCard.svelte',
	'libs/aven-chat-engine/src/tool-preview.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const engineDigest = await journalDigest(evidence.fingerprints)
const save = () =>
	writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
let pool: pg.Pool | undefined,
	fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined,
	modelRequests = 0
const owner = randomUUID(),
	intentId = randomUUID()
const model: ModelStream = async function* (messages, tools, signal, _model, options) {
	modelRequests++
	const response = await gateway.openAiChatCompletion(
		{
			model: 'proof-qwen',
			messages,
			stream: true,
			max_tokens: options?.max_tokens ?? 2048,
			temperature: 0.2,
			chat_template_kwargs: { enable_thinking: options?.thinking ?? false },
			...(options?.json && { response_format: { type: 'json_object' } }),
			...(tools.length && { tools: tools.map((tool) => ({ type: 'function', function: tool })) })
		},
		signal
	)
	assert(response.ok && response.body, `Model failed: ${response.status}`)
	async function* chunks() {
		const decoder = new TextDecoder()
		for await (const bytes of response.body!) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
	yield* streamEvents(chunks(), signal)
}
async function turn(
	text: string,
	repository: TaskRepository,
	options: { trial?: boolean; loseReceipt?: boolean; loseOutcome?: boolean; fresh?: boolean } = {}
) {
	const specs = taskManifest(repository.mode).methods.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters
	}))
	const accepted = {
		inputId: randomUUID(),
		revision: 1,
		text,
		originalText: text,
		corrections: [],
		target: options.fresh
			? {
					kind: 'new' as const,
					title: options.trial ? 'Repair cafe trial' : 'Repair cafe planning'
				}
			: { kind: 'existing' as const, id: intentId },
		locale: 'en-GB',
		timezone: 'Europe/London',
		capturedAt: new Date().toISOString(),
		decisionId: randomUUID(),
		confirmed: true,
		references: []
	}
	const receipt = await fixture!.admission.admit(accepted)
	assert.deepEqual(
		await fixture!.admission.admit(accepted),
		receipt,
		'Lost admission acknowledgement cannot duplicate a contribution.'
	)
	const { turnId, contributionId } = receipt,
		leaseOwner = randomUUID()
	const claimed = await fixture!.turns.claim(fixture!.turnScope, turnId)
	assert.equal(claimed.state, 'claimed')
	if (claimed.state !== 'claimed') throw Error('Turn was not dispatched')
	await fixture!.turns.dispatched(fixture!.turnScope, turnId, claimed.dispatch.token, turnId)
	const savedHistory = await fixture!.turns.history(fixture!.turnScope, turnId, turnId)
	const history: Turn[] = savedHistory.contributions
		.filter((c) => c.kind === 'message' && ['human', 'agent'].includes(c.contributor_kind))
		.map((c) => ({
			id: c.id,
			role: c.contributor_kind === 'human' ? 'user' : 'assistant',
			content: c.text ?? '',
			calls: callsFromPayload(c.payload)
		}))
	const work = await verifyWorkGrant(
		claimed.dispatch.workGrant,
		fixture!.tenantKey,
		fixture!.issuer
	)
	await pool!.query(
		`INSERT INTO aven_actor_runs.runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
    VALUES($1::uuid,$2,$1::text,'proof','running',1,$3)`,
		[
			turnId,
			owner,
			{
				lease: { ownerId: leaseOwner, expiresAt: new Date(Date.now() + 600_000).toISOString() },
				parameters: {
					turnId,
					inputId: work.inputId,
					inputRevision: work.inputRevision,
					materialDigest: work.materialDigest
				}
			}
		]
	)
	if (!options.trial)
		repository = fixture!.delegatedRepository(
			turnId,
			turnId,
			leaseOwner,
			claimed.dispatch.workGrant
		)
	const journal = new SqlChatJournal(pool!, turnId, leaseOwner, engineDigest)
	const input = {
		turnId,
		intentId: receipt.intentId,
		user: { id: contributionId, role: 'user' as const, content: text },
		history,
		context: `Accepted Intent: invented community repair cafe. Use the saved task Actor for task work. Ask what the user wants when the request is only a broad topic. ${options.trial ? 'This is explicitly a trial; state that changes are not saved to the real task list.' : 'Productive task list.'}`,
		startedAt: await journal.startedAt(),
		timezone: 'Europe/London'
	}
	const calls: any[] = [],
		report: any = {
			text,
			trial: Boolean(options.trial),
			lostReceipt: Boolean(options.loseReceipt),
			lostOutcome: Boolean(options.loseOutcome),
			calls
		}
	evidence.cases.push(report)
	let lostOutcome = false
	const transport: TaskRepository = {
		mode: repository.mode,
		list: (...args) => repository.list(...args),
		receipt: (...args) => repository.receipt(...args),
		execute: async (...args) => {
			const receipt = await repository.execute(...args)
			if (options.loseOutcome && !lostOutcome) {
				lostOutcome = true
				throw new TaskRequestError(
					'Injected loss of the actual committed HTTP response.',
					'TASKS_UNAVAILABLE',
					503
				)
			}
			return receipt
		}
	}
	const execute = async (name: string, args: string, operationId: string) => {
		const actor = createTaskActor(transport, () => ({
			ownerSubjectId: owner,
			operationId,
			intentId: receipt.intentId,
			contributionId
		}))
		try {
			const result = await actor.deliver(name, JSON.parse(args))
			calls.push({ name, args: JSON.parse(args), result: JSON.parse(result.record) })
			return result
		} finally {
			actor.dispose()
		}
	}
	const resolve = async (operationId: string) => {
		const receipt = await repository.receipt(owner, operationId)
		if (!receipt) return null
		const record = JSON.stringify({
			ok: true,
			mode: options.trial ? 'trial' : 'production',
			...receipt
		})
		return { result: { record, wire: record }, basis: 'receipt-check' as const }
	}
	if (options.loseReceipt) {
		let injected = false
		const interrupted: TurnJournal = {
			claim: (...args) => journal.claim(...args),
			timing: () => journal.timing(),
			complete: async (ordinal, value) => {
				if (
					!injected &&
					value.kind === 'tool' &&
					JSON.parse(value.result.record).operation === 'create'
				) {
					injected = true
					throw Error('Injected task receipt acknowledgement loss.')
				}
				return journal.complete(ordinal, value)
			}
		}
		await assert.rejects(
			() => executeDurableChat(input, { journal: interrupted, model, specs, execute, resolve }),
			/acknowledgement loss/
		)
		assert(injected)
	}
	if (options.loseOutcome) {
		await assert.rejects(
			() => executeDurableChat(input, { journal, model, specs, execute, resolve }),
			/may have been saved/
		)
		assert(lostOutcome)
		const changes = calls.filter(
			(call) => call.name !== 'todo_list' && call.result.effect !== 'not-applied'
		)
		assert.equal(
			changes.length,
			1,
			'Uncertainty must stop before a second possibly applied change.'
		)
		assert.equal(
			calls.at(-1)?.result.effect,
			'uncertain',
			'No tool may run after an uncertain effect.'
		)
		report.rejectedAttemptsBeforeUncertainty = calls.filter(
			(call) => call.result.effect === 'not-applied'
		).length
	}
	const completed = await executeDurableChat(input, { journal, model, specs, execute, resolve })
	assert.equal(
		completed.state,
		'completed',
		completed.failure ?? 'The turn must complete successfully.'
	)
	report.reply = completed.reply
	report.diagnostics = completed.diagnostics
	const beforeReplay = modelRequests,
		beforeCalls = calls.length
	const replay = await executeDurableChat(input, { journal, model, specs, execute, resolve })
	assert.equal(replay.reply.content, completed.reply.content)
	assert.equal(modelRequests, beforeReplay)
	assert.equal(calls.length, beforeCalls)
	// Final contribution and FIFO release are one customer-local transaction under the real service role.
	const payload = JSON.parse(JSON.stringify(turnPayload(completed.reply)))
	const final = { state: completed.state, text: completed.reply.content, payload }
	const outputId = await fixture!.turns.finish(fixture!.turnScope, turnId, turnId, final)
	assert.equal(await fixture!.turns.finish(fixture!.turnScope, turnId, turnId, final), outputId)
	const stored = await fixture!.store.detail(owner, receipt.intentId)
	assert.equal(stored.contributions.filter((c) => c.id === outputId).length, 1)
	report.savedToolOutcomes = payload
	report.outputContributionId = outputId
	report.replayWithoutNewCalls = true
	await save()
	return report
}
try {
	fixture = await taskServiceFixture(database, owner, intentId)
	pool = fixture.pool
	let repository = fixture.repository()
	await turn(
		'Please save two tasks for our repair cafe: inspect the spare soldering irons, and order replacement magnifier lenses. Tag them workshop, put them in the team group, and leave the due date unset.',
		repository,
		{ loseReceipt: true }
	)
	let tasks = (await repository.list(owner, {})).tasks
	assert.equal(tasks.length, 2)
	assert(
		tasks.every(
			(task) => task.group === 'team' && task.tags.includes('workshop') && task.due === null
		)
	)
	// New repository instance sees exactly the same records; the Actor never owns the data.
	repository = fixture.repository()
	assert.deepEqual((await repository.list(owner, {})).tasks, tasks)
	const outsider = randomUUID()
	assert.equal((await fixture.repository(outsider).list(outsider, {})).tasks.length, 0)
	await turn(
		'die lötgeräte sind erledigt. nur abhaken, bitte nichts löschen oder umbenennen.',
		repository,
		{ loseOutcome: true }
	)
	tasks = (await repository.list(owner, {})).tasks
	assert.equal(tasks.filter((task) => task.status === 'done').length, 1)
	assert(
		tasks.every((task) => !task.archived && task.tags.includes('workshop') && task.group === 'team')
	)
	await turn(
		'quick correction the magnifier job is mine, not team. put it in my list and set it due 2031-04-12, a whole day not an appointment',
		repository
	)
	tasks = (await repository.list(owner, {})).tasks
	const dueTask = tasks.find((task) => task.due?.kind === 'date')!
	assert(
		dueTask &&
			dueTask.group === 'me' &&
			dueTask.due?.kind === 'date' &&
			dueTask.due.date === '2031-04-12'
	)
	const before = JSON.stringify(tasks)
	const broad = await turn(
		'I want to think about how to organize the repair cafe. Not sure where to start.',
		repository,
		{ fresh: true }
	)
	assert(broad.reply.content.includes('?'), 'Broad discussion should invite clarification.')
	assert.equal(
		broad.calls.length,
		0,
		'A broad new discussion should clarify before inspecting workspace data.'
	)
	assert.equal(JSON.stringify((await repository.list(owner, {})).tasks), before)
	const trial = new TrialTaskRepository(tasks)
	const simulated = await turn(
		'Nur ausprobieren: Lege eine Aufgabe zum Prüfen der Schutzbrillen an. Nicht in der echten Liste speichern.',
		trial,
		{ trial: true, fresh: true }
	)
	assert(
		simulated.calls.some((call: any) => call.name === 'todo_create' && call.result.mode === 'trial')
	)
	assert.equal((await trial.list(owner, {})).tasks.length, 3)
	assert.equal(JSON.stringify((await repository.list(owner, {})).tasks), before)
	// Independently exercise the same command boundary for concurrency and atomic batch changes.
	const cause = (): TaskCause => ({ operationId: randomUUID(), intentId, contributionId: null })
	const command = taskCommandSchema.parse({
		operation: 'update',
		tasks: [{ id: dueTask.id, revision: dueTask.revision }],
		patch: { status: 'doing' }
	})
	const raced = await Promise.allSettled([
		repository.execute(owner, command, cause()),
		repository.execute(owner, command, cause())
	])
	assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1)
	assert.equal(raced.filter((result) => result.status === 'rejected').length, 1)
	const stable = (await repository.list(owner, {})).tasks
	const archiveCause = cause()
	const archive = taskCommandSchema.parse({
		operation: 'archive',
		tasks: stable.map(({ id, revision }) => ({ id, revision })),
		archived: true
	})
	const receipts = await Promise.all(
		Array.from({ length: 8 }, () => repository.execute(owner, archive, archiveCause))
	)
	for (const receipt of receipts) assert.deepEqual(receipt, receipts[0])
	assert.equal((await repository.list(owner, {})).tasks.length, 0)
	const archived = (await repository.list(owner, { archived: true })).tasks
	assert.equal(archived.length, 2)
	await repository.execute(
		owner,
		taskCommandSchema.parse({
			operation: 'archive',
			tasks: archived.map(({ id, revision }) => ({ id, revision })),
			archived: false
		}),
		cause()
	)
	await assert.rejects(
		() => repository.execute(owner, { ...archive, archived: false }, archiveCause),
		/different change/
	)
	const fresh = (await repository.list(owner, {})).tasks
	await assert.rejects(
		() =>
			fixture!.repository(outsider).execute(
				outsider,
				taskCommandSchema.parse({
					operation: 'update',
					tasks: [{ id: fresh[0]!.id, revision: fresh[0]!.revision }],
					patch: { title: 'Not permitted' }
				}),
				{ ...cause(), intentId: null }
			),
		/no longer available/
	)
	await assert.rejects(
		() =>
			repository.execute(
				owner,
				taskCommandSchema.parse({
					operation: 'update',
					tasks: fresh.map((task, i) => ({ id: task.id, revision: task.revision - i })),
					patch: { status: 'done' }
				}),
				cause()
			),
		/changed/
	)
	assert.deepEqual((await repository.list(owner, {})).tasks, fresh)
	evidence.boundaries = {
		revisionRace: true,
		batchRollback: true,
		replayedArchive: true,
		restore: true,
		ownerIsolation: true,
		trialIsolation: true
	}
	evidence.serviceBoundaries = await fixture.boundaries()
	if (process.env.E2E_APP_ORIGIN)
		evidence.ui = await taskUiJourney(
			fixture,
			process.env.E2E_APP_ORIGIN,
			out,
			evidence.cases.map((item: any) => item.reply)
		)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	evidence.modelRequests = modelRequests
	evidence.finishedAt = new Date().toISOString()
	await save()
	await fixture?.close()
	console.log(
		JSON.stringify({ evidence: join(out, 'evidence.json'), passed: evidence.passed, modelRequests })
	)
}
