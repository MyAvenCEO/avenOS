import type { Manifest } from './actor'
import { Actor } from './actor'
import type { MessageBus } from './bus'

/**
 * The Negotiator (0131) — abject's Ask Protocol, stage 2: two actors whose
 * vocabularies do not match get a GENERATED bridge. The negotiator
 * interviews both sides through caller-aware ask(), hands their answers
 * plus both contracts to the model lane, and holds the drafted proxy
 * PENDING — nothing joins the mesh before a human approves ("code is the
 * source of truth" keeps its gate). Approve registers the proxy as a
 * normal sandboxed logic-actor for this session AND returns a
 * catalog-ready snippet to commit if the bridge should stay.
 *
 * The negotiation itself is sandboxed logic; the host appears as four
 * fail-closed capabilities: `describe`, `ask`, `complete`, `register`.
 */

const NEGOTIATOR_LOGIC = `
function present(s) {
	var drafts = []
	if (s.pending) {
		drafts.push({
			from: s.pending.requires[0] || '',
			to: s.pending.produces[0] || '',
			id: s.pending.id,
			description: s.pending.description,
			logicPreview: s.pending.logic.slice(0, 400)
		})
	}
	return {
		pending: s.pending,
		registered: s.registered,
		title: s.pending
			? 'Draft pending: ' + s.pending.id
			: s.registered.length > 0
				? s.registered.length + ' bridge(s) live'
				: 'Idle — no negotiation yet',
		note: s.pending
			? 'Review the generated logic below, then approve or reject. Nothing runs before approval.'
			: 'Say "negotiate <producer> with <consumer>" when two actors cannot understand each other.',
		drafts: drafts
	}
}

function initState(source) {
	return present({ pending: null, registered: [] })
}

function reduce(state, ev) {
	var s = { pending: state.pending, registered: state.registered.slice() }

	if (ev.send === 'NEGOTIATE') {
		var a = cap('describe', { actor: ev.payload.from })
		var b = cap('describe', { actor: ev.payload.to })
		if (!a || !b) {
			return {
				state: present(s),
				said: 'I need two existing actors — one of the two is unknown.',
				record: { ok: false, error: 'unknown actor' }
			}
		}
		if (a.produces.length === 0 || b.requires.length === 0) {
			return {
				state: present(s),
				said: a.id + ' produces nothing or ' + b.id + ' requires nothing — no bridge to build.',
				record: { ok: false, error: 'no contract to bridge' }
			}
		}
		var saysA = cap('ask', {
			actor: a.id,
			question:
				'A proxy will consume what you produce (' + a.produces.join(', ') +
				'). Describe the EXACT JSON payload shape you emit — field names, types, one example.'
		})
		var saysB = cap('ask', {
			actor: b.id,
			question:
				'A proxy will feed you (' + b.requires.join(', ') +
				'). Describe the EXACT JSON payload shape you require — field names, types, one example.'
		})
		var raw = cap('complete', {
			system:
				'You design a translator between two actors. Reply with EXACTLY one JSON object, ' +
				'no markdown: {"id": kebab-case, "description": one sentence, "logic": a QuickJS ' +
				'program as a STRING defining initState(source), reduce(state, ev) and shape(). ' +
				'The reduce must handle the event TRANSLATE: ev.payload carries the producer ' +
				'output keyed by its functor; return {state: state, said: short sentence, record: ' +
				'{ok: true, ...the translated fields the consumer requires}}. Translate values ' +
				'faithfully (convert units, rename fields) based on both sides\\' answers.',
			question: JSON.stringify({
				producer: a,
				consumer: b,
				producerSays: saysA,
				consumerSays: saysB
			})
		})
		var parsed = null
		try {
			parsed = JSON.parse(raw)
		} catch (e) {
			parsed = null
		}
		if (!parsed || typeof parsed.logic !== 'string' || parsed.logic === '') {
			return {
				state: present(s),
				said: 'The model did not return a usable proxy — nothing was drafted.',
				record: { ok: false, error: 'unusable draft' }
			}
		}
		s.pending = {
			id: typeof parsed.id === 'string' && parsed.id !== '' ? parsed.id : a.id + '-' + b.id + '-proxy',
			description:
				typeof parsed.description === 'string'
					? parsed.description
					: 'Translates ' + a.produces[0] + ' into ' + b.requires[0] + '.',
			requires: [a.produces[0]],
			produces: [b.requires[0]],
			logic: parsed.logic
		}
		return {
			state: present(s),
			said:
				'Drafted a bridge "' + s.pending.id + '" from ' + a.id + ' to ' + b.id +
				'. Review it in my window — nothing runs before you approve.',
			record: { ok: true, draft: s.pending }
		}
	}

	if (ev.send === 'APPROVE') {
		if (!s.pending) {
			return {
				state: present(s),
				said: 'There is no pending draft to approve.',
				record: { ok: false, error: 'no pending draft' }
			}
		}
		var reg = cap('register', { draft: s.pending })
		s.registered.push({ id: s.pending.id, uuid: reg.uuid })
		var approved = s.pending
		s.pending = null
		return {
			state: present(s),
			said: 'The bridge "' + approved.id + '" is live. Commit the exported code if it should stay.',
			record: { ok: true, registered: reg, code: reg.code }
		}
	}

	if (ev.send === 'REJECT') {
		var had = s.pending !== null
		s.pending = null
		return {
			state: present(s),
			said: had ? 'Draft discarded.' : 'There was nothing to discard.',
			record: { ok: had }
		}
	}

	return state
}

function shape(state, rawText) {
	return null
}
`

