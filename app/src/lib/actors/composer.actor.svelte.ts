import { complete } from '$lib/chat/redpill'
import { Actor, keepsRecords, type Manifest } from './actor'
import type { MessageBus } from './bus'
import type { RecordActor, StoredRecord } from './created.actor.svelte'
import { RegistryActor } from './registry.actor'

/**
 * The composer as a full actor — no longer a hidden seam inside the registry.
 *
 * It designs actors: a wish comes in, a manifest draft comes out, and only an
 * explicit commit registers it. The staged pipeline is deliberate and VISIBLE:
 * the composer's own window (its face) renders every stage — wish received,
 * model drafting, draft ready for review, registered and live — so creating an
 * actor stops being a silent tool call and becomes a flow you can watch and
 * steer, by voice or by button.
 *
 * Dogfooding the per-actor model lane: this manifest declares its OWN llm
 * settings (kimi, low temperature) and its handlers execute over exactly that
 * declared lane — the same mechanism every created llm actor uses.
 */

export type ComposerStage = 'idle' | 'drafting' | 'draft' | 'registering' | 'live' | 'failed'

export interface ComposerStep {
	at: number
	label: string
	ok: boolean
}

export class ComposerActor extends Actor {
	stage = $state<ComposerStage>('idle')
	wish = $state('')
	draft = $state<Manifest | null>(null)
	steps = $state<ComposerStep[]>([])
	/** The model's live deliberation, streamed while it drafts — the face shows it. */
	thinking = $state('')
	/** How much answer text has arrived after the deliberation, in characters. */
	writing = $state(0)

	/** When the current draft is a merge: the source actors it replaces. */
	mergeSources = $state<string[]>([])

	/** UI seam: called when the flow starts, so the face can take the stage. */
	onStage?: () => void

	#bus: MessageBus

	constructor(bus: MessageBus) {
		super({
			id: 'composer',
			name: 'Composer',
			description:
				'Designs new actors from spoken wishes: drafts a manifest with a stronger ' +
				'model, shows it for review, and registers it on commit — a visible, ' +
				'staged flow instead of a silent create.',
			tags: ['system'],
			produces: ['manifest(M)'],
			llm: { model: 'moonshotai/kimi-k3', temperature: 0.3 },
			methods: [
				{
					name: 'composer_draft',
					description:
						'Starts the actor-creation flow: drafts a manifest from a freeform wish. ' +
						'The Composer window opens and shows the draft for review — nothing is ' +
						'registered yet. Use this whenever someone wants a new actor.',
					parameters: {
						type: 'object',
						properties: {
							wish: { type: 'string', description: 'Freeform: what the new actor should do.' }
						},
						required: ['wish']
					},
					produces: ['manifest(M)']
				},
				{
					name: 'composer_revise',
					description:
						'Reworks the current draft with a freeform change instruction — the ' +
						'window updates. Only valid while a draft is showing.',
					parameters: {
						type: 'object',
						properties: {
							instruction: {
								type: 'string',
								description: 'Freeform: what about the draft should be different.'
							}
						},
						required: ['instruction']
					}
				},
				{
					name: 'composer_consolidate',
					description:
						'Merges several overlapping actors into ONE: drafts a unified manifest ' +
						'(contracts, faces, record fields) from all of them, shows it for review ' +
						'— composer_commit then migrates every record into the merged actor and ' +
						'removes the duplicates. Use when actors clearly duplicate one concept, ' +
						'e.g. several calendars.',
					parameters: {
						type: 'object',
						properties: {
							ids: {
								type: 'array',
								items: { type: 'string' },
								description: 'The ids of the actors to merge (2 or more).'
							},
							instruction: {
								type: 'string',
								description: 'Optional freeform guidance for the merged design.'
							}
						},
						required: ['ids']
					}
				},
				{
					name: 'composer_commit',
					description:
						'Registers the reviewed draft as a real actor — it joins the mesh, gets ' +
						'its own window, and survives restarts. Call when the user approves.',
					parameters: { type: 'object', properties: {} }
				},
				{
					name: 'composer_discard',
					description: 'Throws the current draft away and resets the flow.',
					parameters: { type: 'object', properties: {} }
				}
			]
		})
		this.#bus = bus
		this.bind({
			composer_draft: (p) => this.#draft(p),
			composer_consolidate: (p) => this.#consolidate(p),
			composer_revise: (p) => this.#revise(p),
			composer_commit: () => this.#commit(),
			composer_discard: () => this.#discard()
		})
	}

