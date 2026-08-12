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
 * The Composer (0135/0136) — abject's ObjectCreator as a REAL state machine:
 *
 *   CLARIFY → SCOUT → PLAN → DRAFT ⇄ PROBE → STAGE
 *
 * Each phase is one reduce with a real state commit; a phase hands the
 * baton on via `record.next` and the bus's continuation pump drives the
 * machine forward — Stop simply stops pumping. Two phases hold for the
 * world instead of chaining: CLARIFY waits for the HUMAN (feature questions
 * answered by voice through compose_answer), and STAGE waits for the
 * button-only Promote/Discard.
 *
 * The verdict ladder (SCOUT): reuse before negotiate before compose — an
 * existing actor that covers the wish is spawned directly; a vocabulary gap
 * between existing actors is referred to the negotiator; only what is
 * genuinely new proceeds to proofs and design. DRAFT⇄PROBE is the scrum
 * cycle: a membrane failure re-enters the design round with the exact error
 * in the brief, three rounds at most.
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

const COMPOSER_LOGIC = `
var STEPS = ['Clarify', 'Scout', 'Plan', 'Draft', 'Probe', 'Stage']
var PHASE_INDEX = { clarifying: 0, scouting: 1, planning: 2, drafting: 3, probing: 4 }

function stepRows(s) {
	var rows = []
	for (var i = 0; i < STEPS.length; i++) {
		var label = STEPS[i]
		if (i === 3 && s.round > 1) label = 'Draft ' + s.round + '/3'
		var mark = '\\u25cb'
		if (s.phase === 'staged') mark = '\\u2713'
		else if (s.phase === 'failed') {
			mark = i < s.failedAt ? '\\u2713' : i === s.failedAt ? '\\u2715' : '\\u25cb'
		} else if (s.phase === 'reused' || s.phase === 'negotiate') {
			mark = i <= 1 ? '\\u2713' : '\\u25cb'
		} else if (PHASE_INDEX[s.phase] !== undefined) {
			var cur = PHASE_INDEX[s.phase]
			mark = i < cur ? '\\u2713' : i === cur ? '\\u25d0' : '\\u25cb'
		}
		rows.push({ mark: mark, label: label })
	}
	return rows
}

function present(s) {
	var goalRows = s.goal ? [{ quote: s.goal }] : []
	var questionRows = []
	if (s.phase === 'clarifying') {
		for (var q = 0; q < s.questions.length; q++) questionRows.push({ q: s.questions[q] })
	}
	var verdictRows = []
	if (s.verdict && (s.phase === 'reused' || s.phase === 'negotiate')) {
		verdictRows.push({
			label: s.phase === 'reused' ? 'Reuse' : 'Negotiate',
			reason: s.verdict.reason || ''
		})
	}
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
		interviewRows.push({ actor: s.interviews[j].actor, answer: s.interviews[j].answer })
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
		s.phase === 'clarifying' ? 'A few questions first'
		: s.phase === 'scouting' ? 'Scouting the mesh\\u2026'
		: s.phase === 'planning' ? 'Writing the proofs\\u2026'
		: s.phase === 'drafting' ? 'Kimi is designing\\u2026'
		: s.phase === 'probing' ? 'Membrane: validating & proving\\u2026'
		: s.phase === 'staged' && s.staged ? 'Staged: ' + s.staged.id
		: s.phase === 'failed' ? 'Draft failed'
		: s.phase === 'reused' ? 'Nothing new needed'
		: s.phase === 'negotiate' ? 'A bridge, not a new actor'
		: 'Idle \\u2014 nothing staged yet'
	var note =
		s.phase === 'clarifying'
			? 'Answer by voice \\u2014 one answer may cover all questions.'
			: s.phase === 'drafting' && s.round > 1
				? 'Round ' + s.round + ' of 3 \\u2014 the membrane error rides in the brief.'
				: s.phase === 'staged'
					? 'The proofs below are PROVEN \\u2014 the instance is live. Promote makes it production, Discard disposes it.'
					: s.phase === 'failed' && s.failedAt >= 3
						? 'Say it again or differently \\u2014 three rounds were spent.'
						: s.phase === 'failed'
							? 'The run died before drafting \\u2014 the error below says why.'
							: 'Proofs first \\u2014 the measurable "done" comes before any design.'
	return {
		phase: s.phase,
		goal: s.goal,
		questions: s.questions,
		answers: s.answers,
		interviews: s.interviews,
		proofs: s.proofs,
		draft: s.draft,
		round: s.round,
		staged: s.staged,
		history: s.history,
		produced: s.produced,
		verdict: s.verdict,
		failedAt: s.failedAt,
		title: title,
		note: note,
		ticker: '',
		streamRows: [],
		phaseRows: stepRows(s),
		goalRows: goalRows,
		questionRows: questionRows,
		verdictRows: verdictRows,
		proofRows: proofRows,
		interviewRows: interviewRows,
		stagedRows: stagedRows,
		failedRows: failedRows,
		producedRows: s.produced
	}
}

function initState(source) {
	return present({
		phase: 'idle', goal: '', questions: [], answers: [], interviews: [],
		proofs: [], draft: null, round: 0, staged: null, history: [],
		produced: [], verdict: null, failedAt: 0
	})
}

function copy(state) {
	return {
		phase: state.phase, goal: state.goal,
		questions: state.questions.slice(), answers: state.answers.slice(),
		interviews: state.interviews.slice(), proofs: state.proofs.slice(),
		draft: state.draft, round: state.round, staged: state.staged,
		history: state.history.slice(), produced: state.produced.slice(),
		verdict: state.verdict, failedAt: state.failedAt
	}
}

function parse(raw) {
	try { return JSON.parse(raw) } catch (e) { return null }
}

function failed(s, error, excerpt, failedAt, said) {
	s.phase = 'failed'
	s.failedAt = failedAt
	s.history.push({ wish: s.goal, error: error, excerpt: excerpt })
	return { state: present(s), said: said, record: { ok: false, error: error } }
}

function reduce(state, ev) {
	var s = copy(state)

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
		s.questions = []
		s.answers = []
		s.interviews = []
		s.proofs = []
		s.draft = null
		s.round = 0
		s.staged = null
		s.verdict = null
		s.failedAt = 0

		var clarify = parse(cap('complete', {
			system: ${JSON.stringify(CLARIFY_BRIEF)},
			question: JSON.stringify({ wish: wish })
		}))
		var qs = clarify && clarify.questions ? clarify.questions : []
		if (qs.length > 0) {
			// The machine HOLDS: no next — the human answers by voice, the
			// chat relays it as compose_answer, and ANSWER resumes the chain.
			s.phase = 'clarifying'
			s.questions = qs
			return {
				state: present(s),
				said: 'Before I design, tell me: ' + qs.join(' \\u00b7 '),
				record: { ok: true, clarifying: qs }
			}
		}
		s.phase = 'scouting'
		return {
			state: present(s),
			said: 'The wish is precise \\u2014 scouting the mesh.',
			record: { ok: true, next: { send: 'SCOUT' } }
		}
	}

	if (ev.send === 'ANSWER') {
		if (s.phase !== 'clarifying') {
			return {
				state: present(s),
				said: 'There is nothing to answer right now.',
				record: { ok: false, error: 'not clarifying' }
			}
		}
		s.answers.push(String(ev.payload.text || ''))
		s.phase = 'scouting'
		return {
			state: present(s),
			said: 'Thanks \\u2014 scouting the mesh now.',
			record: { ok: true, next: { send: 'SCOUT' } }
		}
	}

	if (ev.send === 'SCOUT') {
		var rows = cap('actors')
		var verdict = parse(cap('complete', {
			system: ${JSON.stringify(SCOUT_BRIEF)},
			question: JSON.stringify({ wish: s.goal, answers: s.answers, actors: rows })
		}))
		// A scout that answers garbage must not kill the run — compose is the
		// safe default rung of the ladder.
		if (!verdict || !verdict.verdict) verdict = { verdict: 'compose', reason: 'scout unreadable' }
		s.verdict = verdict

		if (verdict.verdict === 'reuse' && verdict.reuse && verdict.reuse.template) {
			var spawned = cap('spawn', {
				template: verdict.reuse.template,
				name: verdict.reuse.name
			})
			if (spawned) {
				s.phase = 'reused'
				return {
					state: present(s),
					said:
						verdict.reuse.template + ' already covers this \\u2014 instance "' +
						spawned.name + '" is running. ' + (verdict.reason || ''),
					record: { ok: true, reused: spawned, reason: verdict.reason || '' }
				}
			}
			// not spawnable — fall through the ladder to compose
		}
		if (verdict.verdict === 'negotiate' && verdict.negotiate && verdict.negotiate.from) {
			s.phase = 'negotiate'
			return {
				state: present(s),
				said:
					'No new actor needed \\u2014 bridge ' + verdict.negotiate.from + ' with ' +
					verdict.negotiate.to + ': say "negotiate ' + verdict.negotiate.from +
					' with ' + verdict.negotiate.to + '". ' + (verdict.reason || ''),
				record: { ok: true, negotiate: verdict.negotiate, reason: verdict.reason || '' }
			}
		}
		var asks = verdict.ask || []
		for (var i = 0; i < asks.length; i++) {
			var answer = cap('ask', { actor: asks[i].actor, question: asks[i].question })
			s.interviews.push({ actor: asks[i].actor, question: asks[i].question, answer: answer })
		}
		s.phase = 'planning'
		return {
			state: present(s),
			said: 'Something new is needed \\u2014 writing the proofs.',
			record: { ok: true, next: { send: 'PLAN' } }
		}
	}

	if (ev.send === 'PLAN') {
		var planRaw = cap('complete', {
			system: ${JSON.stringify(PLAN_BRIEF)},
			question: JSON.stringify({ wish: s.goal, answers: s.answers, interviews: s.interviews })
		})
		var plan = parse(planRaw)
		if (!plan || !plan.proofs || plan.proofs.length === 0) {
			return failed(
				s, 'the plan round produced no proofs', String(planRaw).slice(0, 240), 2,
				'I could not derive a measurable definition of done \\u2014 nothing was drafted.'
			)
		}
		s.proofs = plan.proofs
		s.phase = 'drafting'
		s.round = 1
		return {
			state: present(s),
			said: 'The proofs stand \\u2014 Kimi designs against them now.',
			record: { ok: true, next: { send: 'DRAFT' } }
		}
	}

	if (ev.send === 'DRAFT') {
		var exemplar = cap('manifest', { actor: 'workitem' })
		var retry = null
		if (s.round > 1 && s.history.length > 0) {
			var lastTry = s.history[s.history.length - 1]
			retry = { error: lastTry.error, previous: lastTry.excerpt }
		}
		var raw = cap('complete', {
			system: ${JSON.stringify(DESIGN_BRIEF)},
			question: JSON.stringify({
				wish: s.goal, answers: s.answers, proofs: s.proofs,
				interviews: s.interviews, exemplar: exemplar, retry: retry
			})
		})
		var draft = parse(raw)
		if (!draft || typeof draft.id !== 'string' || draft.id === '' ||
			typeof draft.logic !== 'string' || draft.logic === '') {
			var perr = 'round ' + s.round + ': the model did not return a usable draft'
			s.history.push({ wish: s.goal, error: perr, excerpt: String(raw).slice(0, 240) })
			if (s.round < 3) {
				s.round = s.round + 1
				s.phase = 'drafting'
				return {
					state: present(s),
					said: 'That draft was unusable \\u2014 retrying with the error in hand (round ' + s.round + ' of 3).',
					record: { ok: false, error: perr, next: { send: 'DRAFT' } }
				}
			}
			s.phase = 'failed'
			s.failedAt = 3
			return {
				state: present(s),
				said: 'Three rounds, no usable draft \\u2014 say it again or differently.',
				record: { ok: false, error: perr }
			}
		}
		s.draft = draft
		s.phase = 'probing'
		return {
			state: present(s),
			said: 'Draft ' + s.round + ' is in \\u2014 the membrane proves it now.',
			record: { ok: true, next: { send: 'PROBE' } }
		}
	}

	if (ev.send === 'PROBE') {
		var probe = cap('probe', { draft: s.draft, proofs: s.proofs })
		if (probe && probe.ok === true) {
			return {
				state: present(s),
				said: 'Proven \\u2014 staging the instance.',
				record: { ok: true, next: { send: 'STAGE' } }
			}
		}
		var perr2 = probe && probe.error ? probe.error : 'membrane probe failed'
		s.history.push({
			wish: s.goal,
			error: perr2,
			excerpt: String(s.draft && s.draft.logic ? s.draft.logic : '').slice(0, 240)
		})
		if (s.round < 3) {
			s.round = s.round + 1
			s.phase = 'drafting'
			return {
				state: present(s),
				said: 'The membrane rejected draft: ' + perr2 + ' \\u2014 round ' + s.round + ' of 3 with the error in hand.',
				record: { ok: false, error: perr2, next: { send: 'DRAFT' } }
			}
		}
		s.phase = 'failed'
		s.failedAt = 4
		return {
			state: present(s),
			said: 'Three rounds and the membrane still says no: ' + perr2 + ' \\u2014 say it again or differently.',
			record: { ok: false, error: perr2 }
		}
	}

	if (ev.send === 'STAGE') {
		var staged = cap('stage', { draft: s.draft })
		s.staged = {
			uuid: staged.uuid,
			name: staged.name,
			id: s.draft.id,
			description: String(s.draft.description || ''),
			draft: s.draft
		}
		s.phase = 'staged'
		return {
			state: present(s),
			said:
				'Staged "' + s.draft.id + '" \\u2014 it runs live as a staging instance now. ' +
				'Try it, then Promote or Discard by button; voice cannot promote.',
			record: {
				ok: true,
				staged: { uuid: staged.uuid, name: staged.name, id: s.draft.id },
				proofs: s.proofs
			}
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
		'The ObjectCreator as a state machine: clarifies the wish with the HUMAN ' +
		'first, scouts the mesh (reuse before negotiate before compose), writes ' +
		'measurable proofs, lets the model design against them in scrum rounds, ' +
		'proves each draft behind the membrane, and stages the result as a live ' +
		'"next" instance. Promote (button-only) makes it production with a code export.',
	tags: ['system'],
	capabilities: [
		'actors',
		'manifest',
		'ask',
		'complete',
		'probe',
		'stage',
		'promote',
		'discard',
		'spawn'
	],
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
					// The stepper: the whole flow as one line of chips — ✓ done,
					// ◐ current, ○ pending, ✕ failed; scrum rounds count on Draft.
					class: 'cp-steps',
					$each: {
						items: '$phaseRows',
						template: {
							class: 'cp-step',
							children: [
								{ class: 'cp-step-mark', text: '$$mark' },
								{ class: 'cp-step-label', text: '$$label' }
							]
						}
					}
				},
				{ class: 'cp-ticker', text: '$ticker' },
				{
					class: 'cp-streambox',
					$each: {
						items: '$streamRows',
						template: { tag: 'pre', class: 'cp-stream', text: '$$text' }
					}
				},
				{
					class: 'cp-goal',
					$each: { items: '$goalRows', template: { class: 'cp-quote', text: '$$quote' } }
				},
				{
					class: 'cp-questions',
					$each: {
						items: '$questionRows',
						template: { class: 'cp-question', text: '$$q' }
					}
				},
				{
					class: 'cp-verdict',
					$each: {
						items: '$verdictRows',
						template: {
							class: 'cp-verdict-row',
							children: [
								{ class: 'cp-chip', text: '$$label' },
								{ class: 'cp-verdict-reason', text: '$$reason' }
							]
						}
					}
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
			'.cp-steps': { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
			'.cp-step': {
				display: 'flex',
				alignItems: 'baseline',
				gap: '0.35rem',
				padding: '0.25rem 0.7rem',
				borderRadius: 'var(--radius-pill)',
				border: '1px solid var(--border)',
				background: 'var(--surface)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)'
			},
			'.cp-step-mark': { fontFamily: 'var(--font-mono)', color: 'var(--muted)' },
			'.cp-step-label': { fontWeight: '600' },
			'.cp-ticker': {
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted)'
			},
			'.cp-stream': {
				margin: '0',
				padding: '0.6rem 0.75rem',
				borderRadius: 'var(--radius-inner)',
				background: 'var(--bg-a)',
				fontFamily: 'var(--font-mono)',
				fontSize: 'var(--fs-micro)',
				color: 'var(--muted-strong)',
				whiteSpace: 'pre-wrap',
				overflowWrap: 'anywhere'
			},
			'.cp-goal': { display: 'flex', flexDirection: 'column' },
			'.cp-quote': {
				padding: '0.5rem 0.9rem',
				borderLeft: '3px solid var(--border)',
				fontSize: 'var(--fs-body)',
				fontStyle: 'italic',
				color: 'var(--muted-strong)'
			},
			'.cp-questions': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
			'.cp-question': {
				padding: '0.6rem 0.9rem',
				borderRadius: 'var(--radius-inner)',
				border: '1px solid var(--border)',
				background: 'var(--surface)',
				fontSize: 'var(--fs-body)'
			},
			'.cp-verdict': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
			'.cp-verdict-row': { display: 'flex', alignItems: 'baseline', gap: '0.6rem' },
			'.cp-verdict-reason': { fontSize: 'var(--fs-body)', color: 'var(--muted-strong)' },
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
				'Turns a wish into a new actor through real phases: clarifies with the ' +
				'human first (it may HOLD and ask questions — relay the answer with ' +
				'compose_answer), scouts the mesh for reuse, writes measurable proofs, ' +
				'designs in scrum rounds, and stages the result as a live instance. ' +
				'Promotion happens ONLY by button — there is no promote tool, so never ' +
				'claim you promoted.',
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
		},
		{
			name: 'compose_answer',
			description:
				"The human's answer to the composer's clarify questions, verbatim. Call " +
				'this when the composer asked questions and the user just answered them ' +
				'— it resumes the compose chain.',
			parameters: {
				type: 'object',
				properties: {
					text: {
						type: 'string',
						description: "The user's answer, in their words."
					}
				},
				required: ['text']
			},
			event: { send: 'ANSWER' }
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
}

export class ComposerActor extends Actor {
	constructor(bus: MessageBus, options: ComposerOptions = {}) {
		// The one remaining host write (0136): the token ticker. Phases commit
		// real state now; only the stream count is narrated by the host while
		// a completion is in flight, and the next commit clears it.
		const seam: { tick?: (note: string, stream?: string) => void } = {}
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
				ask: async (p) =>
					await bus.ask(String(p.actor ?? ''), String(p.question ?? ''), 'composer'),
				complete: async (p) => {
					let streamed = 0
					let lastTick = 0
					// The live tail: WHAT the model is writing right now — reasoning
					// and answer text alike — not just how much. 8.5k tokens behind a
					// bare counter was dead air; this is the window watching Kimi work.
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
						const parsed = JSON.parse(result.record) as {
							ok?: boolean
							text?: unknown
							error?: unknown
						}
						if (parsed.ok !== false) return String(parsed.text ?? '')
						// The lane FAILED (timeout, abort, HTTP error) — say so as
						// DATA: the sandbox parses this, finds no proofs/draft, and
						// keeps the real cause in its failure excerpt. A silent ''
						// was how "the plan round produced no proofs" hid a 163s
						// upstream death.
						return JSON.stringify({ lane_error: String(parsed.error ?? result.wire) })
					} catch {
						return JSON.stringify({ lane_error: result.wire.slice(0, 200) })
					}
				},
				probe: async (p) =>
					await probeDraft(
						p.draft as unknown as ActorDraft,
						(p.proofs as unknown as Proof[]) ?? []
					),
				stage: (p) => stageDraft(bus, p.draft as unknown as ActorDraft, options.make),
				promote: (p) => promoteStaged(bus, String(p.to ?? '')),
				discard: (p) => discardStaged(bus, String(p.to ?? '')),
				// The verdict ladder's first rung: reuse spawns directly (Samuel,
				// 2026-08-12) — the reason rides in the record, no extra gate.
				spawn: (p) => {
					const spawned = bus.spawn(String(p.template ?? ''), p.name ? String(p.name) : undefined)
					return spawned ? { uuid: spawned.uuid, name: spawned.instanceName } : null
				}
			}
		)
		seam.tick = (note, stream) => {
			this.state = {
				...(this.state ?? {}),
				ticker: note,
				...(stream && { streamRows: [{ text: stream }] })
			}
		}
	}
}
