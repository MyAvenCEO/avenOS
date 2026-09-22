import {
	CALCULATION_MANIFEST,
	createCalculationActor,
	createKnowledgeActor,
	KNOWLEDGE_MANIFEST,
	type PlanRunner,
	type TrustedActorInstallations
} from '@avenos/actors'
import type { ExecutionBinding, TenantGrantKey } from '@avenos/aven-customer-contracts'
import {
	type TenantPoolProvider,
	WorkerPlacementClient,
	WorkGrantClient
} from '@avenos/aven-customer-runtime'
import type { TurnContext } from '@avenos/intents/work'
import type { HttpLlmGatewayClient } from '@avenos/llm-client/http'
import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import type pg from 'pg'
import { ChatTurnHost } from './chat-host.js'
import { SqlChatJournal } from './chat-journal.js'
import { createServerChatModel } from './chat-model.js'
import { readReplacementActions, replacementActionsReady } from './chat-receipts.js'
import { createChatActorTools } from './chat-tools.js'
import { createHistoryActor } from './history-actor.js'
import { StudioArtifacts } from './studio-artifacts.js'
import type { StudioCatalogSource } from './studio-service.js'
import { TurnLifecycleClient } from './turn-lifecycle-client.js'
import { TurnWorkClient } from './turn-work-client.js'
import { createWorkArtifactPublisher, createWorkArtifactReader } from './work-artifacts.js'
import { createWorkStudioAuthoring } from './work-studio.js'
import { createWorkTaskRepository } from './work-tasks.js'

export interface BackgroundChatConfig {
	controlUrl: string
	exchangeToken: string
	intentUrl: string
	intentToken: string
	artifactUrl: string
	artifactToken: string
	runtimeId: string
	issuer: string
	publicKey: TenantGrantKey
	modelId: string
	engineDigest: string
}

/** The admitted screen references are data, not a new instruction stream. They
 * stay pinned on recovery; later selection changes cannot redirect this turn. */
export function backgroundChatContext(accepted: TurnContext): string {
	return [
		'Work only on the accepted request in this Intent. Use installed tools when needed; do not turn a broad topic into unsolicited work.',
		'The admitted references below identify what the user was looking at when submitting. They are not evidence of its contents; inspect the exact source when needed.',
		'A reference does not authorize publishing, executing or connecting a Skill. If a capability is unavailable, state that limit without claiming the action was done.',
		JSON.stringify({
			intentId: accepted.intentId,
			locale: accepted.input.locale,
			references: accepted.input.references
		})
	].join('\n')
}

/** Production wiring for the shared Chat host. All service destinations and
 * credentials are operator-owned; every tool obtains fresh, bounded work authority.
 * This deliberately does not enable child execution or Source control yet. */
