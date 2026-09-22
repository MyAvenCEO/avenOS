import {
	type ActorCallContext,
	ActorCommandRejected,
	type PlanRunner,
	type PlanRunSecurityContext,
	type TrustedActorInstallations
} from '@avenos/actors'
import { publicationReceipt, StudioActor } from '@avenos/actors/studio/agent'
import { describeSavedStudioDraft } from '@avenos/actors/studio/author'
import { isStudioReadOperation } from '@avenos/actors/studio/operations'
import {
	type TenantGrantClaims,
	type TenantGrantKey,
	verifyTenantGrant,
	type WorkGrantClaims
} from '@avenos/aven-customer-contracts'
import { WorkAuthorizationError, type WorkGrantClient } from '@avenos/aven-customer-runtime'
import { toolResultFailed } from '@avenos/chat-engine/tool-call'
import type pg from 'pg'
import { ZodError, z } from 'zod'
import type { ChatActorBinding } from './chat-tools.js'
import { commandValidationFailure } from './command-errors.js'
import type { StudioArtifacts } from './studio-artifacts.js'
import { StudioCases } from './studio-cases.js'
import { readDraftReceipt } from './studio-draft-receipts.js'
import { studioFailure } from './studio-errors.js'
import { type StudioCatalogSource, StudioService } from './studio-service.js'
import { StudioV2Drafts } from './studio-v2-drafts.js'
import { assertWorkLease } from './work-lease.js'

// Capability gating, not another Studio implementation. Starting asynchronous
// children or managing Sources needs parent-work lifetime controls first. Human
// confirmation remains a UI action; the agent cannot confirm its own proposed case.
const authoringTools = new Set([
	'studio_items',
	'studio_case_propose',
	'studio_case_revise',
	'studio_case_what_if',
	'studio_case_build',
	'studio_author',
	'studio_catalog',
	'studio_present',
	'studio_state',
	'studio_explore',
	'studio_inspect',
	'studio_publish',
	'studio_run_status'
])
const authoringRequests = new Set([
	'items',
	'case-propose',
	'case-what-if',
	'case-build',
	'catalog',
	'present',
	'state',
	'explore',
	'inspect',
	'preview',
	'compare',
	'draft',
	'publish',
	'run-status'
])

/** Background authoring uses the same Actor, compiler and Store as the editor.
 * Every subrequest rechecks live authority, including the write after a catalog
 * read. The supplied Store must use the execution-bound publication transport.
 * Draft edits recover their atomic revision receipts. Skill publications recover
 * only an exact immutable Store commit. Missing receipts remain uncertain.
 */
