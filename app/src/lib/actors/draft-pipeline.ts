import { validateStyleDef, validateViewDef } from '@avenos/aven-ui'
import type { Manifest, MethodSpec } from './actor'
import { Actor } from './actor'
import { MessageBus } from './bus'
import { createSession, SandboxError } from './sandbox'
import { singleton } from './singleton'

/**
 * The shared draft machinery (0135) — ONE pipeline under TWO actors, exactly
 * abject's split: the Composer (ObjectCreator) and the Negotiator stay
 * separate actors with their own faces and tools, but membrane, staging,
 * promote/export and discard live HERE as host functions both grant as
 * capabilities.
 *
 * Staging is Samuel's next/production architecture: a validated draft is
 * spawned as a REAL instance carrying the `staging` tag — the best preview
 * is the running actor. Promote drops the tag (production) and returns the
 * catalog-ready code export; the codebase stays the source of truth.
 */

/** A drafted actor, model-authored: the full manifest surface as plain data. */
export interface ActorDraft {
	id: string
	description: string
	tags?: string[]
	/** Proxy-style drafts (negotiator) carry actor-level contracts. */
	requires?: string[]
	produces?: string[]
	/** Full-actor drafts (composer) declare their entries outright. */
	methods?: {
		name: string
		description: string
		parameters?: Record<string, unknown>
		requires?: string[]
		produces?: string[]
		event: { send: string }
		hitl?: string
	}[]
	logic: string
	source?: Record<string, unknown>
	view?: Manifest['view']
	style?: Manifest['style']
	views?: Manifest['views']
}

/**
 * One proof — the measurable "done" the interview wrote BEFORE anything was
 * drafted: a Prolog goal, the external facts it runs over, and the record
 * fields the final step must carry.
 */
export interface Proof {
	goal: string
	seed?: Record<string, unknown>
	expect?: Record<string, unknown>
}

export type ProbeResult =
	| { ok: true }
	| { ok: false; stage: 'view' | 'style' | 'logic' | 'proof'; error: string; proof?: string }

/**
 * Draft → Manifest. A draft with declared methods passes them through (the
 * composer's full-actor case); a contract-only draft gets the synthesized
 * translate entry (the negotiator's proxy case) so the generic adapter binds
 * it AND the produced functor — the bridge is an ordinary clause.
 */
export function draftManifest(draft: ActorDraft): Manifest {
	const methods: MethodSpec[] =
		draft.methods && draft.methods.length > 0
			? draft.methods.map((m) => ({
					name: m.name,
					description: m.description,
					parameters: m.parameters ?? {
						type: 'object',
						properties: {},
						additionalProperties: true
					},
					...(m.requires && { requires: m.requires }),
					...(m.produces && { produces: m.produces }),
					event: m.event,
					...(m.hitl && { hitl: m.hitl })
				}))
			: [
					{
						name: `${draft.id}_translate`,
						description: draft.description,
						parameters: { type: 'object', properties: {}, additionalProperties: true },
						requires: draft.requires ?? [],
						produces: draft.produces ?? [],
						event: { send: 'TRANSLATE' }
					}
				]
	return {
		id: draft.id,
		name: draft.id,
		description: draft.description,
		tags: draft.tags ?? ['drafted'],
		logic: draft.logic,
		...(draft.source && { source: draft.source }),
		...(draft.view && { view: draft.view }),
		...(draft.style && { style: draft.style }),
		...(draft.views && { views: draft.views }),
		requires: [],
		produces: [],
		methods
	}
}

/** The catalog-ready export — committing it is what makes a draft permanent. */
export function exportCode(manifest: Manifest): string {
	return (
		`// Promoted actor — add to app/src/lib/actors/catalog.ts to keep it:\n` +
		JSON.stringify(manifest, null, '\t')
	)
}

/**
 * The membrane, in probe order: cheap static validation first, then the
 * sandbox (syntax, initState shape, a smoke reduce), then the PROOFS — the
 * draft runs on an isolated scratch bus and must satisfy the measurable
 * "done" the interview wrote. A draft that fails its own definition of done
 * reaches neither staging nor human; the error names what broke.
 */