const NEGOTIATOR_MANIFEST: Manifest = {
	id: 'negotiator',
	name: 'Negotiator',
	description:
		'Bridges two actors whose vocabularies do not match: interviews both sides ' +
		'through ask(), lets the model draft a translator proxy, and holds it for ' +
		'human approval before anything joins the mesh.',
	tags: ['system'],
	capabilities: ['describe', 'ask', 'complete', 'register'],
	logic: NEGOTIATOR_LOGIC,
	view: {
		content: {
			class: 'brand-shell ng-shell',
			children: [
				{
					children: [
						{ class: 'eyebrow', text: 'Negotiator' },
						{ tag: 'h1', class: 'ng-title', text: '$title' },
						{ class: 'ng-note', text: '$note' }
					]
				},
				{
					class: 'ng-drafts',
					$each: {
						items: '$drafts',
						template: {
							class: 'ng-draft',
							children: [
								{
									class: 'ng-draft-head',
									children: [
										{ tag: 'h2', class: 'ng-draft-id', text: '$$id' },
										{ class: 'ng-draft-contract', text: '$$from' },
										{ class: 'ng-arrow', text: '→' },
										{ class: 'ng-draft-contract', text: '$$to' }
									]
								},
								{ class: 'ng-draft-desc', text: '$$description' },
								{ tag: 'pre', class: 'ng-draft-logic', text: '$$logicPreview' },
								{
									class: 'ng-actions',
									children: [
										{
											tag: 'button',
											class: 'ng-approve',
											attrs: { type: 'button' },
											text: 'Approve',
											$on: { click: { send: 'APPROVE' } }
										},
										{
											tag: 'button',
											class: 'ng-reject',
											attrs: { type: 'button' },
											text: 'Reject',
											$on: { click: { send: 'REJECT' } }
										}
									]
								}
							]
						}
					}
				}
			]
		}
	},
	style: {
		selectors: {
			'.ng-shell': {
				width: '100%',
				display: 'flex',
				flexDirection: 'column',
				gap: 'var(--gap-section)'
			},
			'.ng-title': { margin: '0', fontSize: 'var(--fs-hero)', fontWeight: '500' },
			'.ng-note': { marginTop: '0.25rem', fontSize: 'var(--fs-body)', color: 'var(--muted)' },
			'.ng-drafts': { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
			'.ng-draft': {
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				padding: 'var(--pad-card)',
				borderRadius: 'var(--radius-card)',
				border: '1px solid var(--border)',
				background: 'var(--surface)'
			},
			'.ng-draft-head': {
				display: 'flex',
				alignItems: 'baseline',
				gap: '0.5rem',
				flexWrap: 'wrap'
			},
			'.ng-draft-id': { margin: '0', fontSize: 'var(--fs-title)', fontWeight: '600' },
			'.ng-draft-contract': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)'
			},
			'.ng-arrow': { color: 'var(--muted)' },
			'.ng-draft-desc': { fontSize: 'var(--fs-body)', color: 'var(--muted-strong)' },
			'.ng-draft-logic': {
				margin: '0',
				maxHeight: '12rem',
				overflow: 'auto',
				padding: '0.75rem',
				borderRadius: 'var(--radius-inner)',
				background: 'var(--bg-a)',
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				whiteSpace: 'pre-wrap'
			},
			'.ng-actions': { display: 'flex', gap: '0.5rem' },
			'.ng-approve': {
				border: 'none',
				borderRadius: 'var(--radius-pill)',
				padding: '0.5rem 1.1rem',
				background: 'var(--primary)',
				color: 'var(--primary-foreground)',
				fontWeight: '600',
				cursor: 'pointer'
			},
			'.ng-reject': {
				borderRadius: 'var(--radius-pill)',
				padding: '0.5rem 1.1rem',
				border: '1px solid var(--border)',
				background: 'transparent',
				color: 'var(--muted-strong)',
				fontWeight: '600',
				cursor: 'pointer'
			}
		}
	},
	methods: [
		{
			name: 'negotiate',
			description:
				'When two actors cannot understand each other: interviews producer and ' +
				'consumer, drafts a translator proxy via the model, and holds it for ' +
				'approval. from = the producing actor, to = the consuming actor.',
			parameters: {
				type: 'object',
				properties: {
					from: { type: 'string', description: 'The producer (id, name or uuid).' },
					to: { type: 'string', description: 'The consumer (id, name or uuid).' }
				},
				required: ['from', 'to']
			},
			event: { send: 'NEGOTIATE' }
		},
		{
			name: 'negotiator_approve',
			description:
				'Registers the pending proxy draft for this session and returns a ' +
				'catalog-ready code snippet. Only on explicit human approval.',
			parameters: { type: 'object', properties: {} },
			event: { send: 'APPROVE' }
		},
		{
			name: 'negotiator_reject',
			description: 'Discards the pending proxy draft.',
			parameters: { type: 'object', properties: {} },
			event: { send: 'REJECT' }
		}
	]
}