export function createWorkStudioAuthoring(host: {
	work: WorkGrantClaims
	issuer: string
	publicKey: TenantGrantKey
	authority: WorkGrantClient
	pools: { forGrant(grant: TenantGrantClaims): Promise<pg.Pool> }
	workerPools: { forGrant(grant: TenantGrantClaims): Promise<pg.Pool> }
	artifacts: StudioArtifacts
	runner: PlanRunner
	catalog: StudioCatalogSource
	installations: TrustedActorInstallations
}): ChatActorBinding {
	if (host.artifacts.scope !== host.work.environmentId)
		throw Error('Studio workspace does not match its host.')
	const authorize = async (readOnly: boolean, signal?: AbortSignal) => {
		signal?.throwIfAborted()
		const action = readOnly ? 'actor-runs:read' : 'actor-runs:write'
		const component = 'os.aven:component:actors:run-repository@1'
		const token = await host.authority.grant(component, [action], signal)
		const grant = await verifyTenantGrant(token, host.publicKey, {
			issuer: host.issuer,
			audience: component,
			action
		})
		if (
			!grant.execution ||
			grant.environmentId !== host.work.environmentId ||
			grant.sub !== host.work.sub ||
			grant.routingGeneration !== host.work.routingGeneration ||
			grant.exp <= Date.now() / 1000
		)
			throw Error('Studio work authority does not match this conversation.')
		const pool = await host.pools.forGrant(grant)
		await assertWorkLease(pool, host.work, grant.execution)
		signal?.throwIfAborted()
		return { pool, grant, execution: grant.execution }
	}
	const create = (recoverCase = false) =>
		new StudioActor(
			async <T>(operation: string, data: Record<string, unknown>, context?: ActorCallContext) => {
				if (!authoringRequests.has(operation))
					throw Error('This host does not authorize execution or Source controls yet.')
				try {
					context?.signal?.throwIfAborted()
					if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024)
						throw Error('Studio request exceeds its bound.')
					const readOnly = isStudioReadOperation(operation)
					if (recoverCase && !readOnly && operation !== 'case-propose')
						throw Error('Case recovery only inspects immutable receipts.')
					const { pool, grant, execution } = await authorize(
						readOnly || recoverCase,
						context?.signal
					)
					if (recoverCase && operation === 'case-propose') {
						const d = z
							.object({ case: z.unknown(), predecessorArtifactId: z.uuid().optional() })
							.strict()
							.parse(data)
						return (await new StudioCases(host.artifacts).recoverProposal(
							d.case,
							grant.sub,
							d.predecessorArtifactId
						)) as T
					}
					const security: PlanRunSecurityContext = {
						principal: {
							subjectId: grant.sub,
							sessionId: grant.sid,
							kind: 'user',
							assurance: ['work-certificate']
						},
						access: { tenantId: grant.environmentId },
						establishedBy: 'api.aven.ceo/work-exchange',
						authorizedAt: new Date().toISOString()
					}
					let drafts: StudioV2Drafts | undefined
					if (operation === 'draft' || operation === 'case-build' || operation === 'publish') {
						if (!context?.operationId)
							throw Error('A journaled invocation is required for a draft change.')
						drafts = new StudioV2Drafts(await host.workerPools.forGrant(grant), {
							work: host.work,
							execution,
							invocationId: context.operationId
						})
					}
					const result = await new StudioService(
						pool,
						host.artifacts,
						host.runner,
						host.catalog,
						host.installations,
						drafts
					).call({ operation, data }, security, {}, readOnly)
					if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
						throw Error('Studio result exceeds its bound.')
					return result as T
				} catch (error) {
					context?.signal?.throwIfAborted()
					if (error instanceof WorkAuthorizationError) throw error
					const failure = studioFailure(error)
					const problem =
						failure?.problem ??
						(error instanceof ZodError ? commandValidationFailure(error) : undefined)
					if (failure?.effect === 'not-applied')
						throw new ActorCommandRejected(
							JSON.stringify({
								...problem,
								next: 'This command made no change. Read studio_state and use the exact draft id and revision from its result. Never guess or splice identifiers.'
							})
						)
					throw Error(
						problem
							? JSON.stringify(problem)
							: 'Studio could not complete this request. Inspect the saved state before retrying a change.'
					)
				}
			}
		)
	const template = create()
	const manifest = {
		...template.manifest,
		description:
			'Explore, create, refine and publish Skills. This background host does not yet start Skills or manage automatic Sources.',
		methods: template.manifest.methods.filter((method) => authoringTools.has(method.name))
	}
	template.dispose()
	if (manifest.methods.length !== authoringTools.size)
		throw Error('Studio authoring capabilities do not match the installed Actor.')
	return {
		manifest,
		create: () => create(),
		async receipt(context, name, args) {
			if (name === 'studio_case_propose' || name === 'studio_case_revise') {
				// Run the same Actor's parsing and predecessor-relative edit logic, with a
				// host transport that permits only reads and exact receipt lookup. No
				// publication, self-confirmation or new mutable authoring can occur here.
				const actor = create(true)
				try {
					const result = await actor.deliver(name, JSON.parse(args), context)
					if (result.outcome === 'uncertain' || toolResultFailed(result.record))
						throw Error('The interrupted case proposal still needs reconciliation.')
					return result.record === 'null' ? null : result
				} finally {
					actor.dispose()
				}
			}
			const {
				pool: apiPool,
				grant,
				execution
			} = await authorize(name !== 'studio_publish', context.signal)
			const pool = await host.workerPools.forGrant(grant)
			await assertWorkLease(pool, host.work, execution)
			if (name === 'studio_publish') {
				const { id, revision } = z
					.object({ id: z.uuid(), revision: z.number().int().positive() })
					.strict()
					.parse(JSON.parse(args))
				const drafts = new StudioV2Drafts(pool, {
					work: host.work,
					execution,
					invocationId: context.operationId
				})
				const service = new StudioService(
					apiPool,
					host.artifacts,
					host.runner,
					host.catalog,
					host.installations,
					drafts
				)
				const security: PlanRunSecurityContext = {
					principal: {
						subjectId: grant.sub,
						sessionId: grant.sid,
						kind: 'user',
						assurance: ['work-certificate']
					},
					access: { tenantId: grant.environmentId },
					establishedBy: 'api.aven.ceo/work-exchange',
					authorizedAt: new Date().toISOString()
				}
				const recovered = await service.authoring!.recoverPublication(id, revision, security)
				if (!recovered) return null
				const record = JSON.stringify({
					...(publicationReceipt(recovered) as object),
					recovered: true,
					publishedDraftRevision: revision,
					headUpdated: recovered.headUpdated,
					next: recovered.headUpdated
						? 'The exact Skill publication and its saved draft head were recovered. Do not publish it again.'
						: 'This exact revision was published, but its draft changed. The newer draft was not overwritten. Inspect current state before another edit or publication.'
				})
				return { record, wire: record }
			}
			const saved = await readDraftReceipt(pool, {
				work: host.work,
				execution,
				invocationId: context.operationId
			})
			if (!saved) return null
			const record = JSON.stringify({
				...describeSavedStudioDraft(saved),
				recovered: true,
				next: 'This exact revision was saved by the interrupted call; do not repeat it. It may no longer be the current head. Read studio_state before any further edit or publication.'
			})
			return { record, wire: record }
		}
	}
}
