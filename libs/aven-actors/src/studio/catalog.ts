import type { CapabilitySlot, MethodSpec } from '../actor'
import type {
	ActorAccessContext,
	ActorAuthorizer,
	ActorPrincipal,
	ActorAuthorizationDecision
} from '../authorization'
import type { ActorRegistrySnapshot, ExecutionEnvironment, RegisteredCapability } from '../registry'
import type { TrustedActorInstallation } from '../installations'
import { parseStudioPublicParametersSchema } from './v2'

export type StudioReadiness =
	| 'ready'
	| 'needs-input'
	| 'needs-connection'
	| 'needs-review'
	| 'needs-assurance'
	| 'host-unavailable'
	| 'contract-incomplete'
	| 'unsupported-runtime'

export interface StudioCatalogEntry {
	actorId: string
	capabilityId: string
	version: string
	installationDigest?: string
	label: string
	description: string
	tags: string[]
	mode: NonNullable<MethodSpec['mode']> | 'unspecified'
	parametersSchema: Record<string, unknown>
	inputs: StudioCatalogPort[]
	outputs: StudioCatalogPort[]
	requires: string[]
	produces: string[]
	placements: ExecutionEnvironment[]
	readiness: StudioReadiness
	reasonCodes: string[]
	canAuthor: boolean
	canPlan: boolean
	canInvokeNow: boolean
}

/** Public port projection. A complete non-secret port always has an exact Store type. */
export interface StudioCatalogPort {
	name: string
	predicate: string
	schema?: string
	role?: string
	cardinality: CapabilitySlot['cardinality']
	sensitive: boolean
	type?: { key: string; version: number }
}

export interface StudioCatalogActor {
	actorId: string
	version: string
	label: string
	description: string
	tags: string[]
	placements: ExecutionEnvironment[]
	visibleOperationCount: number
	kind: 'operations' | 'event-flow'
	canCompose: boolean
}

export interface StudioCatalogPage {
	contractVersion: 1
	catalogDigest: string
	/** Opaque binding to principal, session, assurance and access context. */
	authorityContext: string
	viewToken: string
	capturedAt: string
	expiresAt: string
	actors: StudioCatalogActor[]
	actorVisibleCount: number
	entries: StudioCatalogEntry[]
	visibleCount: number
	totalVisibleCount: number
	readyVisibleCount: number
	nextCursor: string | null
}

export interface StudioCatalogRequest {
	registry: ActorRegistrySnapshot
	principal: ActorPrincipal
	access: ActorAccessContext
	authorizer: ActorAuthorizer
	search?: string
	readyOnly?: boolean
	limit?: number
	cursor?: string
	viewToken?: string
	/** Supplied by the trusted host, never inferred from a manifest or caller input. */
	runtimeSupports?: (actorId: string, capabilityId: string) => boolean
	/** Trusted release installation; manifests or caller-provided digests are insufficient. */
	installationFor?: (actorId: string) => TrustedActorInstallation | undefined
}

interface CapturedView {
	owner: string
	search: string
	readyOnly: boolean
	catalogDigest: string
	capturedAt: string
	expiresAt: string
	actors: StudioCatalogActor[]
	entries: StudioCatalogEntry[]
}

/** Authorized presentation snapshots. No address or policy decision is serialized. */
export class StudioCatalog {
	readonly #views = new Map<string, CapturedView>()
	constructor(readonly now: () => Date = () => new Date()) {}

