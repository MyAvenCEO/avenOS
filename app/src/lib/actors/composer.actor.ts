import type { Manifest } from './actor'
import { Actor } from './actor'
import type { MessageBus } from './bus'
import {
	type ActorDraft,
	discardStaged,
	type Proof,
	probeDraft,
	promoteStaged,
	stageDraft
} from './draft-pipeline'

/**
 * The Composer (0135) — abject's ObjectCreator: "interviews existing
 * Abjects, learns their protocols through the Ask Protocol, and generates
 * living collaborators. The tool teaches the creator how to use it."
 *
 * PROOFS FIRST: the interview ends with the measurable definition of done —
 * Prolog goals plus seeds in `state.proofs` — BEFORE the model sees a line
 * of logic; the design brief quotes them ("build the actor that makes these
 * goals satisfiable") and the membrane PROVES them on a scratch bus. A valid
 * draft runs as a live staging instance ("next"); Promote is button-only.
 *
 * The composition itself is sandboxed logic; the host appears as eight
 * fail-closed capabilities over the shared draft pipeline.
 */

const PLAN_BRIEF =
	'You are the PLAN round of an actor composer. From the human wish, write the ' +
	'measurable definition of done BEFORE anything is designed. Reply with EXACTLY ' +
	'one JSON object, no markdown: {"proofs": [{"goal": a Prolog predicate like ' +
	'streak(S), "seed": {external facts as flat JSON}, "expect": {record fields the ' +
	'final step must carry, with exact expected values}}], "ask": [{"actor": id, ' +
	'"question": one question about exact payload shapes}]}. 1-3 proofs, ' +
	'deterministic seeds — a proof must be checkable by running it. Ask only actors ' +
	'from the given list, only when the wish wants to connect to them; else ask: [].'

const DESIGN_BRIEF =
	'You design ONE complete avenOS actor. Reply with EXACTLY one JSON object, no ' +
	'markdown: {"id": kebab-case, "description": one sentence, "tags": [strings], ' +
	'"methods": [{"name": snake_case, "description": when to call it, "parameters": ' +
	'a JSON schema object, "produces": ["pred(X)"] where fitting, "event": {"send": ' +
	'"EVENT"}, "hitl": short imperative label ONLY on destructive entries}], ' +
	'"logic": a QuickJS program as a STRING defining initState(source), ' +
	'reduce(state, ev) and shape(state, rawText), "view": an aven-ui ViewDef, ' +
	'"style": an aven-ui StyleDef}. House rules: methods declare events, never ' +
	'handlers — reduce switches on ev.send and returns {state: nextState, said: one ' +
	'short sentence, record: {ok: true, ...flat result fields}}; reduce must ' +
	'tolerate an empty ev.payload (a smoke test sends one); shape returns null. The ' +
	'view is data: nodes {tag, class, text, children, attrs}, lists via $each ON ' +
	'the container ({items: "$stateField", template: {"text": "$$itemField"}}), ' +
	'clicks via $on: {click: {send: "EVENT"}}; NO conditionals or ternaries — empty ' +
	'arrays render nothing; style.selectors uses brand tokens like var(--fs-hero), ' +
	'var(--fs-body), var(--radius-card), var(--surface), var(--border), ' +
	'var(--muted). YOUR ACTOR MUST MAKE EVERY GIVEN PROOF SATISFIABLE: each proof ' +
	"goal appears in some method's produces, and reducing that method's event " +
	'with the proof seed as ev.payload returns a record carrying exactly the ' +
	'expected fields. The exemplar manifest shows the house style — imitate it.'

