import type { Manifest, MethodSpec, Predicate } from './actor'
import { Actor } from './actor'
import type { MessageBus } from './bus'
import { COMPOSER_SETTINGS } from './composer.actor'
import { type ActorDraft, type Proof, probeDraft, stageDraft } from './draft-pipeline'

/**
 * The composer's six phases as SIX FULL ACTORS (0137) — each with its own
 * manifest, sandboxed logic, Prolog contracts and its own view. The flow
 * engine orchestrates them through a recipe; each is independently
 * dispatchable, independently testable, and reusable in other recipes.
 *
 * The step protocol, spoken through ordinary records:
 * - input: the flow's accumulated data, keyed by step id (`wish`, `answers`,
 *   `clarify`, `scout`, `plan`, `draft`, `retry`, …), passed verbatim as the
 *   RUN payload
 * - output: `{ok, ...}` — plus `hold: true` (a human must answer before the
 *   flow continues), `finish: {phase}` (the whole flow ends here), or
 *   `error`/`excerpt` on failure (the flow's onFail seam may re-enter)
 */

const CLARIFY_BRIEF =
	'You are the CLARIFY round of an actor composer: decide whether the human ' +
	'wish needs feature clarification BEFORE anything is designed. Reply with ' +
	'EXACTLY one JSON object, no markdown: {"questions": [up to 3 short ' +
	'questions to the human about features, scope or behaviour, in the language ' +
	'of the wish]}. A precise wish gets {"questions": []} — ask ONLY when the ' +
	'answer would change the design.'

const SCOUT_BRIEF =
	'You are the SCOUT round of an actor composer. Given the wish, the human ' +
	'clarifications and every actor in the mesh (with contracts and methods), ' +
	'decide the verdict ladder: reuse before negotiate before compose. Reply ' +
	'with EXACTLY one JSON object, no markdown: {"verdict": "reuse"|"negotiate"' +
	'|"compose", "reason": one sentence, "reuse": {"template": actor id, ' +
	'"name": short instance name} only for reuse, "negotiate": {"from": id, ' +
	'"to": id} only for negotiate, "ask": [{"actor": id, "question": one ' +
	'question about exact payload shapes}] only for compose. reuse = an ' +
	'existing actor (or a fresh instance of one) already covers the wish; ' +
	'negotiate = two existing actors cover it but their vocabularies do not ' +
	'meet; compose = something genuinely new is needed.'

const PLAN_BRIEF =
	'You are the PLAN round of an actor composer. From the human wish, the ' +
	'clarifications and the mesh interviews, write the measurable definition of ' +
	'done BEFORE anything is designed. Reply with EXACTLY one JSON object, no ' +
	'markdown: {"proofs": [{"goal": a Prolog predicate like streak(S), "seed": ' +
	'{external facts as flat JSON}, "expect": {record fields the final step ' +
	'must carry, with exact expected values}}]}. 1-3 proofs, deterministic ' +
	'seeds — a proof must be checkable by running it.'

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
	'expected fields. If the input carries "retry", your PREVIOUS attempt failed ' +
	'the membrane with exactly retry.error — fix that, do not repeat it. The ' +
	'exemplar manifest shows the house style — imitate it.'

/** The shared face vocabulary of every step window. */
const STEP_STYLE = {
	selectors: {
		'.st-shell': {
			width: '100%',
			maxWidth: '44rem',
			minWidth: '0',
			display: 'flex',
			flexDirection: 'column',
			gap: '0.75rem'
		},
		'.st-title': { margin: '0', fontSize: 'var(--fs-title)', fontWeight: '600' },
		'.st-note': { fontSize: 'var(--fs-body)', color: 'var(--muted)' },
		'.st-ticker': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-micro)',
			color: 'var(--muted)'
		},
		'.st-rows': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
		'.st-row': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.25rem',
			padding: '0.5rem 0.75rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid var(--border)',
			background: 'var(--surface)'
		},
		'.st-row-head': {
			display: 'flex',
			alignItems: 'baseline',
			gap: '0.6rem',
			flexWrap: 'wrap'
		},
		'.st-mono': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-micro)',
			color: 'var(--muted-strong)'
		},
		'.st-strong': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-small)',
			fontWeight: '600'
		},
		'.st-body': { fontSize: 'var(--fs-small)', color: 'var(--muted-strong)' },
		'.st-pre': {
			margin: '0',
			maxHeight: '10rem',
			overflow: 'auto',
			padding: '0.6rem 0.75rem',
			borderRadius: 'var(--radius-inner)',
			background: 'var(--bg-a)',
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-micro)',
			whiteSpace: 'pre-wrap',
			overflowWrap: 'anywhere'
		}
	}
} as Manifest['style']

