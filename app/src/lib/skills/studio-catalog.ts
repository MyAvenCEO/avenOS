import {
	StudioCatalog,
	type ActorAuthorizer,
	type StudioCatalogActor,
	type StudioCatalogEntry,
	type StudioCatalogPage
} from '@avenos/actors'
import { bus } from '$lib/actors/bus'

type CatalogData = {
	search?: string
	readyOnly?: boolean
	limit?: number
	cursor?: string
	viewToken?: string
}
type RemoteRequest = <T>(operation: string, data: Record<string, unknown>) => Promise<T>
type Projection = {
	actors: StudioCatalogActor[]
	entries: StudioCatalogEntry[]
	catalogDigest: string
	authorityContext: string
	capturedAt: string
	expiresAt: string
}
type Captured = Projection & { search: string; readyOnly: boolean }

const localCatalog = new StudioCatalog()
const views = new Map<string, Captured>()
const localPrincipal = {
	subjectId: crypto.randomUUID(),
	kind: 'user' as const,
	assurance: ['native-session'],
	sessionId: crypto.randomUUID()
}
const localAuthorizer: ActorAuthorizer = {
	decide: (request) =>
		request.action === 'discover'
			? { allow: true, decisionId: 'native-discover' }
			: { allow: false, decisionId: 'native-plan-unbound', reasonCode: 'CLIENT_EXECUTION_UNBOUND' }
}

/** One visual/agent inventory over the authorized server and this live native mesh. */
export async function combinedStudioCatalog(
	data: Record<string, unknown>,
	remote: RemoteRequest
): Promise<StudioCatalogPage> {
	const request = parse(data)
	const search = (request.search ?? '').trim().toLowerCase()
	const readyOnly = request.readyOnly === true
	const limit = request.limit ?? 50
	let captured: Captured
	let token = request.viewToken
	if (request.cursor || token) {
		if (!token) throw new Error('CATALOG_REFRESH_REQUIRED')
		const prior = views.get(token)
		if (
			!prior ||
			prior.search !== search ||
			prior.readyOnly !== readyOnly ||
			prior.expiresAt <= new Date().toISOString()
		)
			throw new Error('CATALOG_REFRESH_REQUIRED')
		const current = await project(search, remote)
		if (
			current.catalogDigest !== prior.catalogDigest ||
			current.authorityContext !== prior.authorityContext ||
			JSON.stringify({ actors: current.actors, entries: current.entries }) !==
				JSON.stringify({ actors: prior.actors, entries: prior.entries })
		)
			throw new Error('CATALOG_REFRESH_REQUIRED')
		captured = prior
	} else {
		const projection = await project(search, remote)
		captured = { ...projection, search, readyOnly }
		token = crypto.randomUUID()
		views.set(token, captured)
		if (views.size > 64) {
			const oldest = views.keys().next().value
			if (oldest) views.delete(oldest)
		}
	}
	const entries = readyOnly
		? captured.entries.filter((entry) => entry.readiness === 'ready')
		: captured.entries
	const offset = request.cursor ? Number(request.cursor) : 0
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length)
		throw new Error('CATALOG_REFRESH_REQUIRED')
	const next = offset + limit
	return {
		contractVersion: 1,
		catalogDigest: captured.catalogDigest,
		authorityContext: captured.authorityContext,
		viewToken: token!,
		capturedAt: captured.capturedAt,
		expiresAt: captured.expiresAt,
		actors: captured.actors,
		actorVisibleCount: captured.actors.length,
		entries: entries.slice(offset, next),
		visibleCount: entries.length,
		totalVisibleCount: captured.entries.length,
		readyVisibleCount: captured.entries.filter((entry) => entry.readiness === 'ready').length,
		nextCursor: next < entries.length ? String(next) : null
	}
}

async function project(search: string, remote: RemoteRequest): Promise<Projection> {
	const server = await collect((data) => remote<StudioCatalogPage>('catalog', data), search)
	const local = await collect(
		(data) =>
			localCatalog.page({
				registry: bus.registry.snapshot(),
				principal: localPrincipal,
				access: { tenantId: 'native-session' },
				authorizer: localAuthorizer,
				search: String(data.search ?? ''),
				limit: Number(data.limit ?? 100),
				...(data.cursor ? { cursor: String(data.cursor) } : {}),
				...(data.viewToken ? { viewToken: String(data.viewToken) } : {}),
				installationFor: () => undefined,
				runtimeSupports: () => false
			}),
		search
	)
	const entries = mergeEntries(server.entries, local.entries)
	const actors = mergeActors(server.actors, local.actors)
	const capturedAt = server.capturedAt > local.capturedAt ? server.capturedAt : local.capturedAt
	const expiresAt = server.expiresAt < local.expiresAt ? server.expiresAt : local.expiresAt
	return {
		actors,
		entries,
		catalogDigest: await digest(`${server.catalogDigest}\0${local.catalogDigest}`),
		authorityContext: await digest(
			`${server.authorityContext}\0${local.authorityContext}\0${localPrincipal.sessionId}`
		),
		capturedAt,
		expiresAt
	}
}