	#note(label: string, ok = true): void {
		this.steps.push({ at: Date.now(), label, ok })
	}

	/** This actor's declared lane — the same one the engine would use. */
	#lane() {
		return typeof this.manifest.llm === 'object' ? this.manifest.llm : {}
	}

	async #design(user: string): Promise<Manifest | null> {
		// Reasoning models occasionally glitch mid-JSON (observed: code tokens
		// spliced into a faces array, worst on long outputs). Two kimi attempts,
		// then the fast lane as the closer — qwen writes plainer manifests but
		// has never garbled its JSON here. A design that arrives beats a
		// beautiful one that doesn't.
		const lanes = [this.#lane(), this.#lane(), {}]
		for (let attempt = 0; attempt < lanes.length; attempt++) {
			const manifest = await this.#designOnce(user, lanes[attempt])
			if (manifest) return manifest
			if (attempt === 0) this.#note('answer was garbled — asking again…', false)
			if (attempt === 1) this.#note('kimi keeps garbling — falling back to the fast lane…', false)
		}
		return null
	}

	async #designOnce(
		user: string,
		lane: { model?: string; temperature?: number }
	): Promise<Manifest | null> {
		const taken = this.#bus.actors().map((a) => a.manifest.id)
		this.thinking = ''
		this.writing = 0
		// Throttled: kimi streams dozens of reasoning tokens a second, and one
		// $state write per token would burn the UI thread for nothing.
		let pendingReasoning = ''
		let lastFlush = 0
		const flush = () => {
			if (pendingReasoning !== '') {
				this.thinking = (this.thinking + pendingReasoning).slice(-4000)
				pendingReasoning = ''
			}
			lastFlush = Date.now()
		}
		const answer = await complete(
			[
				{ role: 'system', content: RegistryActor.composerSystem(taken) },
				{ role: 'user', content: user }
			],
			{
				...lane,
				onDelta: (delta) => {
					if (delta.reasoning) {
						pendingReasoning += delta.reasoning
						if (Date.now() - lastFlush > 120) flush()
					}
					if (delta.text) this.writing += delta.text.length
				}
			}
		)
		flush()
		const bare = answer.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*?$/, '$1')
		// Two attempts: verbatim, then with the classic model artifacts healed
		// (trailing commas, smart quotes). Repairs that still fail are logged
		// whole — a silent "no readable manifest" was undebuggable.
		for (const candidate of [
			bare,
			bare.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')
		]) {
			try {
				const parsed = JSON.parse(candidate)
				if (
					parsed &&
					typeof parsed === 'object' &&
					typeof parsed.id === 'string' &&
					typeof parsed.name === 'string' &&
					typeof parsed.description === 'string'
				) {
					return parsed as Manifest
				}
			} catch {
				// try the next repair
			}
		}
		console.warn('[composer] unparseable manifest answer:', answer)
		this.#note(`unparseable answer, starts: ${bare.slice(0, 120)}…`, false)
		return null
	}

	async #draft(p: Record<string, unknown>) {
		const wish = String(p.wish ?? '').trim()
		if (wish === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no wish' }),
				wire: 'The wish is missing.'
			}
		}
		this.onStage?.()
		this.stage = 'drafting'
		this.wish = wish
		this.draft = null
		this.mergeSources = []
		this.steps = []
		this.#note(`wish received: "${wish}"`)
		this.#note('drafting with kimi-k3 — reasoning models take their time…')

		const manifest = await this.#design(`Design a new actor. Wish: ${wish}`)
		if (!manifest) {
			this.stage = 'failed'
			this.#note('the model returned no readable manifest', false)
			return {
				record: JSON.stringify({ ok: false, error: 'no readable manifest' }),
				wire: 'The draft failed — the model returned no readable manifest.'
			}
		}
		this.draft = manifest
		this.stage = 'draft'
		this.thinking = ''
		this.#note(
			`draft ready: ${manifest.id} — ${(manifest.requires ?? []).join(', ') || 'nothing'} → ${(manifest.produces ?? []).join(', ') || 'nothing'}`
		)
		return {
			record: JSON.stringify({ ok: true, draft: manifest }),
			wire:
				`Draft ready: ${manifest.name} (${manifest.id}) — ${manifest.description} ` +
				'It is showing in the Composer window. Say commit to register it, or describe changes.'
		}
	}

	async #revise(p: Record<string, unknown>) {
		const instruction = String(p.instruction ?? '').trim()
		if (!this.draft || instruction === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no draft or no instruction' }),
				wire: 'There is no draft to revise, or the instruction is missing.'
			}
		}
		this.onStage?.()
		this.stage = 'drafting'
		this.#note(`revising: "${instruction}"`)
		const manifest = await this.#design(
			`Rework this manifest draft: ${JSON.stringify(this.draft)}. Requested change: ${instruction}`
		)
		if (!manifest) {
			this.stage = 'draft'
			this.#note('revision failed — keeping the previous draft', false)
			return {
				record: JSON.stringify({ ok: false, error: 'revision failed' }),
				wire: 'The revision failed; the previous draft still stands.'
			}
		}
		this.draft = manifest
		this.stage = 'draft'
		this.thinking = ''
		this.#note(`draft revised: ${manifest.id}`)
		return {
			record: JSON.stringify({ ok: true, draft: manifest }),
			wire: `Draft revised: ${manifest.name}. Commit to register it, or keep changing.`
		}
	}

	async #consolidate(p: Record<string, unknown>) {
		const ids = Array.isArray(p.ids) ? p.ids.filter((v): v is string => typeof v === 'string') : []
		const sources = ids
			.map((id) => this.#bus.get(id))
			.filter((a): a is Actor => a !== undefined && a.manifest.tags.includes('created'))
		if (sources.length < 2) {
			return {
				record: JSON.stringify({ ok: false, error: 'need two or more created actors' }),
				wire: 'Consolidation needs at least two runtime-created actors that exist.'
			}
		}
		this.onStage?.()
		this.stage = 'drafting'
		this.wish = `merge ${sources.map((a) => a.manifest.id).join(' + ')}`
		this.draft = null
		this.steps = []
		this.mergeSources = sources.map((a) => a.manifest.id)
		const recordCount = sources.reduce((n, a) => n + ((a as RecordActor).records?.length ?? 0), 0)
		this.#note(`consolidating ${this.mergeSources.join(' + ')} (${recordCount} records to migrate)`)
		this.#note('drafting the unified actor with kimi-k3…')

		const instruction = typeof p.instruction === 'string' ? ` Guidance: ${p.instruction}` : ''
		const manifest = await this.#design(
			'Merge these overlapping actors into ONE unified actor. Combine the contracts, ' +
				'keep the clearest description (and pin the exact flat record fields it must ' +
				'produce), and design its face — declare multiple "faces" views when the ' +
				'sources had genuinely different ways of looking at the same data. The ' +
				`merged records of all sources will live in this one actor. Sources: ${JSON.stringify(
					sources.map((a) => a.manifest)
				)}.${instruction}`
		)
		if (!manifest) {
			this.stage = 'failed'
			this.#note('the model returned no readable manifest', false)
			return {
				record: JSON.stringify({ ok: false, error: 'no readable manifest' }),
				wire: 'The consolidation draft failed — the model returned no readable manifest.'
			}
		}
		this.draft = manifest
		this.stage = 'draft'
		this.thinking = ''
		this.#note(`merged draft ready: ${manifest.id} replaces ${this.mergeSources.join(', ')}`)
		return {
			record: JSON.stringify({ ok: true, draft: manifest, replaces: this.mergeSources }),
			wire:
				`Merged draft ready: ${manifest.name} (${manifest.id}) would replace ` +
				`${this.mergeSources.join(', ')}, records included. It is showing in the ` +
				'Composer window. Say commit to consolidate, or describe changes.'
		}
	}

	async #commit() {
		if (!this.draft) {
			return {
				record: JSON.stringify({ ok: false, error: 'no draft' }),
				wire: 'There is no draft to commit.'
			}
		}
		this.stage = 'registering'

		// A merge first rescues every source's records, then clears the ground —
		// the sources own their ids, and the merged actor may want one of them.
		const migrated: StoredRecord[] = []
		if (this.mergeSources.length > 0) {
			for (const id of this.mergeSources) {
				const source = this.#bus.get(id)
				if (source && keepsRecords(source)) {
					migrated.push(...((source as RecordActor).records ?? []))
				}
				this.#note(`retiring ${id}`)
				await this.#bus.dispatch('composer', 'actor_delete', { id })
			}
		}

		this.#note(`registering ${this.draft.id}`)
		// The registry stays the one place actors are registered and persisted —
		// the composer merely hands over the reviewed manifest, as a message.
		const result = await this.#bus.dispatch('composer', 'actor_create', { manifest: this.draft })
		let ok = true
		try {
			ok = JSON.parse(result.record).ok !== false
		} catch {
			// non-JSON counts as fine
		}
		if (ok && migrated.length > 0) {
			const target = this.#bus.get(this.draft.id)
			if (target && keepsRecords(target)) {
				;(target as RecordActor).adopt(migrated)
				this.#note(`migrated ${migrated.length} records into ${this.draft.id}`)
			}
		}
		this.mergeSources = []
		this.stage = ok ? 'live' : 'failed'
		this.#note(ok ? `${this.draft.id} is live, window and all` : `registration failed`, ok)
		return result
	}

	#discard() {
		this.stage = 'idle'
		this.wish = ''
		this.draft = null
		this.mergeSources = []
		this.#note('draft discarded')
		return {
			record: JSON.stringify({ ok: true }),
			wire: 'The draft is discarded.'
		}
	}

	override instanceState(): Record<string, unknown> {
		return {
			stage: this.stage,
			wish: this.wish || '—',
			draft: this.draft?.id ?? '—',
			lane: typeof this.manifest.llm === 'object' ? (this.manifest.llm.model ?? 'default') : '—'
		}
	}

	protected override situation(): string {
		return `Stage ${this.stage}${this.draft ? `, draft ${this.draft.id}` : ''}; drafting on my own kimi lane.`
	}
}