/** One RUN entry — engine-only, never a voice tool. */
function runMethod(
	id: string,
	description: string,
	requires: Predicate[],
	produces: Predicate[]
): MethodSpec {
	return {
		name: `${id}_run`,
		description,
		parameters: { type: 'object', properties: {}, additionalProperties: true },
		requires,
		produces,
		event: { send: 'RUN' },
		internal: true
	}
}

/** The step view skeleton: title, note, live ticker + stream, then rows. */
function stepView(label: string, rows: Record<string, unknown>[]): Manifest['view'] {
	return {
		content: {
			class: 'brand-shell st-shell',
			children: [
				{ class: 'eyebrow', text: label },
				{ tag: 'h2', class: 'st-title', text: '$title' },
				{ class: 'st-note', text: '$note' },
				{ class: 'st-ticker', text: '$ticker' },
				{
					class: 'st-rows',
					$each: {
						items: '$streamRows',
						template: { tag: 'pre', class: 'st-pre', text: '$$text' }
					}
				},
				...rows
			]
		}
	}
}

const CLARIFY_LOGIC = `
function present(s) {
	var rows = []
	for (var i = 0; i < s.questions.length; i++) rows.push({ q: s.questions[i] })
	return {
		questions: s.questions,
		title: s.questions.length > 0 ? 'Questions for the human' : s.ran ? 'Nothing to clarify' : 'Clarify',
		note: s.questions.length > 0
			? 'Answer by voice \\u2014 one answer may cover all questions.'
			: 'Asks the human BEFORE anything is designed \\u2014 only when the answer would change the design.',
		ticker: '', streamRows: [],
		questionRows: rows, ran: s.ran
	}
}
function initState(source) { return present({ questions: [], ran: false }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var wish = ev.payload.wish && ev.payload.wish.text ? String(ev.payload.wish.text) : ''
	if (!wish) {
		return { state: present({ questions: [], ran: true }),
			said: 'There is no wish to clarify.',
			record: { ok: false, error: 'empty wish' } }
	}
	var raw = cap('complete', { system: ${JSON.stringify(CLARIFY_BRIEF)}, question: JSON.stringify({ wish: wish }) })
	var parsed = null
	try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
	var qs = parsed && parsed.questions ? parsed.questions : []
	return {
		state: present({ questions: qs, ran: true }),
		said: qs.length > 0 ? 'Before I design, tell me: ' + qs.join(' \\u00b7 ') : 'The wish is precise \\u2014 no questions.',
		record: { ok: true, questions: qs, hold: qs.length > 0, phase: 'clarifying' }
	}
}
function shape(state, rawText) { return null }
`

const SCOUT_LOGIC = `
function present(s) {
	var iv = []
	for (var i = 0; i < s.interviews.length; i++) iv.push({ actor: s.interviews[i].actor, answer: s.interviews[i].answer })
	return {
		interviews: s.interviews, verdict: s.verdict,
		title: s.verdict ? 'Verdict: ' + s.verdict.verdict : 'Scout',
		note: s.verdict && s.verdict.reason ? s.verdict.reason : 'Reuse before negotiate before compose \\u2014 the mesh is asked first.',
		ticker: '', streamRows: [],
		interviewRows: iv
	}
}
function initState(source) { return present({ interviews: [], verdict: null }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var wish = ev.payload.wish && ev.payload.wish.text ? String(ev.payload.wish.text) : ''
	var answers = ev.payload.answers && ev.payload.answers.text ? [String(ev.payload.answers.text)] : []
	var rows = cap('actors')
	var raw = cap('complete', {
		system: ${JSON.stringify(SCOUT_BRIEF)},
		question: JSON.stringify({ wish: wish, answers: answers, actors: rows })
	})
	var verdict = null
	try { verdict = JSON.parse(raw) } catch (e) { verdict = null }
	if (!verdict || !verdict.verdict) verdict = { verdict: 'compose', reason: 'scout unreadable' }

	if (verdict.verdict === 'reuse' && verdict.reuse && verdict.reuse.template) {
		var spawned = cap('spawn', { template: verdict.reuse.template, name: verdict.reuse.name })
		if (spawned) {
			return {
				state: present({ interviews: [], verdict: verdict }),
				said: verdict.reuse.template + ' already covers this \\u2014 instance "' + spawned.name + '" is running. ' + (verdict.reason || ''),
				record: { ok: true, verdict: 'reuse', finish: { phase: 'reused' }, reused: spawned, reason: verdict.reason || '' }
			}
		}
	}
	if (verdict.verdict === 'negotiate' && verdict.negotiate && verdict.negotiate.from) {
		return {
			state: present({ interviews: [], verdict: verdict }),
			said: 'No new actor needed \\u2014 bridge ' + verdict.negotiate.from + ' with ' + verdict.negotiate.to + '. ' + (verdict.reason || ''),
			record: { ok: true, verdict: 'negotiate', finish: { phase: 'negotiate' }, negotiate: verdict.negotiate, reason: verdict.reason || '' }
		}
	}
	var interviews = []
	var asks = verdict.ask || []
	for (var i = 0; i < asks.length; i++) {
		var answer = cap('ask', { actor: asks[i].actor, question: asks[i].question })
		interviews.push({ actor: asks[i].actor, question: asks[i].question, answer: answer })
	}
	return {
		state: present({ interviews: interviews, verdict: verdict }),
		said: 'Something new is needed \\u2014 handing over to the proofs.',
		record: { ok: true, verdict: 'compose', reason: verdict.reason || '', interviews: interviews }
	}
}
function shape(state, rawText) { return null }
`