	async page(request: StudioCatalogRequest): Promise<StudioCatalogPage> {
		const limit = request.limit ?? 50
		if (!Number.isInteger(limit) || limit < 1 || limit > 100)
			throw new Error('CATALOG_INVALID_PAGE_SIZE')
		const owner = canonical({ principal: request.principal, access: request.access })
		const needle = (request.search ?? '').trim().toLowerCase().slice(0, 160)
		const readyOnly = request.readyOnly === true
		let token = request.viewToken
		let captured: CapturedView | undefined
		if (request.cursor || token) {
			if (!token) throw new Error('CATALOG_REFRESH_REQUIRED')
			captured = this.#views.get(token)
			if (
				!captured ||
				captured.owner !== owner ||
				captured.search !== needle ||
				captured.readyOnly !== readyOnly ||
				captured.expiresAt <= this.now().toISOString()
			)
				throw new Error('CATALOG_REFRESH_REQUIRED')
			// Pagination is a presentation snapshot, not a renewable discover grant.
			// A changed policy/placement/contract invalidates it before any stale entry is returned.
			if (
				canonical(await projectCatalog(request)) !==
				canonical({ actors: captured.actors, entries: captured.entries })
			)
				throw new Error('CATALOG_REFRESH_REQUIRED')
		} else {
			const projection = await projectCatalog(request)
			const capturedAt = this.now().toISOString()
			captured = {
				owner,
				search: needle,
				readyOnly,
				catalogDigest: await catalogViewDigest(projection),
				capturedAt,
				expiresAt: new Date(this.now().getTime() + 5 * 60_000).toISOString(),
				...projection
			}
			token = crypto.randomUUID()
			this.#views.set(token, captured)
			if (this.#views.size > 256) {
				const oldest = this.#views.keys().next().value
				if (oldest) this.#views.delete(oldest)
			}
		}
		const matching = needle
			? captured.entries.filter((entry) =>
					[entry.label, entry.description, entry.actorId, entry.capabilityId, ...entry.tags]
						.join('\n')
						.toLowerCase()
						.includes(needle)
				)
			: captured.entries
		const entries = readyOnly ? matching.filter((entry) => entry.readiness === 'ready') : matching
		const actors = needle
			? captured.actors.filter((actor) =>
					[actor.label, actor.description, actor.actorId, ...actor.tags]
						.join('\n')
						.toLowerCase()
						.includes(needle)
				)
			: captured.actors
		const offset = request.cursor ? Number(request.cursor) : 0
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length)
			throw new Error('CATALOG_REFRESH_REQUIRED')
		const next = offset + limit
		return {
			contractVersion: 1,
			catalogDigest: captured.catalogDigest,
			authorityContext: await sha256(owner),
			viewToken: token!,
			capturedAt: captured.capturedAt,
			expiresAt: captured.expiresAt,
			actors,
			actorVisibleCount: actors.length,
			entries: entries.slice(offset, next),
			visibleCount: entries.length,
			totalVisibleCount: matching.length,
			readyVisibleCount: matching.filter((entry) => entry.readiness === 'ready').length,
			nextCursor: next < entries.length ? String(next) : null
		}
	}
}

function completeContract(
	method: MethodSpec,
	capability: RegisteredCapability,
	installation: TrustedActorInstallation | undefined
): string[] {
	const reasons: string[] = []
	try {
		parseStudioPublicParametersSchema(method.parameters)
	} catch {
		reasons.push('PARAMETERS_SCHEMA_UNSUPPORTED')
	}
	if (!method.mode) reasons.push('MODE_UNDECLARED')
	if (!method.idempotency) reasons.push('RETRY_UNDECLARED')
	if (capability.requires.length && !method.inputSlots?.length)
		reasons.push('INPUT_PORTS_UNDECLARED')
	if (capability.produces.length && !method.outputSlots?.length)
		reasons.push('OUTPUT_PORTS_UNDECLARED')
	if (method.inputSlots?.some((slot) => !slot.sensitive && !slot.schema))
		reasons.push('INPUT_SCHEMA_UNDECLARED')
	if (method.outputSlots?.some((slot) => !slot.schema)) reasons.push('OUTPUT_SCHEMA_UNDECLARED')
	if (method.inputSlots?.some((slot) => !slot.role)) reasons.push('INPUT_ROLE_UNDECLARED')
	if (method.outputSlots?.some((slot) => !slot.role)) reasons.push('OUTPUT_ROLE_UNDECLARED')
	if (method.outputSlots?.some((slot) => slot.sensitive))
		reasons.push('PROTECTED_OUTPUT_UNSUPPORTED')
	if ([...(method.inputSlots ?? []), ...(method.outputSlots ?? [])].some((slot) =>
		!validPortShape(slot))) reasons.push('PORT_CONTRACT_INVALID')
	if (!capability.produces.length && !['view', 'effect', 'stream'].includes(method.mode ?? ''))
		reasons.push('NO_RESULT_CONTRACT')
	if (!installation) reasons.push('INSTALLATION_UNAVAILABLE')
	else {
		if (
			method.mode !== 'view' &&
			!installation.descriptor.procedures.some(
				(binding) => binding.capabilityId === capability.id
			)
		)
			reasons.push('PROCEDURE_UNDECLARED')
		for (const slot of [...(method.inputSlots ?? []), ...(method.outputSlots ?? [])])
			if (
				!slot.sensitive &&
				(!slot.schema ||
					!installation.descriptor.schemas.some((binding) => binding.schema === slot.schema))
			)
				reasons.push('STORE_SCHEMA_UNBOUND')
	}
	return [...new Set(reasons)]
}