async function collect(
	request: (data: Record<string, unknown>) => Promise<StudioCatalogPage>,
	search: string
): Promise<Projection> {
	const entries: StudioCatalogEntry[] = []
	let page = await request({ search, readyOnly: false, limit: 100 })
	const actors = page.actors ?? []
	const digest = page.catalogDigest
	const authorityContext = page.authorityContext
	const capturedAt = page.capturedAt
	const expiresAt = page.expiresAt
	entries.push(...page.entries)
	while (page.nextCursor) {
		if (entries.length >= 1000) throw new Error('CATALOG_TOO_LARGE')
		page = await request({
			search,
			readyOnly: false,
			limit: 100,
			cursor: page.nextCursor,
			viewToken: page.viewToken
		})
		if (page.catalogDigest !== digest || page.authorityContext !== authorityContext)
			throw new Error('CATALOG_REFRESH_REQUIRED')
		entries.push(...page.entries)
	}
	return { actors, entries, catalogDigest: digest, authorityContext, capturedAt, expiresAt }
}

/** Authentication/environment changes call this before another catalog page is shown. */
export function resetCombinedStudioCatalog(): void {
	views.clear()
}

function mergeEntries(
	left: StudioCatalogEntry[],
	right: StudioCatalogEntry[]
): StudioCatalogEntry[] {
	const values = new Map(left.map((value) => [value.capabilityId, value]))
	const rank = [
		'ready',
		'needs-input',
		'needs-review',
		'needs-connection',
		'needs-assurance',
		'host-unavailable',
		'unsupported-runtime',
		'contract-incomplete'
	]
	for (const value of right) {
		const prior = values.get(value.capabilityId)
		if (!prior) {
			values.set(value.capabilityId, value)
			continue
		}
		const contract = (entry: StudioCatalogEntry) => ({
			...entry,
			installationDigest: undefined,
			placements: [],
			readiness: undefined,
			reasonCodes: [],
			canAuthor: undefined,
			canPlan: undefined,
			canInvokeNow: undefined
		})
		if (
			JSON.stringify(contract(prior)) !== JSON.stringify(contract(value)) ||
			(prior.installationDigest &&
				value.installationDigest &&
				prior.installationDigest !== value.installationDigest)
		)
			throw new Error('CATALOG_IDENTITY_CONFLICT')
		const best = rank.indexOf(prior.readiness) <= rank.indexOf(value.readiness) ? prior : value
		values.set(value.capabilityId, {
			...best,
			installationDigest: prior.installationDigest ?? value.installationDigest,
			placements: [...new Set([...prior.placements, ...value.placements])].sort(),
			canAuthor: prior.canAuthor || value.canAuthor,
			canPlan: prior.canPlan || value.canPlan,
			canInvokeNow: false
		})
	}
	return [...values.values()].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
}

function mergeActors(
	left: StudioCatalogActor[],
	right: StudioCatalogActor[]
): StudioCatalogActor[] {
	const values = new Map(left.map((value) => [value.actorId, value]))
	for (const value of right) {
		const prior = values.get(value.actorId)
		if (!prior) {
			values.set(value.actorId, value)
			continue
		}
		const identity = (actor: StudioCatalogActor) => ({
			actorId: actor.actorId,
			version: actor.version,
			label: actor.label,
			description: actor.description,
			tags: actor.tags
		})
		if (JSON.stringify(identity(prior)) !== JSON.stringify(identity(value)))
			throw new Error('CATALOG_IDENTITY_CONFLICT')
		values.set(value.actorId, {
			...prior,
			placements: [...new Set([...prior.placements, ...value.placements])].sort(),
			visibleOperationCount: Math.max(prior.visibleOperationCount, value.visibleOperationCount),
			kind:
				prior.kind === 'operations' || value.kind === 'operations' ? 'operations' : 'event-flow',
			canCompose: prior.canCompose || value.canCompose
		})
	}
	return [...values.values()].sort((a, b) => a.actorId.localeCompare(b.actorId))
}

function parse(data: Record<string, unknown>): CatalogData {
	const allowed = new Set(['search', 'readyOnly', 'limit', 'cursor', 'viewToken'])
	if (
		Object.keys(data).some((key) => !allowed.has(key)) ||
		(data.search !== undefined && typeof data.search !== 'string') ||
		(data.readyOnly !== undefined && typeof data.readyOnly !== 'boolean') ||
		(data.limit !== undefined &&
			(!Number.isInteger(data.limit) || Number(data.limit) < 1 || Number(data.limit) > 100)) ||
		(data.cursor !== undefined && typeof data.cursor !== 'string') ||
		(data.viewToken !== undefined && typeof data.viewToken !== 'string')
	)
		throw new Error('CATALOG_INVALID_REQUEST')
	return data as CatalogData
}

async function digest(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