const PLAN_LOGIC = `
function present(s) {
	var rows = []
	for (var i = 0; i < s.proofs.length; i++) {
		rows.push({
			goal: s.proofs[i].goal,
			detail: 'seed ' + JSON.stringify(s.proofs[i].seed || {}) + ' \\u2192 ' + JSON.stringify(s.proofs[i].expect || {})
		})
	}
	return {
		proofs: s.proofs,
		title: s.proofs.length > 0 ? 'The proofs stand' : 'Plan',
		note: 'Proofs first \\u2014 the measurable "done" comes before any design.',
		ticker: '', streamRows: [],
		proofRows: rows
	}
}
function initState(source) { return present({ proofs: [] }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var wish = ev.payload.wish && ev.payload.wish.text ? String(ev.payload.wish.text) : ''
	var answers = ev.payload.answers && ev.payload.answers.text ? [String(ev.payload.answers.text)] : []
	var interviews = ev.payload.scout && ev.payload.scout.interviews ? ev.payload.scout.interviews : []
	var raw = cap('complete', {
		system: ${JSON.stringify(PLAN_BRIEF)},
		question: JSON.stringify({ wish: wish, answers: answers, interviews: interviews })
	})
	var plan = null
	try { plan = JSON.parse(raw) } catch (e) { plan = null }
	if (!plan || !plan.proofs || plan.proofs.length === 0) {
		return {
			state: present({ proofs: [] }),
			said: 'I could not derive a measurable definition of done.',
			record: { ok: false, error: 'the plan round produced no proofs', excerpt: String(raw).slice(0, 240) }
		}
	}
	return {
		state: present({ proofs: plan.proofs }),
		said: 'The proofs stand \\u2014 design happens against them.',
		record: { ok: true, proofs: plan.proofs }
	}
}
function shape(state, rawText) { return null }
`