function validPortShape(slot: CapabilitySlot): boolean {
	return (
		/^[a-z][a-z0-9_-]{0,63}$/.test(slot.name) &&
		(!slot.role || /^[a-z][a-z0-9_-]{0,63}$/.test(slot.role)) &&
		typeof slot.predicate === 'string' &&
		!!slot.predicate.trim() &&
		slot.predicate.length <= 256 &&
		(!slot.schema || slot.schema.length <= 160)
	)
}

function projectedPorts(
	slots: CapabilitySlot[] | undefined,
	installation: TrustedActorInstallation | undefined
): StudioCatalogPort[] {
	return (slots ?? []).map((slot) => {
		const store = slot.schema
			? installation?.descriptor.schemas.find((binding) => binding.schema === slot.schema)
			: undefined
		return {
			name: slot.name,
			predicate: slot.predicate,
			...(slot.schema && { schema: slot.schema }),
			...(slot.role && { role: slot.role }),
			cardinality: slot.cardinality,
			sensitive: slot.sensitive === true,
			...(store && { type: { key: store.typeKey, version: store.typeVersion } })
		}
	})
}

function safeDecisionReason(decision: ActorAuthorizationDecision): StudioReadiness {
	if (decision.allow) return 'ready'
	if (decision.reasonCode === 'NEEDS_ASSURANCE') return 'needs-assurance'
	if (decision.reasonCode === 'NEEDS_REVIEW') return 'needs-review'
	if (decision.reasonCode === 'NEEDS_CONNECTION') return 'needs-connection'
	return 'host-unavailable'
}