const COMPOSER_LOGIC = `
function present(s) {
	var goalRows = s.goal ? [{ quote: s.goal }] : []
	var proofState = s.phase === 'staged' ? 'proven' : 'target'
	var proofRows = []
	for (var i = 0; i < s.proofs.length; i++) {
		proofRows.push({
			goal: s.proofs[i].goal,
			detail:
				'seed ' + JSON.stringify(s.proofs[i].seed || {}) +
				' \\u2192 ' + JSON.stringify(s.proofs[i].expect || {}),
			state: proofState
		})
	}
	var interviewRows = []
	for (var j = 0; j < s.interviews.length; j++) {
		interviewRows.push({
			actor: s.interviews[j].actor,
			answer: s.interviews[j].answer
		})
	}
	var stagedRows = []
	if (s.staged) {
		var entries = []
		var ms = s.staged.draft.methods || []
		for (var k = 0; k < ms.length; k++) {
			entries.push(ms[k].name + ' \\u2192 ' + ms[k].event.send + (ms[k].hitl ? ' [HITL]' : ''))
		}
		stagedRows.push({
			id: s.staged.id,
			description: s.staged.description,
			entriesLine: entries.join(' \\u00b7 '),
			logicPreview: s.staged.draft.logic.slice(0, 400),
			hint: 'Runs as a staging instance ("next") — try it, then Promote or Discard.'
		})
	}
	var failedRows = []
	if (s.phase === 'failed' && s.history.length > 0) {
		var last = s.history[s.history.length - 1]
		failedRows.push({ error: last.error, excerpt: last.excerpt })
	}
	var title =
		s.phase === 'staged' && s.staged
			? 'Staged: ' + s.staged.id
			: s.phase === 'failed'
				? 'Draft failed'
				: s.phase === 'interviewing'
					? 'Interviewing\\u2026'
					: s.phase === 'drafting'
						? 'Kimi is designing\\u2026'
						: 'Idle \\u2014 nothing staged yet'
	var note =
		s.phase === 'staged'
			? 'The proofs below are PROVEN — the instance is live. Promote makes it production, Discard disposes it.'
			: s.phase === 'failed'
				? 'Say it again or differently — single shot, no auto-retry.'
				: 'Say what should exist — I interview the mesh, write the proofs, and design it.'
	return {
		phase: s.phase,
		goal: s.goal,
		interviews: s.interviews,
		proofs: s.proofs,
		staged: s.staged,
		history: s.history,
		produced: s.produced,
		title: title,
		note: note,
		goalRows: goalRows,
		proofRows: proofRows,
		interviewRows: interviewRows,
		stagedRows: stagedRows,
		failedRows: failedRows,
		producedRows: s.produced
	}
}

function initState(source) {
	return present({
		phase: 'idle',
		goal: '',
		interviews: [],
		proofs: [],
		staged: null,
		history: [],
		produced: []
	})
}

function fail(s, wish, error, excerpt, said) {
	s.phase = 'failed'
	s.history.push({ wish: wish, error: error, excerpt: excerpt })
	return { state: present(s), said: said, record: { ok: false, error: error } }
}

function reduce(state, ev) {
	var s = {
		phase: state.phase,
		goal: state.goal,
		interviews: state.interviews.slice(),
		proofs: state.proofs.slice(),
		staged: state.staged,
		history: state.history.slice(),
		produced: state.produced.slice()
	}

	if (ev.send === 'COMPOSE') {
		var wish = String(ev.payload.wish || '')
		if (!wish) {
			return {
				state: present(s),
				said: 'Tell me what should exist \\u2014 I need a wish.',
				record: { ok: false, error: 'empty wish' }
			}
		}
		s.goal = wish
		s.phase = 'interviewing'
		s.interviews = []
		s.proofs = []
		s.staged = null

		var rows = cap('actors')
		var exemplar = cap('manifest', { actor: 'workitem' })

		// PLAN round \\u2014 proofs FIRST: the measurable "done" exists before
		// the model sees a line of logic.
		var planRaw = cap('complete', {
			system: ${JSON.stringify(PLAN_BRIEF)},
			question: JSON.stringify({ wish: wish, actors: rows })
		})
		var plan = null
		try {
			plan = JSON.parse(planRaw)
		} catch (e) {
			plan = null
		}
		if (!plan || !plan.proofs || plan.proofs.length === 0) {
			return fail(
				s, wish, 'the plan round produced no proofs', String(planRaw).slice(0, 240),
				'I could not derive a measurable definition of done \\u2014 nothing was drafted.'
			)
		}
		s.proofs = plan.proofs

		var asks = plan.ask || []
		for (var i = 0; i < asks.length; i++) {
			var answer = cap('ask', { actor: asks[i].actor, question: asks[i].question })
			s.interviews.push({ actor: asks[i].actor, question: asks[i].question, answer: answer })
		}

		// DRAFT round \\u2014 single shot, on the kimi lane; the brief quotes
		// the proofs and the house exemplar verbatim.
		s.phase = 'drafting'
		var raw = cap('complete', {
			system: ${JSON.stringify(DESIGN_BRIEF)},
			question: JSON.stringify({
				wish: wish,
				proofs: s.proofs,
				exemplar: exemplar,
				actors: rows,
				interviews: s.interviews
			})
		})
		var draft = null
		try {
			draft = JSON.parse(raw)
		} catch (e) {
			draft = null
		}
		if (!draft || typeof draft.id !== 'string' || draft.id === '' ||
			typeof draft.logic !== 'string' || draft.logic === '') {
			return fail(
				s, wish, 'the model did not return a usable draft', String(raw).slice(0, 240),
				'The model did not return a usable actor \\u2014 say it again or differently; single shot, no auto-retry.'
			)
		}

		// MEMBRANE \\u2014 validators, sandbox probe, and the PROOFS on a
		// scratch bus. Parsing happened above, behind this membrane too.
		var probe = cap('probe', { draft: draft, proofs: s.proofs })
		if (!probe || probe.ok !== true) {
			var perr = probe && probe.error ? probe.error : 'membrane probe failed'
			return fail(
				s, wish, perr, String(raw).slice(0, 240),
				'The draft failed the membrane: ' + perr + ' \\u2014 say it again or differently; single shot, no auto-retry.'
			)
		}

		// STAGING \\u2014 the draft becomes a REAL instance, tagged "next".
		var staged = cap('stage', { draft: draft })
		s.staged = {
			uuid: staged.uuid,
			name: staged.name,
			id: draft.id,
			description: String(draft.description || ''),
			draft: draft
		}
		s.phase = 'staged'
		return {
			state: present(s),
			said:
				'Staged "' + draft.id + '" \\u2014 it runs live as a staging instance now. ' +
				'Try it, then Promote or Discard by button; voice cannot promote.',
			record: { ok: true, staged: { uuid: staged.uuid, name: staged.name, id: draft.id }, proofs: s.proofs }
		}
	}

	if (ev.send === 'PROMOTE') {
		if (!s.staged) {
			return {
				state: present(s),
				said: 'There is nothing staged to promote.',
				record: { ok: false, error: 'nothing staged' }
			}
		}
		var reg = cap('promote', { to: s.staged.uuid })
		if (!reg) {
			return {
				state: present(s),
				said: 'The staged instance is gone \\u2014 nothing promoted.',
				record: { ok: false, error: 'stale staging' }
			}
		}
		var pid = s.staged.id
		s.produced.push({ name: reg.name, id: pid, status: 'production' })
		s.staged = null
		s.phase = 'idle'
		return {
			state: present(s),
			said: 'Promoted "' + pid + '" to production. Commit the exported code if it should stay.',
			record: { ok: true, promoted: reg, code: reg.code }
		}
	}

	if (ev.send === 'DISCARD') {
		if (!s.staged) {
			return {
				state: present(s),
				said: 'There is nothing staged to discard.',
				record: { ok: false, error: 'nothing staged' }
			}
		}
		cap('discard', { to: s.staged.uuid })
		var did = s.staged.id
		s.staged = null
		s.phase = 'idle'
		return {
			state: present(s),
			said: 'Discarded "' + did + '" \\u2014 the staging instance and its windows are gone.',
			record: { ok: true, discarded: did }
		}
	}

	return state
}

function shape(state, rawText) {
	return null
}
`