const DRAFT_LOGIC = `
function present(s) {
	var rows = []
	if (s.draft) {
		var entries = []
		var ms = s.draft.methods || []
		for (var k = 0; k < ms.length; k++) entries.push(ms[k].name + ' \\u2192 ' + ms[k].event.send)
		rows.push({ id: s.draft.id, description: String(s.draft.description || ''), entriesLine: entries.join(' \\u00b7 '), logicPreview: String(s.draft.logic || '').slice(0, 400) })
	}
	return {
		draft: s.draft, round: s.round,
		title: s.draft ? 'Draft: ' + s.draft.id : s.round > 1 ? 'Designing \\u2014 round ' + s.round : 'Draft',
		note: s.round > 1 ? 'The membrane error rides in the brief \\u2014 the model must fix exactly that.' : 'Kimi designs against the proofs.',
		ticker: '', streamRows: [],
		draftRows: rows
	}
}
function initState(source) { return present({ draft: null, round: 0 }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var wish = ev.payload.wish && ev.payload.wish.text ? String(ev.payload.wish.text) : ''
	var answers = ev.payload.answers && ev.payload.answers.text ? [String(ev.payload.answers.text)] : []
	var proofs = ev.payload.plan && ev.payload.plan.proofs ? ev.payload.plan.proofs : []
	var interviews = ev.payload.scout && ev.payload.scout.interviews ? ev.payload.scout.interviews : []
	var retry = ev.payload.retry || null
	var round = state.round + 1
	var exemplar = cap('manifest', { actor: 'workitem' })
	var raw = cap('complete', {
		system: ${JSON.stringify(DESIGN_BRIEF)},
		question: JSON.stringify({ wish: wish, answers: answers, proofs: proofs, interviews: interviews, exemplar: exemplar, retry: retry })
	})
	var draft = null
	try { draft = JSON.parse(raw) } catch (e) { draft = null }
	if (!draft || typeof draft.id !== 'string' || draft.id === '' || typeof draft.logic !== 'string' || draft.logic === '') {
		return {
			state: present({ draft: null, round: round }),
			said: 'The model did not return a usable draft.',
			record: { ok: false, error: 'the model did not return a usable draft', excerpt: String(raw).slice(0, 240) }
		}
	}
	return {
		state: present({ draft: draft, round: round }),
		said: 'Draft "' + draft.id + '" is in \\u2014 the membrane proves it next.',
		record: { ok: true, draft: draft }
	}
}
function shape(state, rawText) { return null }
`

const PROBE_LOGIC = `
function present(s) {
	var rows = []
	if (s.result) rows.push({ text: s.result })
	return {
		title: s.ok === true ? 'Proven' : s.ok === false ? 'Membrane says no' : 'Probe',
		note: 'Validators, sandbox smoke, and every proof on a scratch bus \\u2014 before any human sees it.',
		ticker: '', streamRows: [],
		resultRows: rows, ok: s.ok
	}
}
function initState(source) { return present({ ok: null, result: '' }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var draft = ev.payload.draft && ev.payload.draft.draft ? ev.payload.draft.draft : null
	var proofs = ev.payload.plan && ev.payload.plan.proofs ? ev.payload.plan.proofs : []
	if (!draft) {
		return { state: present({ ok: false, result: 'no draft to probe' }),
			said: 'There is no draft to probe.',
			record: { ok: false, error: 'no draft to probe', excerpt: '' } }
	}
	var probe = cap('probe', { draft: draft, proofs: proofs })
	if (probe && probe.ok === true) {
		return { state: present({ ok: true, result: 'every proof satisfied' }),
			said: 'Proven \\u2014 staging is next.',
			record: { ok: true, proven: true } }
	}
	var perr = probe && probe.error ? probe.error : 'membrane probe failed'
	return {
		state: present({ ok: false, result: perr }),
		said: 'The membrane rejected the draft: ' + perr,
		record: { ok: false, error: perr, excerpt: String(draft.logic || '').slice(0, 240) }
	}
}
function shape(state, rawText) { return null }
`

const STAGE_LOGIC = `
function present(s) {
	var rows = []
	if (s.staged) rows.push({ id: s.staged.id, name: s.staged.name, hint: 'Runs as a staging instance ("next") \\u2014 try it, then Promote or Discard.' })
	return {
		staged: s.staged,
		title: s.staged ? 'Staged: ' + s.staged.id : 'Stage',
		note: 'The best preview is the running actor.',
		ticker: '', streamRows: [],
		stagedRows: rows
	}
}
function initState(source) { return present({ staged: null }) }
function reduce(state, ev) {
	if (ev.send !== 'RUN') return state
	var draft = ev.payload.draft && ev.payload.draft.draft ? ev.payload.draft.draft : null
	if (!draft) {
		return { state: present({ staged: null }),
			said: 'There is nothing to stage.',
			record: { ok: false, error: 'nothing to stage', excerpt: '' } }
	}
	var staged = cap('stage', { draft: draft })
	var entry = { uuid: staged.uuid, name: staged.name, id: draft.id, description: String(draft.description || ''), draft: draft }
	return {
		state: present({ staged: entry }),
		said: 'Staged "' + draft.id + '" \\u2014 it runs live now. Promote or Discard by button; voice cannot promote.',
		record: { ok: true, staged: entry }
	}
}
function shape(state, rawText) { return null }
`

/** Seam per step: the live ticker/stream tail, written by the host caps. */
interface StepSeam {
	tick?: (note: string, stream?: string) => void
}

