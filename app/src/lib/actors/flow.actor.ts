import type { Manifest } from './actor'
import { Actor } from './actor'
import type { MessageBus } from './bus'
import { discardStaged, promoteStaged } from './draft-pipeline'
import { type Recipe, validateRecipe } from './flow-recipe'

/**
 * The generic flow orchestrator (0137): ONE sandboxed logic that runs ANY
 * recipe over registered step actors. The recipe rides in as `source`; each
 * STEP hop dispatches one step actor through the `step` capability with the
 * accumulated flow data, commits real state (stepRows, data, history), and
 * hands the baton on via the continuation pump. Holds are first-class:
 * hold:'human' stops the pump until ANSWER arrives, hold:'button' stops it
 * for the physical Promote/Discard. The onFail seam is the scrum cycle —
 * jump back with the error riding in `data.retry`, a shared failure budget
 * across the run.
 *
 * No recipe-specific host code exists: the composer, and every flow after
 * it, is a recipe plus a thin manifest naming its tools.
 */

const FLOW_LOGIC = `
function stepIndexOf(recipe, actor) {
	for (var i = 0; i < recipe.steps.length; i++) {
		if (recipe.steps[i].actor === actor) return i
	}
	return -1
}

function labelOf(st) {
	return st.label || st.actor
}

function stepRows(s) {
	var rows = []
	var running = s.phase === 'running'
	var current = running ? s.cursor + 1 : s.cursor
	for (var i = 0; i < s.recipe.steps.length; i++) {
		var st = s.recipe.steps[i]
		var label = labelOf(st)
		// Round counting is HONEST: only the step that actually re-entered
		// (retryStep) wears the counter, capped at its own budget — a global
		// tries must not label steps that never ran.
		if (s.tries > 0 && s.retryStep === st.actor && st.onFail) {
			label = label + ' ' + Math.min(s.tries + 1, st.onFail.maxRuns) + '/' + st.onFail.maxRuns
		}
		var mark = '\\u25cb'
		if (s.phase === 'failed') {
			mark = i < s.failedAt ? '\\u2713' : i === s.failedAt ? '\\u2715' : '\\u25cb'
		} else if (s.phase === 'staged' || s.phase === 'done') {
			mark = '\\u2713'
		} else if (s.phase === 'reused' || s.phase === 'negotiate') {
			mark = i <= s.cursor ? '\\u2713' : '\\u25cb'
		} else if (s.holding) {
			mark = i < s.cursor ? '\\u2713' : i === s.cursor ? '\\u25d0' : '\\u25cb'
		} else if (running) {
			mark = i < current ? '\\u2713' : i === current ? '\\u25d0' : '\\u25cb'
		}
		rows.push({ mark: mark, label: label, actor: st.actor, index: i })
	}
	return rows
}

function present(s) {
	var goalRows = []
	if (s.data.wish && s.data.wish.text) goalRows.push({ quote: s.data.wish.text })
	var questionRows = []
	if (s.holding && s.data.clarify && s.data.clarify.questions) {
		for (var q = 0; q < s.data.clarify.questions.length; q++) {
			questionRows.push({ q: s.data.clarify.questions[q] })
		}
	}
	var failedRows = []
	if (s.phase === 'failed' && s.history.length > 0) {
		var last = s.history[s.history.length - 1]
		failedRows.push({ error: last.error, excerpt: last.excerpt })
	}
	var running = s.phase === 'running'
	var activeIndex =
		s.viewStep >= 0
			? s.viewStep
			: running
				? Math.min(s.cursor + 1, s.recipe.steps.length - 1)
				: s.phase === 'failed'
					? s.failedAt
					: Math.max(s.cursor, 0)
	var active = s.recipe.steps[activeIndex]
	var title =
		s.holding && s.phase === 'mockup' ? 'The face is staged'
		: s.holding ? 'A few questions first'
		: running ? labelOf(s.recipe.steps[Math.min(s.cursor + 1, s.recipe.steps.length - 1)]) + '\\u2026'
		: s.phase === 'staged' && s.staged ? 'Staged: ' + s.staged.id
		: s.phase === 'failed' ? 'Draft failed'
		: s.phase === 'reused' ? 'Nothing new needed'
		: s.phase === 'negotiate' ? 'A bridge, not a new actor'
		: s.phase === 'done' ? s.recipe.name + ' \\u2014 done'
		: 'Idle \\u2014 nothing staged yet'
	var note =
		s.holding && s.phase === 'mockup'
			? 'Say what to change \\u2014 or say passt to continue to the logic.'
			: s.holding
				? 'Answer by voice \\u2014 one answer may cover all questions.'
			: s.phase === 'failed' && s.tries > 0
				? 'Say it again or differently \\u2014 the retries are spent.'
				: s.phase === 'failed'
					? 'The run died before drafting \\u2014 the error below says why.'
					: s.phase === 'staged'
						? 'The instance is live. Promote makes it production, Discard disposes it.'
						: 'Each step is its own actor \\u2014 tap a done step to see its face.'
	return {
		recipe: s.recipe,
		phase: s.phase,
		data: s.data,
		cursor: s.cursor,
		tries: s.tries,
		history: s.history,
		staged: s.staged,
		produced: s.produced,
		failedAt: s.failedAt,
		holding: s.holding,
		viewStep: s.viewStep,
		retryStep: s.retryStep,
		title: title,
		note: note,
		activeStep: active ? active.actor : '',
		stepRows: stepRows(s),
		goalRows: goalRows,
		questionRows: questionRows,
		failedRows: failedRows,
		producedRows: s.produced
	}
}

function initState(source) {
	return present({
		recipe: source.recipe, phase: 'idle', data: {}, cursor: -1, tries: 0,
		history: [], staged: null, produced: [], failedAt: -1, holding: false,
		viewStep: -1, retryStep: null
	})
}

function copy(state) {
	return {
		recipe: state.recipe, phase: state.phase, data: state.data,
		cursor: state.cursor, tries: state.tries, history: state.history.slice(),
		staged: state.staged, produced: state.produced.slice(),
		failedAt: state.failedAt, holding: state.holding, viewStep: state.viewStep,
		retryStep: state.retryStep
	}
}

function reduce(state, ev) {
	var s = copy(state)

	if (ev.send === 'START') {
		s.phase = 'running'
		s.data = {}
		s.cursor = -1
		s.tries = 0
		s.history = []
		s.staged = null
		s.failedAt = -1
		s.holding = false
		s.viewStep = -1
		s.retryStep = null
		for (var k in ev.payload) {
			var v = ev.payload[k]
			s.data[k] = v && typeof v === 'object' ? v : { text: String(v == null ? '' : v) }
		}
		for (var i = 0; i < s.recipe.inputs.length; i++) {
			var f = s.recipe.inputs[i]
			var name = f.indexOf('(') === -1 ? f : f.slice(0, f.indexOf('('))
			var got = s.data[name]
			if (!got || (got.text !== undefined && String(got.text).trim() === '')) {
				s.phase = 'idle'
				return {
					state: present(s),
					said: 'I am missing the input "' + name + '" \\u2014 tell me what should exist.',
					record: { ok: false, error: 'missing input: ' + name }
				}
			}
		}
		return {
			state: present(s),
			said: 'Running ' + s.recipe.name + '\\u2026',
			record: { ok: true, next: { send: 'STEP' } }
		}
	}

	if (ev.send === 'ANSWER') {
		if (!s.holding) {
			return {
				state: present(s),
				said: 'There is nothing to answer right now.',
				record: { ok: false, error: 'not holding' }
			}
		}
		// The answer is keyed PER STEP (clarify_answer, mockup_answer, ...) so
		// later steps keep seeing the clarify context untouched. resume:'self'
		// re-enters the holding step with the answer as feedback — the mockup
		// iteration; the default proceeds down the chain — the clarify pattern.
		var holdStep = s.recipe.steps[s.cursor]
		var key = holdStep ? holdStep.actor + '_answer' : 'answers'
		s.data[key] = { ok: true, text: String(ev.payload.text || '') }
		s.holding = false
		s.phase = 'running'
		if (holdStep && holdStep.resume === 'self') s.cursor = s.cursor - 1
		return {
			state: present(s),
			said: 'Thanks \\u2014 the flow continues.',
			record: { ok: true, next: { send: 'STEP' } }
		}
	}

	if (ev.send === 'STEP') {
		// The step itself runs OUTSIDE this VM: the call directive asks the
		// pump to dispatch the step actor between reduces — the asyncified
		// module allows one suspended sandbox at a time, so a flow must never
		// hold its own VM open while a step's VM suspends on the model lane.
		var nextIdx = s.cursor + 1
		var nextStep = s.recipe.steps[nextIdx]
		if (!nextStep) {
			s.phase = 'done'
			return {
				state: present(s),
				said: s.recipe.name + ' is done.',
				record: { ok: true, done: true }
			}
		}
		return {
			state: present(s),
			said: labelOf(nextStep) + '\\u2026',
			record: {
				ok: true,
				call: { method: nextStep.actor + '_run', payload: s.data, resume: 'STEP_DONE' }
			}
		}
	}

	if (ev.send === 'STEP_DONE') {
		var idx = s.cursor + 1
		var st = s.recipe.steps[idx]
		if (!st) return state
		var out = ev.payload.out
		if (!out || typeof out !== 'object') out = { ok: false, error: 'step returned nothing' }
		s.data[st.actor] = out

		if (out.ok === false) {
			s.history.push({ error: String(out.error || 'step failed'), excerpt: String(out.excerpt || '') })
			// tries counts SCRUM failures only: a step without onFail failing
			// is a pre-draft death, and the note must not claim spent rounds.
			if (st.onFail) {
				if (s.tries + 1 < st.onFail.maxRuns) {
					s.tries = s.tries + 1
					s.retryStep = st.onFail.backTo
					s.data.retry = { error: String(out.error || ''), previous: String(out.excerpt || '') }
					s.cursor = stepIndexOf(s.recipe, st.onFail.backTo) - 1
					s.phase = 'running'
					return {
						state: present(s),
						said:
							'The ' + labelOf(st) + ' step failed: ' + out.error +
							' \\u2014 round ' + (s.tries + 1) + ' of ' + st.onFail.maxRuns + ' with the error in hand.',
						record: { ok: false, error: String(out.error || ''), next: { send: 'STEP' } }
					}
				}
				s.tries = s.tries + 1
			}
			s.phase = 'failed'
			s.failedAt = idx
			return {
				state: present(s),
				said:
					s.tries > 1
						? 'Three rounds and still failing: ' + out.error + ' \\u2014 say it again or differently.'
						: 'Failed at ' + labelOf(st) + ': ' + out.error + ' \\u2014 say it again or differently.',
				record: { ok: false, error: String(out.error || '') }
			}
		}

		s.cursor = idx
		if (st.hold === 'human' && out.hold === true) {
			s.holding = true
			s.phase = out.phase || 'holding'
			var qs = out.questions || []
			return {
				state: present(s),
				// The holding step may speak for itself (the mockup: "say what to
				// change"); the question join is the clarify default.
				said: out.say ? String(out.say) : 'Before I design, tell me: ' + qs.join(' \\u00b7 '),
				record: { ok: true, clarifying: qs, held: st.actor }
			}
		}
		if (out.finish && out.finish.phase) {
			s.phase = out.finish.phase
			if (out.staged) s.staged = out.staged
			var said =
				out.negotiate
					? 'No new actor needed \\u2014 say "negotiate ' + out.negotiate.from + ' with ' + out.negotiate.to + '". ' + (out.reason || '')
					: out.reused
						? (out.reason || 'An existing actor covers this.') + ' Instance "' + out.reused.name + '" is running.'
						: s.recipe.name + ' finished: ' + s.phase + '.'
			var record = { ok: true }
			for (var kk in out) { if (kk !== 'finish' && kk !== 'hold') record[kk] = out[kk] }
			return { state: present(s), said: said, record: record }
		}
		if (st.hold === 'button') {
			s.phase = out.phase || 'staged'
			s.staged = out.staged || null
			var record2 = { ok: true }
			for (var k2 in out) { if (k2 !== 'hold') record2[k2] = out[k2] }
			return {
				state: present(s),
				said:
					s.staged
						? 'Staged "' + s.staged.id + '" \\u2014 it runs live now. Try it, then Promote or Discard by button; voice cannot promote.'
						: labelOf(st) + ' holds for the button.',
				record: record2
			}
		}
		return {
			state: present(s),
			said: labelOf(st) + ' is done \\u2014 next step.',
			record: { ok: true, next: { send: 'STEP' } }
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

	if (ev.send === 'SHOW_STEP') {
		s.viewStep = typeof ev.payload.index === 'number' ? ev.payload.index : -1
		return {
			state: present(s),
			said: '',
			record: { ok: true }
		}
	}

	return state
}

function shape(state, rawText) {
	return null
}
`

