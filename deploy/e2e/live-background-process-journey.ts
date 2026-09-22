/** Separate production containers, real Qwen and disposable customer records only. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import pg from 'pg'
import { modelMetricsFromPayload } from '../../libs/aven-chat-engine/src/model-metrics'
import { databaseNameForEnvironment } from '../../libs/aven-customer-contracts/src'
import type { AdmissionReceipt, InputAdmission } from '../../libs/aven-intents/src/admission'
import { IntentWorkRequestError, type RemoteIntentWork } from '../../libs/aven-intents/src/remote'
import { type TurnProgress, turnProgressSchema } from '../../libs/aven-intents/src/turn-progress'
import type { TurnStatus } from '../../libs/aven-intents/src/turn-status'
import type { InputRoute } from '../../libs/aven-llm-client/src/input-decision'

interface Options {
	api: string
	environmentId: string
	owner: string
	databaseUrl: string
	project: string
	evidencePath: string
	headers(): Promise<Record<string, string>>
	work: Pick<RemoteIntentWork, 'admit' | 'receipt' | 'turns' | 'stop'>
	progress(turnId: string): Promise<TurnProgress | null>
	reopenClient(): Promise<void>
}

async function until<T>(
	read: () => Promise<T | undefined>,
	label: string,
	timeout = 240_000,
	interval = 200
) {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		const result = await read()
		if (result !== undefined) return result
		await sleep(interval)
	}
	throw Error(`Timed out: ${label}`)
}

export async function liveBackgroundProcessJourney(options: Options) {
	const { api, environmentId, owner, project } = options
	assert(/^aven-e2e-[a-z0-9-]+$/.test(project), 'Only disposable E2E projects may be stopped.')
	assert(process.env.E2E_BACKGROUND_CHAT === 'true')
	assert(/qwen/i.test(process.env.TEST_DOCUMENT_PROVIDER_MODEL ?? ''))
	const url = new URL(options.databaseUrl)
	assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Use the isolated loopback database.')
	url.pathname = '/' + databaseNameForEnvironment(environmentId)
	const pool = new pg.Pool({ connectionString: url.toString(), max: 2 })
	const evidence: {
		synthetic: true
		passed: boolean
		scope: string
		startedAt: string
		finishedAt?: string
		provider?: string
		fingerprints: Record<string, string>
		checks: string[]
		observations: unknown[]
		error?: string
		errorCode?: string
		errorStatus?: number
	} = {
		synthetic: true,
		passed: false,
		scope:
			'Real native work client and signed IPC, separate service processes, durable admission, client close/reopen and Qwen. No composer/editor UI, protected mail, renewal UI or document retrieval qualification.',
		startedAt: new Date().toISOString(),
		provider: process.env.TEST_DOCUMENT_PROVIDER_MODEL,
		fingerprints: {},
		checks: [],
		observations: []
	}
	const save = () =>
		writeFile(options.evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 })
	const observe = async (value: unknown) => {
		evidence.observations.push(value)
		await save()
	}
	const docker = async (...args: string[]) => {
		const result = await promisify(execFile)('docker', args, {
			timeout: 30_000,
			maxBuffer: 16 * 1024 * 1024
		})
		return result.stdout
	}
	const inspect = async (service: 'actor-runner' | 'intent-service') => {
		const result = JSON.parse(await docker('inspect', `${project}-${service}-1`))[0]
		assert.equal(result.Config.Labels['com.docker.compose.project'], project)
		assert.equal(result.Config.Labels['com.docker.compose.service'], service)
		return {
			id: String(result.Id),
			image: String(result.Image),
			state: result.State,
			networks: Object.fromEntries(
				Object.entries(result.NetworkSettings.Networks).map(([name, network]: [string, any]) => [
					name,
					network.IPAddress
				])
			)
		}
	}
	const control = async (
		service: 'actor-runner' | 'intent-service',
		action: 'stop' | 'start' | 'kill'
	) => {
		const target = await inspect(service)
		await docker(action, ...(action === 'stop' ? ['--time', '10'] : []), target.id)
		await observe({
			event: action,
			service,
			containerId: target.id,
			image: target.image,
			networksBefore: target.networks,
			at: new Date().toISOString()
		})
		if (action === 'start') {
			await until(
				async () => {
					const { state, networks } = await inspect(service)
					const currentCheck = state.Health?.Log?.some(
						(check: any) =>
							check.ExitCode === 0 && Date.parse(check.Start) >= Date.parse(state.StartedAt)
					)
					if (!state.Running || state.Health?.Status !== 'healthy' || !currentCheck)
						return undefined
					await observe({ event: 'healthy', service, state, networks })
					return true
				},
				`${service} healthy`,
				60_000
			)
		} else assert.equal((await inspect(service)).state.Running, false)
	}
	const request = async (path: string, body?: unknown) => {
		const method = body === undefined ? 'GET' : 'POST'
		for (let attempt = 0; ; attempt++) {
			const started = performance.now()
			let response: Response
			try {
				response = await fetch(`${api}${path}`, {
					method,
					headers: { ...(await options.headers()), 'content-type': 'application/json' },
					body: body === undefined ? undefined : JSON.stringify(body),
					signal: AbortSignal.timeout(60_000)
				})
			} catch (error) {
				const cause = error instanceof Error ? error.cause : undefined
				await observe({
					event: 'transport-failure',
					method,
					path,
					attempt,
					durationMs: performance.now() - started,
					error: String(error),
					cause: String(cause)
				})
				// Reconnection is safe only for a read. Never hide a failed assertion,
				// retry a write with unknown outcome, or retry a deadline indefinitely.
				if (method !== 'GET' || attempt >= 2 || !(error instanceof TypeError)) throw error
				await sleep(250 * (attempt + 1))
				continue
			}
			const value = await response.json()
			assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(value)}`)
			return value
		}
	}
	const base = `/api/environments/${environmentId}/intents`
	const admit = async (text: string, target: InputAdmission['target'], locale = 'en-GB') => {
		// A human confirms the explicit test destination. The real router still owns
		// broad-topic vs actionable response mode; no fixture answer is injected.
		const decision = (await request('/api/llm/input-decision', {
			kind: 'route',
			modelId: 'deepseek/deepseek-v4-flash-0731',
			text,
			locale,
			context: {
				selectedId: target.kind === 'existing' ? target.id : 'none',
				intents: target.kind === 'existing' ? [{ id: target.id, title: 'Miniature workshop' }] : [],
				recent: []
			}
		})) as { decision: InputRoute }
		await observe({ event: 'route', text, decision })
		const input: InputAdmission = {
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
			responseMode: decision.decision.responseMode,
			confirmed: true,
			references: []
		}
		const receipt = await options.work.admit(input)
		assert.deepEqual(
			await options.work.admit(input),
			receipt,
			'A repeated admission must keep the exact original receipt.'
		)
		assert.deepEqual(await options.work.receipt(input.inputId, input.revision), receipt)
		await observe({ event: 'admitted', receipt })
		return receipt
	}
	const status = async (turn: AdmissionReceipt): Promise<TurnStatus> => {
		const result = await options.work.turns(turn.intentId)
		const found = result.turns.find((entry) => entry.turnId === turn.turnId)
		assert(found, 'Admitted turn must remain visible.')
		return found
	}
	const progress = async (turn: AdmissionReceipt) => {
		const result = await options.progress(turn.turnId)
		if (!result) return null
		const value = turnProgressSchema.parse(result)
		assert.equal(value.turnId, turn.turnId)
		assert(Buffer.byteLength(JSON.stringify(value)) < 16_384)
		return value
	}
	const answer = async (turn: AdmissionReceipt) =>
		until(
			async () => {
				const found = await status(turn)
				const current = await progress(turn)
				await observe({ event: 'native-progress', progress: current })
				assert(!['failed', 'blocked', 'cancelled'].includes(found.state), JSON.stringify(found))
				if (found.state !== 'completed') return undefined
				const result = await pool.query<{
					id: string
					text: string
					payload: {
						toolCalls?: Array<{ name: string; status: string }>
						responseDurationMs?: unknown
					}
				}>(
					'SELECT id,text,payload FROM aven_intents.contributions WHERE id=$1 AND owner_subject_id=$2',
					[found.outputContributionId, owner]
				)
				const contribution = result.rows[0]
				assert(contribution?.text, 'A completed answer must be saved for the correct owner.')
				assert(
					!contribution.payload.toolCalls?.some((call) => call.status === 'failed'),
					`Inspect failed tools: ${JSON.stringify(contribution)}`
				)
				const readable = await request(`${base}/messages/${contribution.id}`)
				await observe({ event: 'answer', status: found, contribution, readable })
				return contribution
			},
			`answer ${turn.turnId}`,
			240_000,
			1000
		)
	const tasks = async () =>
		(
			await pool.query<{ record: { id: string; title: string; status: string } }>(
				'SELECT record FROM aven_productivity.tasks WHERE owner_subject_id=$1 ORDER BY id',
				[owner]
			)
		).rows.map((row) => row.record)
	try {
		for (const file of [
			'deploy/e2e/live-background-process-journey.ts',
			'deploy/e2e/native-intent-work.ts',
			'libs/aven-intents/src/remote.ts',
			'app/src/lib/intents/work-client.ts',
			'app/src-tauri/src/intent_work.rs',
			'deploy/e2e/background-composition.ts',
			'services/actor-runner/src/index.ts',
			'services/intent-service/src/index.ts',
			'bun.lock'
		]) {
			evidence.fingerprints[file] = createHash('sha256')
				.update(await readFile(new URL(`../../${file}`, import.meta.url)))
				.digest('hex')
		}
		await observe({
			event: 'containers',
			runner: await inspect('actor-runner'),
			intents: await inspect('intent-service')
		})
		assert.equal((await tasks()).length, 0)
		await control('actor-runner', 'stop')
		assert.equal(await options.work.receipt(randomUUID(), 1), null)
		const first = await admit(
			'Save two tasks: "Paint the cardboard observatory" and "Label the velvet tray". No dates.',
			{ kind: 'new', title: 'Miniature workshop' }
		)
		const next = await admit('tray labels done, tick just that one off pls', {
			kind: 'existing',
			id: first.intentId
		})
		const other = await admit(
			'Quiero pensar en un pequeño festival de cuentos. Todavía no tengo una tarea concreta.',
			{ kind: 'new', title: 'Festival de cuentos' },
			'es-ES'
		)
		for (const turn of [first, next, other]) assert.equal((await status(turn)).state, 'queued')
		// Cancel one exact queued request without withdrawing other Intents or
		// pretending to undo accepted history. The proposed action must never run.
		const withdrawn = await admit('Add a task called "Arrange felt comets".', {
			kind: 'existing',
			id: other.intentId
		})
		const stop = {
			commandId: randomUUID(),
			expectedControlRevision: (await status(withdrawn)).controlRevision
		}
		const stopped = await options.work.stop(withdrawn.intentId, withdrawn.turnId, stop)
		assert.equal(stopped.disposition, 'cancelled')
		assert.deepEqual(await options.work.stop(withdrawn.intentId, withdrawn.turnId, stop), stopped)
		assert.equal((await status(withdrawn)).state, 'cancelled')
		const queued = await Promise.all([first, next, other, withdrawn].map(status))
		await options.reopenClient()
		assert.deepEqual(await Promise.all([first, next, other, withdrawn].map(status)), queued)
		for (const receipt of [first, next, other, withdrawn])
			assert.deepEqual(await options.work.receipt(receipt.inputId, receipt.revision), receipt)
		assert.equal((await tasks()).length, 0)
		evidence.checks.push(
			'Native admission and exact queued stop persist across client close/reopen; no client-local state or executor is required. Admission replay returns identical receipts.'
		)
		await control('actor-runner', 'start')
		assert.equal(await options.progress(randomUUID()), null)
		const liveProgress = await until(async () => {
			const current = await progress(first)
			return current?.operation?.state === 'running' ? current : undefined
		}, 'native live operation')
		await observe({ event: 'native-live-operation', progress: liveProgress })
		// Wait for actual committed task results and a subsequent model request, then
		// kill the production process. Do not fake its response or shorten its lease.
		const interrupted = await until(async () => {
			if ((await tasks()).length !== 2) return undefined
			const result = await pool.query<{ id: string; journal_engine: string }>(
				`SELECT r.id,r.journal_engine FROM aven_actor_runs.runs r
				JOIN aven_intents.turn_outbox o ON o.run_id=r.id
				WHERE o.turn_id=$1 AND r.state='running'
				AND EXISTS (SELECT 1 FROM aven_actor_runs.run_steps s WHERE s.run_id=r.id AND s.kind='tool' AND s.state='complete')
				AND EXISTS (SELECT 1 FROM aven_actor_runs.run_steps s WHERE s.run_id=r.id AND s.kind='model' AND s.state='pending')`,
				[first.turnId]
			)
			return result.rows[0]
		}, 'real task checkpoint followed by model generation')
		await control('actor-runner', 'kill')
		const killed = (
			await pool.query(
				`SELECT state,record,journal_started_at,
				(EXTRACT(EPOCH FROM (clock_timestamp()-journal_started_at))*1000)::double precision AS elapsed_ms
				FROM aven_actor_runs.runs WHERE id=$1`,
				[interrupted.id]
			)
		).rows[0]
		assert.equal(
			killed.state,
			'running',
			'The fault must interrupt an unfinished attempt, not an already completed answer.'
		)
		const completedSteps = (
			await pool.query(
				`SELECT ordinal,invocation_id,material_digest,value FROM aven_actor_runs.run_steps WHERE run_id=$1 AND state='complete' ORDER BY ordinal`,
				[interrupted.id]
			)
		).rows
		const commands = (
			await pool.query(
				'SELECT operation_id,receipt FROM aven_productivity.task_commands WHERE owner_subject_id=$1 ORDER BY operation_id',
				[owner]
			)
		).rows
		assert.equal((await status(next)).state, 'queued')
		await observe({
			event: 'interrupted',
			run: interrupted,
			record: killed.record,
			completedSteps,
			commands
		})
		await control('actor-runner', 'start')
		const recoveredAnswer = await answer(first)
		const savedDuration = recoveredAnswer.payload.responseDurationMs
		assert(
			typeof savedDuration === 'number' && savedDuration > killed.elapsed_ms,
			'Total response time must include execution before the process was killed.'
		)
		const outcome = (
			await pool.query(
				`SELECT value,completed_at FROM aven_actor_runs.run_steps
			WHERE run_id=$1 AND kind='outcome' AND state='complete'`,
				[interrupted.id]
			)
		).rows[0]
		assert.equal(outcome.value.result.reply.startedAt, killed.journal_started_at.getTime())
		assert.equal(outcome.value.result.reply.durationMs, savedDuration)
		assert(
			savedDuration <= outcome.completed_at.getTime() - killed.journal_started_at.getTime() + 1,
			'The stored duration must come from the database clock, not summed operations.'
		)
		await answer(next)
		const separate = await answer(other)
		assert.equal(
			separate.payload.toolCalls?.length ?? 0,
			0,
			'A broad topic must ask instead of creating unsolicited work.'
		)
		assert.match(separate.text, /\?/)
		const resultTasks = await tasks()
		assert.equal(resultTasks.length, 2)
		assert.equal(
			resultTasks.find((task) => task.title === 'Paint the cardboard observatory')?.status,
			'open'
		)
		assert.equal(resultTasks.find((task) => task.title === 'Label the velvet tray')?.status, 'done')
		const resumed = (
			await pool.query('SELECT record,journal_engine FROM aven_actor_runs.runs WHERE id=$1', [
				interrupted.id
			])
		).rows[0]
		assert.equal(resumed.journal_engine, interrupted.journal_engine)
		assert(resumed.record.attemptCount >= 2, 'Recovery must be a fresh execution attempt.')
		for (const step of completedSteps) {
			const row = (
				await pool.query(
					'SELECT ordinal,invocation_id,material_digest,value FROM aven_actor_runs.run_steps WHERE run_id=$1 AND ordinal=$2',
					[interrupted.id, step.ordinal]
				)
			).rows[0]
			assert.deepEqual(
				row,
				step,
				'Completed model/tool checkpoints must remain byte-equivalent on recovery.'
			)
			if (step.value.kind === 'model') {
				const metric = modelMetricsFromPayload(recoveredAnswer.payload).find(
					(value) => value.id === `${first.turnId}:model:${step.ordinal}`
				)
				assert(metric, 'Recovered response must retain its original model measurement.')
				assert.equal(metric.durationMs, step.value.timing.durationMs)
				assert.equal(metric.firstTextMs, step.value.timing.firstTextMs)
				assert.equal(metric.replayed, true)
			}
		}
		for (const command of commands) {
			assert.deepEqual(
				(
					await pool.query(
						'SELECT operation_id,receipt FROM aven_productivity.task_commands WHERE owner_subject_id=$1 AND operation_id=$2',
						[owner, command.operation_id]
					)
				).rows[0],
				command
			)
		}
		evidence.checks.push(
			'Actual process loss after saved task effects recovers with unchanged checkpoints and receipts; FIFO updates only the requested task.'
		)
		evidence.checks.push('A separate Spanish broad topic gets clarification without task effects.')
		const stable = await Promise.all([first, next, other].map(status))
		await control('actor-runner', 'stop')
		const budget = await admit(
			'Bitte berechne: 7 Schachteln mit je 18,30 EUR. Wie viel insgesamt? Sag knapp, was du gerechnet hast.',
			{ kind: 'new', title: 'Werkstattmaterial' },
			'de-DE'
		)
		await control('intent-service', 'stop')
		await control('intent-service', 'start')
		// A service health check is not proof its authenticated native route has
		// reconnected. Retry only this post-restart GET and retain every outage.
		let restartReadFailures = 0
		const ready = await until(
			async () => {
				const began = performance.now()
				try {
					const result = await status(budget)
					await observe({ event: 'post-restart-read-ready', durationMs: performance.now() - began })
					return result
				} catch (error) {
					if (
						!(error instanceof IntentWorkRequestError) ||
						!(error.code === 'NETWORK_UNAVAILABLE' || error.status === 502 || error.status === 503)
					)
						throw error
					restartReadFailures++
					await observe({
						event: 'post-restart-read-unavailable',
						durationMs: performance.now() - began,
						code: error.code,
						status: error.status ?? null
					})
					const diagnostic = await Promise.allSettled([
						request(`/api/environments/${environmentId}/intents/${budget.intentId}/turns`),
						pool.query(
							'SELECT application_name,state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database()'
						)
					])
					await observe({
						event: 'post-restart-read-diagnostic',
						results: diagnostic.map((value) =>
							value.status === 'fulfilled'
								? { ok: true, value: value.value.rows ?? value.value }
								: { ok: false, error: String(value.reason) }
						)
					})
					return undefined
				}
			},
			'authenticated status read after service restart',
			45_000,
			250
		)
		assert.equal(ready.state, 'queued')
		await control('actor-runner', 'start')
		const calculated = await answer(budget)
		assert.match(calculated.text, /128[,.]10/)
		assert(calculated.payload.toolCalls?.some((call) => call.name === 'calculate'))
		assert.deepEqual(await Promise.all([first, next, other].map(status)), stable)
		assert.deepEqual(await tasks(), resultTasks)
		const completed = await Promise.all([first, next, other, withdrawn, budget].map(status))
		const settledProgress = await Promise.all(
			[first, next, other, budget].map(async (turn) =>
				until(async () => {
					const current = await progress(turn)
					return current?.state === 'succeeded' ? current : undefined
				}, 'terminal progress')
			)
		)
		for (const current of settledProgress) {
			assert(
				current.steps.some((step) => step.kind === 'model' && (step.durationMs ?? 0) > 0),
				'Finishing a run must not overwrite its saved progress with a stale initial record.'
			)
		}
		assert(
			settledProgress
				.at(-1)!
				.steps.some((step) => step.name === 'calculate' && (step.durationMs ?? 0) > 0)
		)
		await options.reopenClient()
		assert.deepEqual(
			await Promise.all([first, next, other, withdrawn, budget].map(status)),
			completed
		)
		const reopenedProgress = await Promise.all([first, next, other, budget].map(progress))
		const saved = (value: TurnProgress | null) => {
			assert(value)
			const { observedAt: _observed, ...snapshot } = value
			return snapshot
		}
		assert.deepEqual(reopenedProgress.map(saved), settledProgress.map(saved))
		evidence.checks.push(
			'Native progress shows the running operation and original durations; reopening preserves every terminal projection except its read timestamp.'
		)
		evidence.checks.push(
			'A new signed-in native session reads the same completed answers and cancelled request after worker restarts.'
		)
		const copies = await pool.query(
			'SELECT turn_id,count(*)::int AS count FROM aven_intents.input_admissions GROUP BY turn_id'
		)
		assert(copies.rows.every((row) => row.count === 1))
		await observe({ event: 'finished', tasks: resultTasks, restartedCalculation: calculated.text })
		evidence.checks.push(
			'Both service processes restart; new queued calculation completes and old results stay unchanged.'
		)
		assert.equal(
			restartReadFailures,
			0,
			'A healthy restarted service must not leave native reads hanging. Diagnostics do not waive this gate.'
		)
		evidence.passed = true
	} catch (error) {
		evidence.error = String(error)
		if (error instanceof IntentWorkRequestError) {
			evidence.errorCode = error.code
			evidence.errorStatus = error.status
		}
		await observe({
			event: 'failed-state',
			runs: (await pool.query('SELECT id,state,record,journal_engine FROM aven_actor_runs.runs'))
				.rows,
			steps: (
				await pool.query(
					'SELECT run_id,ordinal,kind,state,value FROM aven_actor_runs.run_steps ORDER BY run_id,ordinal'
				)
			).rows,
			outbox: (
				await pool.query(
					'SELECT turn_id,intent_id,state,error_code,attempts,run_id FROM aven_intents.turn_outbox'
				)
			).rows
		})
		throw error
	} finally {
		evidence.finishedAt = new Date().toISOString()
		await pool.end()
		await save()
		// The owning run.sh always tears down this exact disposable project, including
		// stopped containers. Do not start workers again after a failed assertion.
	}
}