export function createBackgroundChatHost(
	config: BackgroundChatConfig,
	scope: {
		environmentId: string
		generation: number
		worker: pg.Pool
	},
	runtime: {
		pools: Pick<TenantPoolProvider, 'forGrant'>
		workerPools: Pick<TenantPoolProvider, 'forGrant'>
		runner(): PlanRunner
		catalog: StudioCatalogSource
		installations: TrustedActorInstallations
		model: HttpLlmGatewayClient
	}
) {
	if (!/^[a-f0-9]{64}$/.test(config.engineDigest))
		throw Error('A pinned background Chat engine is required.')
	const placements = new WorkerPlacementClient({
		baseUrl: config.controlUrl,
		serviceToken: config.intentToken,
		runtimeId: config.runtimeId,
		issuer: config.issuer,
		publicKey: config.publicKey,
		componentRef: 'ceo.aven:component:data:intents@1'
	})
	const authority = (workToken: string, binding: ExecutionBinding) =>
		new WorkGrantClient({
			baseUrl: config.controlUrl,
			serviceToken: config.exchangeToken,
			runtimeId: config.runtimeId,
			issuer: config.issuer,
			publicKey: config.publicKey,
			workToken,
			binding
		})
	const turnClient = (workToken: string, binding: ExecutionBinding) => {
		const work = authority(workToken, binding)
		return new TurnWorkClient({
			baseUrl: config.intentUrl,
			headers: async (actions, signal) => ({
				authorization: `Bearer ${config.intentToken}`,
				'x-aven-work-grant': workToken,
				'x-aven-tenant-grant': await work.grant(
					'ceo.aven:component:data:intents@1',
					actions,
					signal
				)
			})
		})
	}
	const model = createServerChatModel(runtime.model, config.modelId)
	return new ChatTurnHost({
		environmentId: scope.environmentId,
		generation: scope.generation,
		issuer: config.issuer,
		publicKey: config.publicKey,
		lifecycle: new TurnLifecycleClient({
			baseUrl: config.intentUrl,
			serviceToken: config.intentToken,
			placement: (signal) => placements.proof(scope.environmentId, scope.generation, signal)
		}),
		client: async (token, binding) => turnClient(token, binding),
		journal: (lease) =>
			new SqlChatJournal(scope.worker, lease.runId, lease.ownerId, config.engineDigest),
		model: () => model,
		context: backgroundChatContext,
		priorActionsReady: (references) =>
			replacementActionsReady(
				scope.worker,
				{
					environmentId: scope.environmentId,
					routingGeneration: scope.generation
				},
				references
			),
		priorActions: (references) =>
			readReplacementActions(
				scope.worker,
				{
					environmentId: scope.environmentId,
					routingGeneration: scope.generation
				},
				references
			),
		tools: async ({ accepted, binding, workToken, work }, lease, signal) => {
			const delegated = authority(workToken, binding)
			const history = turnClient(workToken, binding)
			const template = createHistoryActor(history),
				historyManifest = template.manifest
			template.dispose()
			const artifactHost = {
				baseUrl: config.artifactUrl,
				serviceToken: config.artifactToken,
				environmentId: scope.environmentId,
				generation: scope.generation,
				issuer: config.issuer,
				publicKey: config.publicKey,
				authority: delegated,
				signal
			}
			const reader = createWorkArtifactReader(artifactHost)
			const artifacts = new StudioArtifacts(
				createWorkArtifactPublisher({ ...artifactHost, subjectId: work.sub }),
				scope.environmentId
			)
			const tasks = createWorkTaskRepository({
				baseUrl: config.intentUrl,
				serviceToken: config.intentToken,
				subjectId: work.sub,
				workToken,
				authority: delegated,
				signal
			})
			return createChatActorTools({
				assertActive: () => lease.assertActive(),
				context: (operationId) => ({
					operationId,
					signal,
					intentId: accepted.intentId,
					contributionId: accepted.contributionId
				}),
				actors: [
					{ manifest: historyManifest, create: () => createHistoryActor(history) },
					{ manifest: CALCULATION_MANIFEST, create: () => createCalculationActor() },
					{
						manifest: KNOWLEDGE_MANIFEST,
						create: () =>
							createKnowledgeActor((query) =>
								reader.library(
									scope.environmentId,
									query as Record<string, string | number | undefined>
								)
							)
					},
					{
						manifest: TASK_MANIFEST,
						create: (invocation) =>
							createTaskActor(tasks, () => ({
								ownerSubjectId: work.sub,
								operationId: invocation.operationId,
								intentId: accepted.intentId,
								contributionId: accepted.contributionId
							})),
						receipt: async (invocation) => {
							const receipt = await tasks.receipt(work.sub, invocation.operationId)
							if (!receipt) return null
							const record = JSON.stringify({ ok: true, mode: 'production', ...receipt })
							return { record, wire: record }
						}
					},
					createWorkStudioAuthoring({
						work,
						issuer: config.issuer,
						publicKey: config.publicKey,
						authority: delegated,
						pools: runtime.pools,
						workerPools: runtime.workerPools,
						artifacts,
						runner: runtime.runner(),
						catalog: runtime.catalog,
						installations: runtime.installations
					})
				]
			})
		}
	})
}