async function projectCatalog(request: StudioCatalogRequest): Promise<{
	actors: StudioCatalogActor[]
	entries: StudioCatalogEntry[]
}> {
	const entries: StudioCatalogEntry[] = []
	const { registry, principal, access, authorizer } = request
	for (const definition of registry.definitions) {
		for (const capability of definition.capabilities) {
			const method = definition.manifest.methods.find((item) => item.name === capability.method)
			if (!method) continue
			const discover = await authorizer.decide({
				action: 'discover',
				principal,
				access,
				definitionRef: definition.ref,
				capabilityId: capability.id,
				method: capability.method
			})
			if (!discover.allow) continue
			let installation = request.installationFor?.(definition.ref)
			if (
				installation &&
				canonical(installation.definition.manifest) !== canonical(definition.manifest)
			) {
				installation = undefined
			}
			const reasons = completeContract(method, capability, installation)
			const installationDigest = installation?.digest
			const placements = new Set<ExecutionEnvironment>()
			let denied: ActorAuthorizationDecision | null = null
			for (const instance of registry.instances) {
				if (
					instance.definitionRef !== definition.ref ||
					!instance.capabilityIds.includes(capability.id) ||
					instance.status !== 'available' ||
					(instance.expiresAt && instance.expiresAt <= registry.capturedAt)
				)
					continue
				const decision = await authorizer.decide({
					action: 'plan',
					principal,
					access,
					definitionRef: definition.ref,
					capabilityId: capability.id,
					method: capability.method,
					target: { kind: 'instance', instanceId: instance.instanceId }
				})
				if (decision.allow) placements.add(instance.executionEnvironment)
				else denied ??= decision
			}
			for (const offer of registry.offers) {
				if (offer.definitionRef !== definition.ref || !offer.capabilityIds.includes(capability.id))
					continue
				const decision = await authorizer.decide({
					action: 'plan',
					principal,
					access,
					definitionRef: definition.ref,
					capabilityId: capability.id,
					method: capability.method,
					target: { kind: 'factory', offerId: offer.offerId, factoryId: offer.factoryId },
					configuration: offer.defaultConfiguration ?? {}
				})
				if (decision.allow) placements.add(offer.executionEnvironment)
				else denied ??= decision
			}
			const mode = method.mode ?? 'unspecified'
			const runtimeSupported = request.runtimeSupports?.(definition.ref, capability.id) === true
			const readiness: StudioReadiness = reasons.length
				? 'contract-incomplete'
				: !runtimeSupported
					? 'unsupported-runtime'
					: placements.size
						? capability.requires.length
							? 'needs-input'
							: 'ready'
						: denied
							? safeDecisionReason(denied)
							: 'host-unavailable'
			entries.push({
				actorId: definition.ref,
				capabilityId: capability.id,
				version: definition.version,
				...(installationDigest && { installationDigest }),
				label: `${definition.label} · ${method.name.replaceAll('_', ' ')}`,
				description: method.description,
				tags: [...definition.tags],
				mode,
				parametersSchema: structuredClone(method.parameters),
				inputs: projectedPorts(method.inputSlots, installation),
				outputs: projectedPorts(method.outputSlots, installation),
				requires: [...capability.requires],
				produces: [...capability.produces],
				placements: [...placements].sort(),
				readiness,
				reasonCodes: reasons,
				canAuthor: !reasons.length,
				canPlan: !reasons.length && runtimeSupported && placements.size > 0,
				// Discovery has no exact inputs or fresh invocation authority.
				canInvokeNow: false
			})
		}
	}
	entries.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
	const actors: StudioCatalogActor[] = []
	for (const definition of registry.definitions) {
		const visible = entries.filter((entry) => entry.actorId === definition.ref)
		if (!visible.length && definition.capabilities.length) continue
		if (!definition.capabilities.length) {
			const discover = await authorizer.decide({
				action: 'discover',
				principal,
				access,
				definitionRef: definition.ref
			})
			if (!discover.allow) continue
		}
		const placements = new Set<ExecutionEnvironment>()
		for (const instance of registry.instances)
			if (
				instance.definitionRef === definition.ref &&
				instance.status === 'available' &&
				(!instance.expiresAt || instance.expiresAt > registry.capturedAt)
			)
				placements.add(instance.executionEnvironment)
		for (const offer of registry.offers)
			if (offer.definitionRef === definition.ref) placements.add(offer.executionEnvironment)
		actors.push({
			actorId: definition.ref,
			version: definition.version,
			label: definition.label,
			description: definition.description,
			tags: [...definition.tags],
			placements: [...placements].sort(),
			visibleOperationCount: visible.length,
			kind: visible.length ? 'operations' : 'event-flow',
			canCompose: visible.some((entry) => entry.canAuthor)
		})
	}
	actors.sort((a, b) => a.actorId.localeCompare(b.actorId))
	return { actors, entries }
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`
	return JSON.stringify(value)
}

async function catalogViewDigest(projection: {
	actors: StudioCatalogActor[]
	entries: StudioCatalogEntry[]
}): Promise<string> {
	const contracts = projection.entries.map(
		({
			actorId,
			capabilityId,
			version,
			installationDigest,
			label,
			description,
			tags,
			mode,
			parametersSchema,
			inputs,
			outputs,
			requires,
			produces
		}) => ({
			actorId,
			capabilityId,
			version,
			installationDigest,
			label,
			description,
			tags,
			mode,
			parametersSchema,
			inputs,
			outputs,
			requires,
			produces
		})
	)
	return sha256(canonical({ actors: projection.actors, entries: contracts }))
}

async function sha256(source: string): Promise<string> {
	const bytes = new TextEncoder().encode(source)
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
	return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Stable descriptor identity; availability and process-local revisions are excluded. */
export async function actorCatalogDigest(registry: ActorRegistrySnapshot): Promise<string> {
	const definitions = [...registry.definitions]
		.sort((a, b) => a.ref.localeCompare(b.ref))
		.map(({ ref, version, manifest, capabilities }) => ({ ref, version, manifest, capabilities }))
	return sha256(canonical(definitions))
}

/** Digest only the selected installed contracts; unrelated Actors and availability do not affect a saved route. */
export async function selectedActorContractDigest(
	registry: ActorRegistrySnapshot,
	capabilityIds: readonly string[]
): Promise<string> {
	const selected = new Set(capabilityIds)
	const contracts = registry.definitions.flatMap((definition) =>
		definition.capabilities
			.filter((capability) => selected.has(capability.id))
			.map((capability) => ({
				definitionRef: definition.ref,
				version: definition.version,
				capability,
				method: definition.manifest.methods.find((method) => method.name === capability.method)
			}))
	)
	if (contracts.length !== selected.size) throw new Error('SELECTED_CONTRACT_UNAVAILABLE')
	contracts.sort((left, right) => left.capability.id.localeCompare(right.capability.id))
	return sha256(canonical(contracts))
}
