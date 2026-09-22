/** Real Qwen with the production background composition; fictional data only. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InputAdmission } from '@avenos/intents/admission'
import { IntentWorkRequestError, RemoteIntentWork } from '@avenos/intents/remote'
import { parseStudioSkillV2, TrustedActorInstallations } from '../../libs/aven-actors/src'
import { IdentityVerifier } from '../../libs/aven-identity/src'
import { HttpLlmGatewayClient } from '../../libs/aven-llm-client/src/http'
import type { InputRoute } from '../../libs/aven-llm-client/src/input-decision'
import { createBackgroundChatHost } from '../../services/actor-runner/src/background-chat'
import {
	CHAT_TURN_SKILL,
	createChatTurnExecutor
} from '../../services/actor-runner/src/chat-executor'
import { createDocumentCatalogSource } from '../../services/actor-runner/src/document-catalog'
import {
	createMarkdownRuntimeFactory,
	installMarkdownRuntimeActor
} from '../../services/actor-runner/src/markdown-runtime'
import { ActorRecoveryWorker } from '../../services/actor-runner/src/recovery-worker'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import { StudioArtifacts } from '../../services/actor-runner/src/studio-artifacts'
import { createFacadeHandler } from '../../services/aven-api/src/facade'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { createIntentTurnRuntime } from '../../services/intent-service/src/turn-runtime'
import { taskServiceFixture } from './task-service-fixture'

const database = process.env.TEST_TASK_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL
assert(database && base, 'Use the isolated PostgreSQL server and actual Qwen endpoint.')
const upstream = process.env.LIVE_LLM_MODEL
assert(upstream && /qwen/i.test(upstream), 'Choose the actual Qwen model identifier.')
const editVariant = process.env.EDIT_VARIANT ?? 'standard'
assert(['standard', 'multilingual'].includes(editVariant), 'Unknown edit scenario variant.')
const editScenario =
	editVariant === 'multilingual'
		? {
				before: 'Préparer les panneaux du jardin',
				after: 'Vernir les panneaux du jardin',
				original:
					'Note une tâche « Préparer les panneaux du jardin » dans ma liste perso, sans échéance.',
				replacement:
					'Note une tâche « Vernir les panneaux du jardin » pour l’équipe, sans échéance.',
				followup:
					'Ho finito « Vernir les panneaux du jardin ». Segna come completata solo quella attività.',
				completedEdit:
					'Esa misma tarea de los carteles del jardín va a mi lista personal. Conserva el título actual y que ya está terminada; no hagas una copia.',
				locale: 'fr-FR',
				followupLocale: 'it-IT',
				completedLocale: 'es-ES'
			}
		: {
				before: 'Check the folding telescope',
				after: 'Inspect the folding telescope',
				original:
					'Save a task named "Check the folding telescope" in my personal list, with no due date.',
				replacement:
					'Save a task named "Inspect the folding telescope" in the team group, with no due date.',
				followup:
					'Die Aufgabe „Inspect the folding telescope“ ist erledigt. Bitte nur diese als erledigt markieren.',
				completedEdit:
					'Put that same telescope inspection task in my personal list instead. Keep its current completed status and title; do not create a copy.',
				locale: 'en-GB',
				followupLocale: 'de-DE',
				completedLocale: 'en-GB'
			}
const directory = await mkdtemp(join(tmpdir(), 'aven-live-background-chat-'))
const evidence: any = {
	synthetic: true,
	passed: false,
	upstream,
	editVariant,
	startedAt: new Date().toISOString(),
	scope:
		'Production worker/Chat/tool composition on signed HTTP services and real SQL/Store. No client or foreground pump. Not native, separate-process restart or protected mail qualification.',
	fingerprints: {},
	routes: [],
	answers: [],
	sweeps: [],
	checks: {}
}
for (const path of [
	'deploy/e2e/live-background-chat.ts',
	'deploy/e2e/task-service-fixture.ts',
	'services/actor-runner/build/index.js',
	'target/rust/debug/aven-artifact-store',
	'services/actor-runner/src/background-chat.ts',
	'services/actor-runner/src/work-tasks.ts',
	'services/actor-runner/src/recovery-worker.ts',
	'services/actor-runner/src/work-studio.ts',
	'services/intent-service/src/turn-runtime.ts',
	'services/intent-service/src/store.ts',
	'services/intent-service/src/turn-outbox.ts',
	'services/platform-provisioner/components/intents/0004_input_replacements.sql',
	'libs/aven-intents/src/admission.ts',
	'libs/aven-intents/src/remote.ts',
	'libs/aven-intents/src/work.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/prior-actions.ts',
	'libs/aven-chat-engine/src/research.ts',
	'services/intent-service/src/replacement-history.ts',
	'services/actor-runner/src/chat-host.ts',
	'services/actor-runner/src/chat-receipts.ts',
	'libs/aven-actors/src/studio/agent.ts',
	'bun.lock'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const digest = createHash('sha256').update(JSON.stringify(evidence.fingerprints)).digest('hex')
const save = () =>
	writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
const owner = randomUUID(),
	intentId = randomUUID(),
	serviceToken = randomUUID() + randomUUID()
const config = testConfig({
	LLM_GATEWAY_ENABLED: 'true',
	LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
	LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN: serviceToken,
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
const gateway = LlmGatewayService.fromConfig(config)!
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined
let runtime: ReturnType<typeof createIntentTurnRuntime> | undefined,
	runner: SqlPlanRunner | undefined
let recovery: ActorRecoveryWorker | undefined, modelServer: ReturnType<typeof Bun.serve> | undefined
let held = false,
	release = () => {}
const delayed = new Promise<void>((resolve) => {
	release = resolve
})
let editGate: { needle: string; held: boolean; release(): void; wait: Promise<void> } | undefined
async function until<T>(
	read: () => Promise<T | undefined>,
	label: string,
	timeout = 240_000
): Promise<T> {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		const value = await read()
		if (value !== undefined) return value
		await Bun.sleep(100)
	}
	throw Error('Timed out: ' + label)
}
try {
	const handler = createFacadeHandler(
		config,
		new IdentityVerifier({ issuer: 'https://identity.example.test' }),
		undefined,
		undefined,
		undefined,
		undefined,
		gateway
	)
	modelServer = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		idleTimeout: 255,
		fetch: async (request) => {
			if (editGate && !editGate.held && request.method === 'POST') {
				const body = await request
					.clone()
					.json()
					.catch(() => null)
				if (
					body?.messages?.some(
						(message: any) =>
							message.role === 'tool' &&
							typeof message.content === 'string' &&
							message.content.includes(editGate!.needle)
					)
				) {
					editGate.held = true
					await editGate.wait
				}
			}
			// Delay one real request at its transport boundary. Never replace its output.
			if (
				!held &&
				request.method === 'POST' &&
				(await request.clone().text()).includes('Polish the brass lantern')
			) {
				held = true
				await delayed
			}
			return handler(request)
		}
	})
	fixture = await taskServiceFixture(database, owner, intentId, { artifacts: true })
	const f = fixture,
		wiring = f.background()
	const work = new RemoteIntentWork(async (method, path, body) => {
		assert.equal(method, body === undefined ? 'GET' : 'POST')
		const response = await f.admission.request(path, body)
		const value = await response.json()
		if (!response.ok) throw new IntentWorkRequestError(value.message, value.code, response.status)
		return value
	})
	const artifacts = new StudioArtifacts(f.seedArtifacts!, f.environmentId)
	const installations = new TrustedActorInstallations()
	await installMarkdownRuntimeActor(installations)
	const catalog = createDocumentCatalogSource(f.environmentId, installations, [
		createMarkdownRuntimeFactory(artifacts).offer
	])
	const host = createBackgroundChatHost(
		{ ...wiring.config, modelId: 'proof-qwen', engineDigest: digest },
		{ environmentId: f.environmentId, generation: 1, worker: f.workerPool },
		{
			...wiring.pools,
			runner: () => runner!,
			catalog,
			installations,
			model: new HttpLlmGatewayClient({
				baseUrl: modelServer.url.origin + '/internal/v1/llm',
				bearerToken: serviceToken
			})
		}
	)
	const makeRunner = () =>
		new SqlPlanRunner(
			f.actorPool,
			f.workerPool,
			createChatTurnExecutor(host),
			true,
			180_000,
			4,
			(record) => host.ready(record),
			(record) => (record.skillRef === CHAT_TURN_SKILL ? digest : undefined)
		)
	runner = makeRunner()
	f.installRunner(() => runner!)
	const sweeps = (mode: string, result: unknown) =>
		evidence.sweeps.push({ mode, at: new Date().toISOString(), result })
	const makeRuntime = () => createIntentTurnRuntime(wiring.config, wiring.intentPools, sweeps)
	const makeRecovery = () =>
		new ActorRecoveryWorker({
			placements: f.actorPlacementClient,
			recover: async (placement) => {
				assert.equal(placement.environmentId, f.environmentId)
				await wiring.pools.pools.forPlacement(placement)
				await wiring.pools.workerPools.forPlacement(placement)
				await runner!.recoverAcceptedRuns()
			},
			report: (result) => sweeps('recovery', result)
		})
	const admit = async (
		text: string,
		target: InputAdmission['target'],
		locale = 'en-GB',
		replaces?: InputAdmission['replaces']
	) => {
		const route = await gateway.inputDecision(
			{
				kind: 'route',
				modelId: 'proof-qwen',
				text,
				locale,
				context: {
					selectedId: intentId,
					intents: [{ id: intentId, title: 'Community repair cafe' }],
					recent: []
				}
			},
			owner
		)
		evidence.routes.push({ text, ...route })
		const receipt = await work.admit({
			inputId: randomUUID(),
			revision: 1,
			text,
			originalText: text,
			corrections: [],
			target,
			locale,
			timezone: 'Europe/London',
			capturedAt: new Date().toISOString(),
			decisionId: randomUUID(),
			responseMode: (route.decision as InputRoute).responseMode,
			confirmed: true,
			references: [],
			...(replaces && { replaces })
		})
		assert.deepEqual(await work.receipt(receipt.inputId, receipt.revision), receipt)
		return receipt
	}
	const page = async (id: string) => {
		return (await work.turns(id)).turns
	}
	const answer = async (turn: Awaited<ReturnType<typeof admit>>) =>
		until(async () => {
			const status = (await page(turn.intentId)).find((t) => t.turnId === turn.turnId)!
			assert(!['failed', 'blocked', 'cancelled'].includes(status.state), JSON.stringify(status))
			if (status.state !== 'completed') return undefined
			const contribution = (await f.store.detail(owner, turn.intentId)).contributions.find(
				(c) => c.id === status.outputContributionId
			)!
			assert(contribution?.text, 'Completion must retain its actual answer.')
			const calls = contribution.payload.toolCalls as
				| Array<{ name: string; status: string }>
				| undefined
			assert(
				!calls?.some((c) => c.status === 'failed'),
				'Inspect every failed tool, not only the final answer.'
			)
			evidence.answers.push({ turnId: turn.turnId, ...contribution })
			await save()
			return contribution
		}, 'background answer ' + turn.turnId)
	// Admit before the supervisors start, as after a cold service restart.
	const original = await admit(
		'Save a task named "Paint the copper lantern" and a task named "Replace the kite string". No dates.',
		{ kind: 'existing', id: intentId }
	)
	const next = await admit('kite string is replaced, tick just that one off pls', {
		kind: 'existing',
		id: intentId
	})
	const first = await admit(
		'Save a task named "Polish the brass lantern" and a task named "Replace the kite string". No dates.',
		{ kind: 'existing', id: intentId },
		'en-GB',
		{ turnId: original.turnId, expectedControlRevision: 1 }
	)
	assert(
		first.sequence > next.sequence,
		'The edit is a later immutable contribution, not a rewritten row.'
	)
	assert.equal(
		(await page(intentId)).find((t) => t.turnId === original.turnId)?.reason,
		'INPUT_REPLACED'
	)
	const other = await admit(
		'Ich möchte über ein kleines Nachbarschaftskino nachdenken. Noch keine konkrete Aufgabe.',
		{ kind: 'new', title: 'Nachbarschaftskino' },
		'de-DE'
	)
	assert(
		(await page(intentId)).every((t) =>
			t.turnId === original.turnId ? t.state === 'cancelled' : t.state === 'queued'
		)
	)
	runtime = makeRuntime()
	recovery = makeRecovery()
	runtime.start()
	recovery.start()
	await until(async () => held || undefined, 'first model request held')
	const separateAnswer = await answer(other)
	assert(
		!((separateAnswer.payload.toolCalls as unknown[]) ?? []).length,
		'An underspecified topic asks, without unsolicited work.'
	)
	assert.equal((await page(intentId)).find((t) => t.turnId === next.turnId)!.state, 'queued')
	release()
	await answer(first)
	await answer(next)
	const tasks = (await f.repository().list(owner, {})).tasks
	assert.equal(tasks.length, 2)
	assert.equal(tasks.find((t) => t.title === 'Replace the kite string')!.status, 'done')
	assert.equal(tasks.find((t) => t.title === 'Polish the brass lantern')!.status, 'open')
	assert(
		!tasks.some((t) => t.title === 'Paint the copper lantern'),
		'Superseded work must not execute from history.'
	)
	const originalState = (
		await f.pool.query('SELECT run_id FROM aven_intents.turn_outbox WHERE turn_id=$1', [
			original.turnId
		])
	).rows[0]
	assert.equal(originalState.run_id, null, 'The original was never bound to an executor.')
	evidence.checks.queuedReplacementBeforeLaterFollowup = true
	evidence.checks.independentFifoAndTasks = true
	// Close all worker loops, then admit more work and reconstruct the composition.
	await runtime.close()
	await recovery.close()
	await runner.close()
	const budget = await admit(
		'Rechne bitte: 9 Reparatursets zu je 13,40 EUR. Wie viel insgesamt? Zeig kurz, was du berechnet hast.',
		{ kind: 'new', title: 'Materialbudget' },
		'de-DE'
	)
	await Bun.sleep(1200)
	assert.equal(
		(await page(budget.intentId))[0]!.state,
		'queued',
		'Closed workers must not retain stray timers.'
	)
	runner = makeRunner()
	runtime = makeRuntime()
	recovery = makeRecovery()
	runtime.start()
	recovery.start()
	const calculated = await answer(budget)
	assert.match(calculated.text!, /120[,.]60/)
	assert((calculated.payload.toolCalls as any[]).some((c) => c.name === 'calculate'))
	evidence.checks.coldDiscoveryAndCalculation = true
	const skill = await admit(
		'We manually write a short introduction before each community session. Make that reusable: a Skill named "Community introduction" that writes a Markdown document with editable title and content. Discover the installed operation, save, check and publish the Skill. Do not execute it or create any tasks.',
		{ kind: 'new', title: 'Session preparation' }
	)
	await answer(skill)
	const drafts = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1', [owner])
	).rows
	assert.equal(drafts.length, 1)
	assert(drafts[0].published_artifact_id)
	const definition = parseStudioSkillV2(
		(await artifacts.get(drafts[0].published_artifact_id)).payload
	)
	assert.equal(definition.steps.length, 1)
	assert.equal(definition.steps[0]!.kind, 'invoke')
	assert(Object.keys(definition.parametersSchema.properties ?? {}).length >= 2)
	assert.equal((await f.repository().list(owner, {})).tasks.length, 2)
	evidence.checks.sharedStudioAuthoring = true
	// Hold the next actual model request only after the first Task mutation has
	// committed and its real result appears in the conversation. No model output,
	// tool result, cancellation or settlement is fabricated by this gate.
	let releaseEdit = () => {}
	const waitEdit = new Promise<void>((resolve) => {
		releaseEdit = resolve
	})
	editGate = {
		needle: editScenario.before,
		held: false,
		release: releaseEdit,
		wait: waitEdit
	}
	const active = await admit(
		editScenario.original,
		{ kind: 'existing', id: intentId },
		editScenario.locale
	)
	await until(async () => editGate!.held || undefined, 'committed action before editing')
	const committed = (await f.repository().list(owner, { intentId })).tasks.find(
		(task) => task.title === editGate!.needle
	)!
	assert(committed, 'The old action really committed before its message was edited.')
	const later = await admit(
		editScenario.followup,
		{ kind: 'existing', id: intentId },
		editScenario.followupLocale
	)
	const activeStatus = (await page(intentId)).find((turn) => turn.turnId === active.turnId)!
	const edited = await admit(
		editScenario.replacement,
		{ kind: 'existing', id: intentId },
		editScenario.locale,
		{ turnId: active.turnId, expectedControlRevision: activeStatus.controlRevision }
	)
	const stopped = (await page(intentId)).find((turn) => turn.turnId === active.turnId)!
	assert.equal(stopped.state, 'stopping')
	assert.equal(
		(await page(intentId)).find((turn) => turn.turnId === edited.turnId)!.state,
		'queued'
	)
	assert.equal((await page(intentId)).find((turn) => turn.turnId === later.turnId)!.state, 'queued')
	releaseEdit()
	const editedAnswer = await answer(edited)
	assert(
		!(editedAnswer.payload.toolCalls as any[]).some((call) => call.name === 'todo_create'),
		'An edited create must reuse its committed task, not create another one.'
	)
	await answer(later)
	const settledTasks = (await f.repository().list(owner, {})).tasks
	assert.equal(settledTasks.length, 3)
	const updated = settledTasks.find((task) => task.id === committed.id)!
	assert.equal(updated.title, editScenario.after)
	assert.equal(updated.group, 'team')
	assert.equal(updated.status, 'done')
	assert.equal(
		updated.revision,
		3,
		'One edit and one queued completion, without duplicate effects.'
	)
	assert.equal(
		(await page(intentId)).find((turn) => turn.turnId === active.turnId)!.state,
		'cancelled'
	)
	const oldRow = (
		await f.pool.query('SELECT output_id FROM aven_intents.turn_outbox WHERE turn_id=$1', [
			active.turnId
		])
	).rows[0]
	assert(
		!(await f.store.detail(owner, intentId)).contributions.some((c) => c.id === oldRow.output_id),
		'The superseded run cannot publish a stale final answer.'
	)
	evidence.checks.activeReplacement = {
		committedTaskId: committed.id,
		replacement: edited.turnId,
		preservedEffect: true,
		orderedFollowup: true,
		noDuplicateCreate: true,
		staleAnswerFenced: true
	}
	// Completion won this later edit race. Its earlier update receipt is now stale
	// (the follow-up marked the task done). Inspect current state and preserve it.
	const endedStatus = (await page(intentId)).find((turn) => turn.turnId === edited.turnId)!
	const afterCompletion = await admit(
		editScenario.completedEdit,
		{ kind: 'existing', id: intentId },
		editScenario.completedLocale,
		{ turnId: edited.turnId, expectedControlRevision: endedStatus.controlRevision }
	)
	const endedAnswer = await answer(afterCompletion)
	assert(!(endedAnswer.payload.toolCalls as any[]).some((call) => call.name === 'todo_create'))
	const finalTasks = (await f.repository().list(owner, {})).tasks
	assert.equal(finalTasks.length, 3)
	assert.deepEqual(
		finalTasks.find((task) => task.id === committed.id),
		{
			...updated,
			group: 'me',
			revision: 4,
			updatedAt: finalTasks.find((task) => task.id === committed.id)!.updatedAt
		}
	)
	assert.equal(
		(await page(intentId)).find((turn) => turn.turnId === edited.turnId)!.state,
		'completed'
	)
	evidence.checks.completedReplacement = {
		preservedLaterCompletion: true,
		currentRevisionUsed: true,
		ancestryDepth: 2,
		noDuplicateCreate: true
	}
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	if (fixture) {
		evidence.failedRuns = (
			await fixture.pool.query('SELECT id,state,record FROM aven_actor_runs.runs')
		).rows
		evidence.steps = (
			await fixture.workerPool.query(
				'SELECT run_id,ordinal,kind,state,value FROM run_steps ORDER BY run_id,ordinal'
			)
		).rows
	}
	throw error
} finally {
	release()
	editGate?.release()
	await runtime?.close()
	await recovery?.close()
	await runner?.close()
	await fixture?.close()
	await modelServer?.stop(true)
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(
		JSON.stringify({
			directory,
			passed: evidence.passed,
			checks: evidence.checks,
			error: evidence.error
		})
	)
}