const COMPOSER_MANIFEST: Manifest = {
	id: 'composer',
	name: 'Composer',
	description:
		'The ObjectCreator: turns a wish into a complete actor — interviews the mesh, ' +
		'writes the measurable proofs FIRST, lets the model design against them, ' +
		'proves the draft behind the membrane, and stages it as a live "next" ' +
		'instance. Promote (button-only) makes it production with a code export.',
	tags: ['system'],
	capabilities: ['actors', 'manifest', 'ask', 'complete', 'probe', 'stage', 'promote', 'discard'],
	logic: COMPOSER_LOGIC,
	view: {
		content: {
			class: 'brand-shell cp-shell',
			children: [
				{
					children: [
						{ class: 'eyebrow', text: 'Composer' },
						{ tag: 'h1', class: 'cp-title', text: '$title' },
						{ class: 'cp-note', text: '$note' }
					]
				},
				{
					class: 'cp-goal',
					$each: { items: '$goalRows', template: { class: 'cp-quote', text: '$$quote' } }
				},
				{
					class: 'cp-proofs',
					$each: {
						items: '$proofRows',
						template: {
							class: 'cp-proof',
							children: [
								{ class: 'cp-proof-goal', text: '$$goal' },
								{ class: 'cp-proof-detail', text: '$$detail' },
								{ class: 'cp-proof-state', text: '$$state' }
							]
						}
					}
				},
				{
					class: 'cp-interviews',
					$each: {
						items: '$interviewRows',
						template: {
							class: 'cp-interview',
							children: [
								{ class: 'cp-interview-actor', text: '$$actor' },
								{ class: 'cp-interview-answer', text: '$$answer' }
							]
						}
					}
				},
				{
					class: 'cp-staged',
					$each: {
						items: '$stagedRows',
						template: {
							class: 'cp-draft',
							children: [
								{ tag: 'h2', class: 'cp-draft-id', text: '$$id' },
								{ class: 'cp-draft-desc', text: '$$description' },
								{ class: 'cp-draft-entries', text: '$$entriesLine' },
								{ tag: 'pre', class: 'cp-draft-logic', text: '$$logicPreview' },
								{ class: 'cp-draft-hint', text: '$$hint' },
								{
									class: 'cp-actions',
									children: [
										{
											tag: 'button',
											class: 'cp-promote',
											attrs: { type: 'button' },
											text: 'Promote',
											$on: { click: { send: 'PROMOTE' } }
										},
										{
											tag: 'button',
											class: 'cp-discard',
											attrs: { type: 'button' },
											text: 'Discard',
											$on: { click: { send: 'DISCARD' } }
										}
									]
								}
							]
						}
					}
				},
				{
					class: 'cp-failed',
					$each: {
						items: '$failedRows',
						template: {
							class: 'cp-fail',
							children: [
								{ class: 'cp-fail-error', text: '$$error' },
								{ tag: 'pre', class: 'cp-fail-excerpt', text: '$$excerpt' }
							]
						}
					}
				},
				{
					class: 'cp-produced',
					$each: {
						items: '$producedRows',
						template: {
							class: 'cp-prod',
							children: [
								{ class: 'cp-prod-name', text: '$$id' },
								{ class: 'cp-chip', text: '$$status' }
							]
						}
					}
				}
			]
		}
	},
	style: {
		selectors: {
			'.cp-shell': {
				width: '100%',
				maxWidth: '48rem',
				minWidth: '0',
				display: 'flex',
				flexDirection: 'column',
				gap: 'var(--gap-section)'
			},
			'.cp-title': { margin: '0', fontSize: 'var(--fs-hero)', fontWeight: '500' },
			'.cp-note': { marginTop: '0.25rem', fontSize: 'var(--fs-body)', color: 'var(--muted)' },
			'.cp-goal': { display: 'flex', flexDirection: 'column' },
			'.cp-quote': {
				padding: '0.5rem 0.9rem',
				borderLeft: '3px solid var(--border)',
				fontSize: 'var(--fs-body)',
				fontStyle: 'italic',
				color: 'var(--muted-strong)'
			},
			'.cp-proofs': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
			'.cp-proof': {
				display: 'flex',
				alignItems: 'baseline',
				gap: '0.6rem',
				flexWrap: 'wrap',
				padding: '0.5rem 0.75rem',
				borderRadius: 'var(--radius-inner)',
				border: '1px solid var(--border)',
				background: 'var(--surface)'
			},
			'.cp-proof-goal': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-small)',
				fontWeight: '600'
			},
			'.cp-proof-detail': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted)'
			},
			'.cp-proof-state': {
				marginLeft: 'auto',
				padding: '0.1rem 0.6rem',
				borderRadius: 'var(--radius-pill)',
				border: '1px solid var(--border)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)'
			},
			'.cp-interviews': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
			'.cp-interview': {
				display: 'flex',
				flexDirection: 'column',
				gap: '0.25rem',
				padding: '0.5rem 0.75rem',
				borderRadius: 'var(--radius-inner)',
				background: 'var(--bg-a)'
			},
			'.cp-interview-actor': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted)'
			},
			'.cp-interview-answer': { fontSize: 'var(--fs-small)', color: 'var(--muted-strong)' },
			'.cp-staged': { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
			'.cp-draft': {
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				padding: 'var(--pad-card)',
				borderRadius: 'var(--radius-card)',
				border: '1px solid var(--border)',
				background: 'var(--surface)'
			},
			'.cp-draft-id': { margin: '0', fontSize: 'var(--fs-title)', fontWeight: '600' },
			'.cp-draft-desc': { fontSize: 'var(--fs-body)', color: 'var(--muted-strong)' },
			'.cp-draft-entries': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)'
			},
			'.cp-draft-logic': {
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
			'.cp-draft-hint': { fontSize: 'var(--fs-small)', color: 'var(--muted)' },
			'.cp-actions': { display: 'flex', gap: '0.5rem' },
			'.cp-promote': {
				border: 'none',
				borderRadius: 'var(--radius-pill)',
				padding: '0.5rem 1.1rem',
				background: 'var(--primary)',
				color: 'var(--primary-foreground)',
				fontWeight: '600',
				cursor: 'pointer'
			},
			'.cp-discard': {
				borderRadius: 'var(--radius-pill)',
				padding: '0.5rem 1.1rem',
				border: '1px solid var(--border)',
				background: 'transparent',
				color: 'var(--muted-strong)',
				fontWeight: '600',
				cursor: 'pointer'
			},
			'.cp-failed': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
			'.cp-fail': {
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				padding: 'var(--pad-card)',
				borderRadius: 'var(--radius-card)',
				border: '1px solid var(--border)',
				background: 'var(--surface)'
			},
			'.cp-fail-error': { fontSize: 'var(--fs-body)', color: 'var(--muted-strong)' },
			'.cp-fail-excerpt': {
				margin: '0',
				maxHeight: '8rem',
				overflow: 'auto',
				padding: '0.75rem',
				borderRadius: 'var(--radius-inner)',
				background: 'var(--bg-a)',
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				whiteSpace: 'pre-wrap'
			},
			'.cp-produced': { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
			'.cp-prod': {
				display: 'flex',
				alignItems: 'center',
				gap: '0.5rem',
				fontSize: 'var(--fs-small)'
			},
			'.cp-prod-name': { fontFamily: 'var(--font-mono)' },
			'.cp-chip': {
				padding: '0.1rem 0.6rem',
				borderRadius: 'var(--radius-pill)',
				border: '1px solid var(--border)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)'
			}
		}
	},
	methods: [
		{
			name: 'compose',
			description:
				'Turns a wish into a new actor: interviews the mesh, writes measurable ' +
				'proofs first, designs against them on the kimi lane, proves the draft, ' +
				'and stages it as a live instance. Promotion happens ONLY by button — ' +
				'there is no promote tool, so never claim you promoted.',
			parameters: {
				type: 'object',
				properties: {
					wish: {
						type: 'string',
						description: 'What should exist, in the words of the human.'
					}
				},
				required: ['wish']
			},
			event: { send: 'COMPOSE' }
		}
	]
}

