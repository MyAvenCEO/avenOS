import type { PlanRunExecutionContext, PlanRunRecord, PlanRunStartRequest } from '@avenos/actors'
import {
	type ExecutionBinding,
	type TenantGrantKey,
	verifyWorkGrant,
	type WorkGrantClaims
} from '@avenos/aven-customer-contracts'
import { readInputAdmission } from '@avenos/chat-engine/input-admission'
import type { TurnJournal } from '@avenos/chat-engine/journal'
import type { ModelStream } from '@avenos/chat-engine/model'
import { capturePriorActions, type PriorActionReceipt } from '@avenos/chat-engine/prior-actions'
import { anonymousSpeakerFromPayload } from '@avenos/chat-engine/speaker'
import { callsFromPayload } from '@avenos/chat-engine/turn-payload'
import { admissionDigest } from '@avenos/intents/admission'
import type { TurnContext, TurnRunReference } from '@avenos/intents/work'
import { CHAT_TURN_SKILL, type ChatTurnSession, chatTurnParameters } from './chat-executor.js'
import type { TurnLifecycleClient } from './turn-lifecycle-client.js'
import type { TurnWorkClient } from './turn-work-client.js'

type Lease = NonNullable<PlanRunExecutionContext['lease']>
type Tools = Pick<ChatTurnSession, 'specs' | 'execute' | 'resolve'>
export interface HostedTurn {
	accepted: TurnContext
	work: WorkGrantClaims
	workToken: string
	binding: ExecutionBinding
}

/** Service composition for the one shared Chat engine. Tool implementations come
 * from installed Actors; this class owns only exact input, identity and recovery
 * binding. Secrets remain host arguments, never Chat context or tool parameters.
 */
export class ChatTurnHost {
	constructor(
		private readonly host: {
			environmentId: string
			generation: number
			issuer: string
			publicKey: TenantGrantKey
			lifecycle: TurnLifecycleClient
			client(workToken: string, binding: ExecutionBinding): Promise<TurnWorkClient>
			journal(lease: Lease): TurnJournal & { startedAt(): Promise<string> }
			model(turnId: string): ModelStream
			tools(turn: HostedTurn, lease: Lease, signal?: AbortSignal): Promise<Tools>
			context(accepted: TurnContext): string
			priorActions(references: TurnRunReference[]): Promise<PriorActionReceipt[]>
			priorActionsReady(references: TurnRunReference[]): Promise<boolean>
		}
	) {}

	private reference(request: Pick<PlanRunStartRequest, 'parameters' | 'security'>, runId: string) {
		if (request.security.access.tenantId !== this.host.environmentId)
			throw Error('The admitted turn belongs to another environment.')
		return {
			...chatTurnParameters.parse(request.parameters),
			runId,
			subjectId: request.security.principal.subjectId
		}
	}

	async ready(record: PlanRunRecord): Promise<boolean | 'ended'> {
		if (record.skillRef !== CHAT_TURN_SKILL) return true
		const state = await this.host.lifecycle.inspect(this.reference(record, record.runId))
		if (state.state === 'ended') return 'ended'
		if (state.state === 'ready' && !(await this.host.priorActionsReady(state.replacedRuns)))
			return false
		return ['ready', 'completed', 'failed'].includes(state.state)
	}

	async completion(request: PlanRunStartRequest, lease: Lease) {
		await lease.assertActive()
		const state = await this.host.lifecycle.inspect(this.reference(request, lease.runId))
		if (state.state === 'completed' || state.state === 'failed') return state
		if (state.state !== 'ready') throw Error('This turn is not ready to execute.')
		return null
	}