/**
 * A flow instance: a manifest (naming the flow's tools — compose,
 * compose_answer, …) plus a recipe, orchestrated by the ONE generic logic.
 * The recipe is validated against the mesh at construction — an invalid
 * recipe never runs.
 */
export class FlowActor extends Actor {
	constructor(bus: MessageBus, manifest: Manifest, recipe: Recipe) {
		const problem = validateRecipe(bus, recipe)
		if (problem) {
			throw new Error(
				`recipe "${recipe.id}" is not provable: ${problem.reason}` +
					(problem.predicate ? ` (${problem.predicate})` : '')
			)
		}
		// The graph must SHOW the flow fed by its steps: every step's produced
		// predicate is something this flow consumes into its data — declared as
		// requires, the derived graph draws step → flow without hand-wiring,
		// and the inter-step edges (plan → draft → probe) come from the steps'
		// own contracts.
		const stepFeeds = [
			...new Set(recipe.steps.flatMap((step) => bus.get(step.actor)?.produces ?? []))
		]
		super(
			{
				...manifest,
				requires: [...(manifest.requires ?? []), ...recipe.inputs, ...stepFeeds],
				capabilities: ['promote', 'discard'],
				logic: FLOW_LOGIC,
				source: { recipe }
			},
			{},
			{
				promote: (p) => promoteStaged(bus, String(p.to ?? '')),
				discard: (p) => discardStaged(bus, String(p.to ?? ''))
			}
		)
	}
}