export async function probeDraft(draft: ActorDraft, proofs: Proof[] = []): Promise<ProbeResult> {
	const manifest = draftManifest(draft)
	try {
		if (draft.view) validateViewDef(draft.view)
		for (const named of draft.views ?? []) validateViewDef(named.view)
	} catch (err) {
		return { ok: false, stage: 'view', error: reason(err) }
	}
	try {
		if (draft.style) validateStyleDef(draft.style)
		for (const named of draft.views ?? []) {
			if (named.style) validateStyleDef(named.style)
		}
	} catch (err) {
		return { ok: false, stage: 'style', error: reason(err) }
	}

	// The sandbox probe: evaluate, seed, smoke — in a throwaway session.
	let session: Awaited<ReturnType<typeof createSession>> | null = null
	try {
		session = await createSession(draft.logic)
		const state = await session.initState(draft.source ?? {})
		const first = manifest.methods[0]?.event?.send
		if (first) await session.reduce(state, { send: first, payload: {} })
	} catch (err) {
		return { ok: false, stage: 'logic', error: reason(err) }
	} finally {
		session?.dispose()
	}

	// The proofs: a scratch mesh nobody else sees — register the draft, walk
	// each goal with the prover, compare the final record to the expectation.
	const scratch = new MessageBus()
	scratch.register(new Actor(manifest))
	for (const proof of proofs) {
		const run = await scratch.satisfy(proof.goal, proof.seed ?? {})
		if (run.status !== 'ok') {
			return {
				ok: false,
				stage: 'proof',
				proof: proof.goal,
				error: `proof ${proof.goal} is not satisfiable with the given seed`
			}
		}
		const out = run.steps.at(-1)?.out as Record<string, unknown> | undefined
		for (const [key, want] of Object.entries(proof.expect ?? {})) {
			if (JSON.stringify(out?.[key]) !== JSON.stringify(want)) {
				return {
					ok: false,
					stage: 'proof',
					proof: proof.goal,
					error:
						`proof ${proof.goal}: expected ${key}=${JSON.stringify(want)}, ` +
						`got ${JSON.stringify(out?.[key])}`
				}
			}
		}
	}
	return { ok: true }
}

function reason(err: unknown): string {
	return err instanceof SandboxError || err instanceof Error ? err.message : String(err)
}

/**
 * The staging tags — which registered instances are "next", not production.
 * A Set of uuids (globally unique, so one set serves every bus), surviving
 * HMR like every other piece of live state.
 */
const stagingTags = singleton('aven.staging', () => new Set<string>())

export function isStaged(uuid: string): boolean {
	return stagingTags.has(uuid)
}

/**
 * Stage a draft: spawn it as a REAL instance — tagged, windowed through the
 * existing instance-window mechanic, fully usable via dispatch. `make` lets
 * the app wiring hand in a reactive subclass; tests stay on the plain Actor.
 */
export function stageDraft(
	bus: MessageBus,
	draft: ActorDraft,
	make: (manifest: Manifest) => Actor = (m) => new Actor(m)
): { uuid: string; name: string } {
	const actor = make(draftManifest(draft))
	bus.register(actor)
	stagingTags.add(actor.uuid)
	bus.onSpawned?.(actor)
	return { uuid: actor.uuid, name: actor.instanceName }
}

/** Promote: the staging tag falls, the export rides along — "production". */
export function promoteStaged(
	bus: MessageBus,
	ref: string
): { uuid: string; name: string; code: string } | null {
	const actor = bus.get(ref)
	if (!actor || !stagingTags.has(actor.uuid)) return null
	stagingTags.delete(actor.uuid)
	return { uuid: actor.uuid, name: actor.instanceName, code: exportCode(actor.manifest) }
}

/**
 * Discard: the staged instance and its windows go. Deliberately NOT
 * bus.dispose — a staged draft is usually the first (default) instance of
 * its template, which dispose protects; the staging tag IS the permission.
 */
export function discardStaged(bus: MessageBus, ref: string): { uuid: string; name: string } | null {
	const actor = bus.get(ref)
	if (!actor || !stagingTags.has(actor.uuid)) return null
	stagingTags.delete(actor.uuid)
	bus.unregister(actor.uuid)
	bus.onDisposed?.(actor)
	return { uuid: actor.uuid, name: actor.instanceName }
}

/**
 * Register a draft as production outright — the negotiator's approve lane:
 * its human gate already sat BEFORE this call (button-only APPROVE), so the
 * bridge skips staging and goes live with its export.
 */
export function registerDraft(
	bus: MessageBus,
	draft: ActorDraft,
	make: (manifest: Manifest) => Actor = (m) => new Actor(m)
): { uuid: string; name: string; code: string } {
	const manifest = draftManifest(draft)
	const actor = make(manifest)
	bus.register(actor)
	return { uuid: actor.uuid, name: actor.instanceName, code: exportCode(manifest) }
}
