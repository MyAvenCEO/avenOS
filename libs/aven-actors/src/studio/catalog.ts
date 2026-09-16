import type { CapabilitySlot, MethodSpec } from '../actor'
import type {
	ActorAccessContext,
	ActorAuthorizer,
	ActorPrincipal,
	ActorAuthorizationDecision
} from '../authorization'
import type { ActorRegistrySnapshot, ExecutionEnvironment, RegisteredCapability } from '../registry'

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
	label: string
	description: string
	tags: string[]
	mode: NonNullable<MethodSpec['mode']> | 'unspecified'
	parametersSchema: Record<string, unknown>
	inputs: CapabilitySlot[]
	outputs: CapabilitySlot[]
	requires: string[]
	produces: string[]
	placements: ExecutionEnvironment[]
	readiness: StudioReadiness
	reasonCodes: string[]
	canAuthor: boolean
	canPlan: boolean
	canInvokeNow: boolean
}

export interface StudioCatalogPage {
	contractVersion: 1
	catalogDigest: string
	viewToken: string
	capturedAt: string
	expiresAt: string
	entries: StudioCatalogEntry[]
	visibleCount: number
	nextCursor: string | null
}

export interface StudioCatalogRequest {
	registry: ActorRegistrySnapshot
	principal: ActorPrincipal
	access: ActorAccessContext
	authorizer: ActorAuthorizer
	search?: string
	limit?: number
	cursor?: string
	viewToken?: string
	/** Supplied by the trusted host, never inferred from a manifest or caller input. */
	runtimeSupports?: (actorId: string, capabilityId: string) => boolean
}

interface CapturedView {
	owner: string
	search: string
	catalogDigest: string
	capturedAt: string
	expiresAt: string
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
		const owner = `${request.access.tenantId ?? ''}\0${request.principal.subjectId}\0${request.principal.sessionId ?? ''}`
		const needle = (request.search ?? '').trim().toLowerCase().slice(0, 160)
		let token = request.viewToken
		let captured: CapturedView | undefined
		if (request.cursor || token) {
			if (!token) throw new Error('CATALOG_REFRESH_REQUIRED')
			captured = this.#views.get(token)
			if (
				!captured ||
				captured.owner !== owner ||
				captured.search !== needle ||
				captured.expiresAt <= this.now().toISOString()
			)
				throw new Error('CATALOG_REFRESH_REQUIRED')
		} else {
			const entries = await projectCatalog(request)
			const capturedAt = this.now().toISOString()
			captured = {
				owner,
				search: needle,
				catalogDigest: await catalogViewDigest(entries),
				capturedAt,
				expiresAt: new Date(this.now().getTime() + 5 * 60_000).toISOString(),
				entries
			}
			token = crypto.randomUUID()
			this.#views.set(token, captured)
			if (this.#views.size > 256) {
				const oldest = this.#views.keys().next().value
				if (oldest) this.#views.delete(oldest)
			}
		}
		const entries = needle
			? captured.entries.filter((entry) =>
					[entry.label, entry.description, entry.actorId, entry.capabilityId, ...entry.tags]
						.join('\n')
						.toLowerCase()
						.includes(needle)
				)
			: captured.entries
		const offset = request.cursor ? Number(request.cursor) : 0
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length)
			throw new Error('CATALOG_REFRESH_REQUIRED')
		const next = offset + limit
		return {
			contractVersion: 1,
			catalogDigest: captured.catalogDigest,
			viewToken: token!,
			capturedAt: captured.capturedAt,
			expiresAt: captured.expiresAt,
			entries: entries.slice(offset, next),
			visibleCount: entries.length,
			nextCursor: next < entries.length ? String(next) : null
		}
	}
}

function completeContract(method: MethodSpec, capability: RegisteredCapability): string[] {
	const reasons: string[] = []
	if (!method.mode) reasons.push('MODE_UNDECLARED')
	if (!method.idempotency) reasons.push('RETRY_UNDECLARED')
	if (capability.requires.length && !method.inputSlots?.length)
		reasons.push('INPUT_PORTS_UNDECLARED')
	if (capability.produces.length && !method.outputSlots?.length)
		reasons.push('OUTPUT_PORTS_UNDECLARED')
	if (method.inputSlots?.some((slot) => !slot.schema)) reasons.push('INPUT_SCHEMA_UNDECLARED')
	if (method.outputSlots?.some((slot) => !slot.schema)) reasons.push('OUTPUT_SCHEMA_UNDECLARED')
	if (method.inputSlots?.some((slot) => !slot.role)) reasons.push('INPUT_ROLE_UNDECLARED')
	if (method.outputSlots?.some((slot) => !slot.role)) reasons.push('OUTPUT_ROLE_UNDECLARED')
	if (!capability.produces.length && !['view', 'effect', 'stream'].includes(method.mode ?? ''))
		reasons.push('NO_RESULT_CONTRACT')
	return reasons
}

function safeDecisionReason(decision: ActorAuthorizationDecision): StudioReadiness {
	if (decision.allow) return 'ready'
	if (decision.reasonCode === 'NEEDS_ASSURANCE') return 'needs-assurance'
	if (decision.reasonCode === 'NEEDS_REVIEW') return 'needs-review'
	if (decision.reasonCode === 'NEEDS_CONNECTION') return 'needs-connection'
	return 'host-unavailable'
}

async function projectCatalog(request: StudioCatalogRequest): Promise<StudioCatalogEntry[]> {
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
			const reasons = completeContract(method, capability)
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
				label: `${definition.label} · ${method.name.replaceAll('_', ' ')}`,
				description: method.description,
				tags: [...definition.tags],
				mode,
				parametersSchema: structuredClone(method.parameters),
				inputs: structuredClone(method.inputSlots ?? []),
				outputs: structuredClone(method.outputSlots ?? []),
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
	return entries.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
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

async function catalogViewDigest(entries: StudioCatalogEntry[]): Promise<string> {
	const contracts = entries.map(
		({
			actorId,
			capabilityId,
			version,
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
	return sha256(canonical(contracts))
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