	async open(
		request: PlanRunStartRequest,
		lease: Lease,
		signal?: AbortSignal
	): Promise<ChatTurnSession> {
		signal?.throwIfAborted()
		await lease.assertActive()
		const reference = this.reference(request, lease.runId)
		const resumed = await this.host.lifecycle.inspect(reference, 'resume', signal)
		if (resumed.state !== 'ready' || !resumed.workGrant)
			throw Error('This turn no longer authorizes work.')
		const work = await verifyWorkGrant(resumed.workGrant, this.host.publicKey, this.host.issuer)
		if (
			work.sub !== reference.subjectId ||
			work.sid !== request.security.principal.sessionId ||
			work.environmentId !== this.host.environmentId ||
			work.routingGeneration !== this.host.generation ||
			work.inputId !== reference.inputId ||
			work.inputRevision !== reference.inputRevision ||
			work.materialDigest !== reference.materialDigest
		)
			throw Error('Turn authority does not match its admitted run.')
		const binding = {
			workId: work.jti,
			turnId: reference.turnId,
			runId: lease.runId,
			leaseOwnerId: lease.ownerId
		}
		const client = await this.host.client(resumed.workGrant, binding)
		const accepted = await client.context(signal)
		if (
			accepted.turnId !== reference.turnId ||
			(await admissionDigest(accepted.input)) !== reference.materialDigest ||
			(accepted.input.target.kind === 'existing' && accepted.input.target.id !== accepted.intentId)
		)
			throw Error('Turn context does not match its accepted input.')
		await lease.assertActive()
		const priorActions = capturePriorActions(await this.host.priorActions(accepted.replacedRuns))
		await lease.assertActive()
		const journal = this.host.journal(lease)
		const tools = await this.host.tools(
			{ accepted, work, workToken: resumed.workGrant, binding },
			lease,
			signal
		)
		const assertActive = async (callSignal = signal) => {
			callSignal?.throwIfAborted()
			await lease.assertActive()
			await client.assertActive(callSignal)
		}
		const model = this.host.model(reference.turnId)
		return {
			...tools,
			journal,
			// A live runner lease alone is insufficient after an Intent is archived,
			// revoked or expired. Recheck before model cost as well as tool execution.
			model: async function* (messages, specs, callSignal, modelId, options) {
				await assertActive(callSignal)
				yield* model(messages, specs, callSignal, modelId, options)
			},
			execute: async (...args) => {
				await assertActive()
				return tools.execute(...args)
			},
			resolve: async (...args) => {
				await assertActive()
				return tools.resolve(...args)
			},
			input: {
				turnId: reference.turnId,
				intentId: accepted.intentId,
				priorActions,
				user: {
					id: accepted.contributionId,
					role: 'user',
					content: accepted.input.text,
					...(accepted.input.speaker && { anonymousSpeaker: accepted.input.speaker }),
					inputAdmission: {
						intentId: accepted.intentId,
						destination: accepted.input.target.kind,
						confirmed: accepted.input.confirmed,
						...(accepted.input.sourceContext && { sourceContext: accepted.input.sourceContext }),
						...(accepted.input.responseMode && { responseMode: accepted.input.responseMode })
					}
				},
				history: accepted.history.contributions
					.filter((c) => c.kind === 'message' && ['human', 'agent'].includes(c.contributor_kind))
					.map((c) => ({
						id: c.id,
						role: c.contributor_kind === 'human' ? ('user' as const) : ('assistant' as const),
						content: c.text ?? '',
						calls: callsFromPayload(c.payload),
						inputAdmission: readInputAdmission({
							...((c.payload.inputAdmission as object) ?? {}),
							...(c.work_state && { workState: c.work_state })
						}),
						anonymousSpeaker: anonymousSpeakerFromPayload(c.payload) ?? undefined
					})),
				context:
					this.host.context(accepted) +
					(accepted.history.hasMore
						? '\nRecent conversation context is incomplete. Use available history retrieval when needed; do not infer absence from this window.'
						: ''),
				startedAt: await journal.startedAt(),
				timezone: accepted.input.timezone
			},
			publish: async (output) => {
				await lease.assertActive()
				return client.finish(JSON.parse(JSON.stringify(output)), signal)
			}
		}
	}
}