/**
 * The composer's model lane: designing is slow, careful work — every
 * composer completion runs kimi-k3; the voice lane stays fast.
 */
export const COMPOSER_SETTINGS = {
	model: 'moonshotai/kimi-k3',
	temperature: 0.3,
	json: true
}

/** Host seams the app wires in; tests run without any of them. */
export interface ComposerOptions {
	/** Reactive subclass for staged instances, so their windows update. */
	make?: (manifest: Manifest) => Actor
	/** The live turn's abort signal — Stop must stop the compose, not just the reply. */
	signal?: () => AbortSignal | undefined
	/** Progress line for the activity strip: the process is visible, not magic. */
	onProgress?: (note: string) => void
}

export class ComposerActor extends Actor {
	constructor(bus: MessageBus, options: ComposerOptions = {}) {
		const progress = options.onProgress
		super(
			COMPOSER_MANIFEST,
			{},
			{
				actors: () =>
					bus.actors().map((a) => ({
						uuid: a.uuid,
						id: a.manifest.id,
						name: a.instanceName,
						tags: a.manifest.tags,
						requires: a.requires,
						produces: a.produces,
						methods: a.manifest.methods.map((m) => m.name)
					})),
				manifest: (p) => bus.get(String(p.actor ?? ''))?.manifest ?? null,
				ask: async (p) => {
					progress?.(`Composer interviews ${String(p.actor ?? '')}…`)
					return await bus.ask(String(p.actor ?? ''), String(p.question ?? ''), 'composer')
				},
				complete: async (p) => {
					// The one reduce runs for minutes — the caps ARE the progress
					// seam: label the round, then tick the stream as Kimi works.
					const label = String(p.system ?? '').includes('PLAN round')
						? 'Composer writes the proofs'
						: 'Kimi designs the actor'
					progress?.(`${label}…`)
					let streamed = 0
					let lastTick = 0
					const result = await bus.dispatch('composer', 'llm_complete', {
						system: String(p.system ?? ''),
						question: String(p.question ?? ''),
						settings: {
							...COMPOSER_SETTINGS,
							signal: options.signal?.(),
							onDelta: (delta: { reasoning?: string; text?: string }) => {
								streamed += (delta.reasoning?.length ?? 0) + (delta.text?.length ?? 0)
								const now = Date.now()
								if (now - lastTick < 800) return
								lastTick = now
								progress?.(`${label}… ~${Math.round(streamed / 4)} tokens`)
							}
						}
					})
					try {
						const parsed = JSON.parse(result.record) as { ok?: boolean; text?: unknown }
						if (parsed.ok !== false) return String(parsed.text ?? '')
					} catch {
						// fall through
					}
					return ''
				},
				probe: async (p) => {
					progress?.('Membrane: validating and proving the draft…')
					return await probeDraft(
						p.draft as unknown as ActorDraft,
						(p.proofs as unknown as Proof[]) ?? []
					)
				},
				stage: (p) => stageDraft(bus, p.draft as unknown as ActorDraft, options.make),
				promote: (p) => promoteStaged(bus, String(p.to ?? '')),
				discard: (p) => discardStaged(bus, String(p.to ?? ''))
			}
		)
	}
}