/** What the register capability synthesizes around a drafted proxy. */
export interface ProxyDraft {
	id: string
	description: string
	requires: string[]
	produces: string[]
	logic: string
}

/**
 * The drafted proxy as a full manifest: one synthesized TRANSLATE entry so
 * the generic adapter binds it AND the produced functor — the bridge is an
 * ordinary clause the prover can walk.
 */
export function proxyManifest(draft: ProxyDraft): Manifest {
	return {
		id: draft.id,
		name: draft.id,
		description: draft.description,
		tags: ['proxy'],
		logic: draft.logic,
		requires: [],
		produces: [],
		methods: [
			{
				name: `${draft.id}_translate`,
				description: draft.description,
				parameters: { type: 'object', properties: {}, additionalProperties: true },
				requires: draft.requires,
				produces: draft.produces,
				event: { send: 'TRANSLATE' }
			}
		]
	}
}

export class NegotiatorActor extends Actor {
	constructor(bus: MessageBus) {
		super(
			NEGOTIATOR_MANIFEST,
			{},
			{
				describe: (p) => {
					const actor = bus.get(String(p.actor ?? ''))
					if (!actor) return null
					return {
						id: actor.manifest.id,
						name: actor.instanceName,
						description: actor.manifest.description,
						requires: actor.requires,
						produces: actor.produces
					}
				},
				ask: async (p) =>
					await bus.ask(String(p.actor ?? ''), String(p.question ?? ''), 'negotiator'),
				complete: async (p) => {
					const result = await bus.dispatch('negotiator', 'llm_complete', {
						system: String(p.system ?? ''),
						question: String(p.question ?? ''),
						settings: { json: true }
					})
					try {
						const parsed = JSON.parse(result.record) as { ok?: boolean; text?: unknown }
						if (parsed.ok !== false) return String(parsed.text ?? '')
					} catch {
						// fall through
					}
					return ''
				},
				register: (p) => {
					const draft = p.draft as ProxyDraft
					const manifest = proxyManifest(draft)
					const proxy = new Actor(manifest)
					bus.register(proxy)
					// The catalog-ready export: definitions stay code-ownable.
					const code =
						`// Approved bridge — add to app/src/lib/actors/catalog.ts to keep it:\n` +
						JSON.stringify(manifest, null, '\t')
					return { uuid: proxy.uuid, name: proxy.instanceName, code }
				}
			}
		)
	}
}