export interface StepOptions {
	signal?: () => AbortSignal | undefined
	/** Reactive subclass for STAGED instances (the stage step's spawn). */
	make?: (manifest: Manifest) => Actor
	/** Actor factory for the steps themselves (reactive in the app). */
	step?: (
		manifest: Manifest,
		caps: Record<string, (p: Record<string, unknown>) => unknown>
	) => Actor
}

/** The kimi lane with live tail, shared by every step that completes. */
function completeCap(bus: MessageBus, options: StepOptions, seam: StepSeam) {
	return async (p: Record<string, unknown>) => {
		let streamed = 0
		let lastTick = 0
		let tail = ''
		const result = await bus.dispatch('composer', 'llm_complete', {
			system: String(p.system ?? ''),
			question: String(p.question ?? ''),
			settings: {
				...COMPOSER_SETTINGS,
				signal: options.signal?.(),
				onDelta: (delta: { reasoning?: string; text?: string }) => {
					streamed += (delta.reasoning?.length ?? 0) + (delta.text?.length ?? 0)
					tail = (tail + (delta.reasoning ?? '') + (delta.text ?? '')).slice(-700)
					const now = Date.now()
					if (now - lastTick < 500) return
					lastTick = now
					seam.tick?.(`kimi · ~${Math.round(streamed / 4)} tokens`, tail)
				}
			}
		})
		try {
			const parsed = JSON.parse(result.record) as { ok?: boolean; text?: unknown; error?: unknown }
			if (parsed.ok !== false) return String(parsed.text ?? '')
			return JSON.stringify({ lane_error: String(parsed.error ?? result.wire) })
		} catch {
			return JSON.stringify({ lane_error: result.wire.slice(0, 200) })
		}
	}
}

function makeStep(
	options: StepOptions,
	manifest: Manifest,
	caps: Record<string, (p: Record<string, unknown>) => unknown>,
	seam: StepSeam
): Actor {
	const actor = options.step ? options.step(manifest, caps) : new Actor(manifest, {}, caps)
	seam.tick = (note, stream) => {
		actor.state = {
			...(actor.state ?? {}),
			ticker: note,
			...(stream && { streamRows: [{ text: stream }] })
		}
	}
	return actor
}

/**
 * Build the six composer steps against a bus. Each is a full actor; the
 * caller registers them. Order matters only in the RECIPE, not here.
 */
