import type { Manifest, MethodSpec } from './actor'
import { Actor } from './actor'
import type { MessageBus } from './bus'

/**
 * The draft machinery behind the NEGOTIATOR (0131): a model-authored draft
 * becomes a full manifest, joins the mesh as an ordinary sandboxed actor,
 * and rides out as a catalog-ready code export — committing it is what
 * makes a draft permanent ("code is the source of truth").
 *
 * (The composer that once shared this pipeline was removed again — the
 * complexity outweighed its worth. Git history keeps the knowledge.)
 */

/** A drafted actor, model-authored: the full manifest surface as plain data. */
export interface ActorDraft {
	id: string
	description: string
	tags?: string[]
	/** Proxy-style drafts (negotiator) carry actor-level contracts. */
	requires?: string[]
	produces?: string[]
	/** Drafts may declare their entries outright. */
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
 * Draft → Manifest. A draft with declared methods passes them through; a
 * contract-only draft gets the synthesized translate entry (the negotiator's
 * proxy case) so the generic adapter binds it AND the produced functor — the
 * bridge is an ordinary clause the prover can walk.
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
 * Register a draft as a live actor — the negotiator's approve lane: its
 * human gate already sat BEFORE this call (button-only APPROVE), so the
 * bridge goes live with its export.
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