export function createComposerSteps(bus: MessageBus, options: StepOptions = {}): Actor[] {
	const rowsOf = () =>
		bus.actors().map((a) => ({
			uuid: a.uuid,
			id: a.manifest.id,
			name: a.instanceName,
			tags: a.manifest.tags,
			requires: a.requires,
			produces: a.produces,
			methods: a.manifest.methods.map((m) => m.name)
		}))

	const clarifySeam: StepSeam = {}
	const clarify = makeStep(
		options,
		{
			id: 'clarify',
			name: 'Clarify',
			description:
				'The flow step that interviews the HUMAN first: derives up to three ' +
				'feature questions from the wish and holds the flow until they are answered.',
			tags: ['step'],
			capabilities: ['complete'],
			logic: CLARIFY_LOGIC,
			view: stepView('Clarify', [
				{
					class: 'st-rows',
					$each: { items: '$questionRows', template: { class: 'st-row', text: '$$q' } }
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod(
					'clarify',
					'Runs the clarify round over the flow data.',
					['wish(W)'],
					['clarify(C)']
				)
			]
		},
		{ complete: completeCap(bus, options, clarifySeam) },
		clarifySeam
	)

	const scoutSeam: StepSeam = {}
	const scout = makeStep(
		options,
		{
			id: 'scout',
			name: 'Scout',
			description:
				'The flow step that rules the verdict ladder: reuse before negotiate ' +
				'before compose — interviews the mesh caller-aware and may spawn a ' +
				'covering instance directly.',
			tags: ['step'],
			capabilities: ['actors', 'complete', 'ask', 'spawn'],
			logic: SCOUT_LOGIC,
			view: stepView('Scout', [
				{
					class: 'st-rows',
					$each: {
						items: '$interviewRows',
						template: {
							class: 'st-row',
							children: [
								{ class: 'st-mono', text: '$$actor' },
								{ class: 'st-body', text: '$$answer' }
							]
						}
					}
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod('scout', 'Runs the scout verdict over the flow data.', ['wish(W)'], ['scout(S)'])
			]
		},
		{
			actors: rowsOf,
			complete: completeCap(bus, options, scoutSeam),
			ask: async (p) => await bus.ask(String(p.actor ?? ''), String(p.question ?? ''), 'composer'),
			spawn: (p) => {
				const spawned = bus.spawn(String(p.template ?? ''), p.name ? String(p.name) : undefined)
				return spawned ? { uuid: spawned.uuid, name: spawned.instanceName } : null
			}
		},
		scoutSeam
	)

	const planSeam: StepSeam = {}
	const plan = makeStep(
		options,
		{
			id: 'plan',
			name: 'Plan',
			description:
				'The flow step that writes the measurable definition of done — Prolog ' +
				'proof goals with deterministic seeds — BEFORE any design.',
			tags: ['step'],
			capabilities: ['complete'],
			logic: PLAN_LOGIC,
			view: stepView('Plan', [
				{
					class: 'st-rows',
					$each: {
						items: '$proofRows',
						template: {
							class: 'st-row',
							children: [
								{ class: 'st-strong', text: '$$goal' },
								{ class: 'st-mono', text: '$$detail' }
							]
						}
					}
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod('plan', 'Writes the proofs over the flow data.', ['wish(W)'], ['plan(P)'])
			]
		},
		{ complete: completeCap(bus, options, planSeam) },
		planSeam
	)

	const draftSeam: StepSeam = {}
	const draft = makeStep(
		options,
		{
			id: 'draft',
			name: 'Draft',
			description:
				'The flow step that lets the model design the complete actor against ' +
				'the proofs — scrum rounds re-enter here with the membrane error in the brief.',
			tags: ['step'],
			capabilities: ['manifest', 'complete'],
			logic: DRAFT_LOGIC,
			view: stepView('Draft', [
				{
					class: 'st-rows',
					$each: {
						items: '$draftRows',
						template: {
							class: 'st-row',
							children: [
								{ class: 'st-strong', text: '$$id' },
								{ class: 'st-body', text: '$$description' },
								{ class: 'st-mono', text: '$$entriesLine' },
								{ tag: 'pre', class: 'st-pre', text: '$$logicPreview' }
							]
						}
					}
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod('draft', 'Designs the actor over the flow data.', ['plan(P)'], ['draft(D)'])
			]
		},
		{
			manifest: (p) => bus.get(String(p.actor ?? ''))?.manifest ?? null,
			complete: completeCap(bus, options, draftSeam)
		},
		draftSeam
	)

	const probeSeam: StepSeam = {}
	const probe = makeStep(
		options,
		{
			id: 'probe',
			name: 'Probe',
			description:
				'The membrane as a flow step: validators, a sandbox smoke run, and ' +
				'every proof satisfied on a scratch bus — or the exact error, named.',
			tags: ['step'],
			capabilities: ['probe'],
			logic: PROBE_LOGIC,
			view: stepView('Probe', [
				{
					class: 'st-rows',
					$each: { items: '$resultRows', template: { class: 'st-row', text: '$$text' } }
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod(
					'probe',
					'Proves the draft over the flow data.',
					['draft(D)', 'plan(P)'],
					['probe(Q)']
				)
			]
		},
		{
			probe: async (p) =>
				await probeDraft(p.draft as unknown as ActorDraft, (p.proofs as unknown as Proof[]) ?? [])
		},
		probeSeam
	)

	const stageSeam: StepSeam = {}
	const stage = makeStep(
		options,
		{
			id: 'stage',
			name: 'Stage',
			description:
				'The flow step that spawns the proven draft as a LIVE staging instance ' +
				'("next") — the flow then holds for the button-only Promote/Discard.',
			tags: ['step'],
			capabilities: ['stage'],
			logic: STAGE_LOGIC,
			view: stepView('Stage', [
				{
					class: 'st-rows',
					$each: {
						items: '$stagedRows',
						template: {
							class: 'st-row',
							children: [
								{ class: 'st-strong', text: '$$id' },
								{ class: 'st-body', text: '$$hint' }
							]
						}
					}
				}
			]),
			style: STEP_STYLE,
			methods: [
				runMethod(
					'stage',
					'Stages the proven draft over the flow data.',
					['probe(Q)', 'draft(D)'],
					['stage(A)']
				)
			]
		},
		{ stage: (p) => stageDraft(bus, p.draft as unknown as ActorDraft, options.make) },
		stageSeam
	)

	return [clarify, scout, plan, draft, probe, stage]
}
