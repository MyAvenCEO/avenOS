/**
 * The universal flow template — the recipe format.
 *
 * The hierarchy is aven → skills → flows → actors: a skill is made of flows,
 * a flow is made of actors, and an actor is a blackbox transformation with a
 * Prolog-flavored contract: `requires` names the predicates that must hold
 * before it fires, `produces` names what holds afterwards. Nothing is wired
 * by hand — the graph is *derived* by unifying produces against requires,
 * the way a rule solver satisfies goals. Inputs are the flow's facts,
 * outputs are its goals.
 *
 * Composition is the composite/leaf pattern, unlimited in both directions:
 * an actor may declare `flow: <id>` and be a whole flow itself, so "Inbox
 * Triage" can contain "Classify" which is itself three actors deep.
 *
 * Descriptive now, executable later — same doctrine as board 0083, whose
 * Svelte-Flow explorer this succeeds after the avenCITY strip.
 */

/** A predicate as written in a contract: `mail(M)`, `intent(M, Class)`. */
export type Predicate = string

/** One typed opening into or out of a flow. */
export interface Port {
	id: string
	/** The predicate this port asserts (input) or expects satisfied (output). */
	predicate: Predicate
	label: string
}

/** One transformation step — the actor blackbox. */
export interface ActorStep {
	id: string
	name: string
	/** What must hold before this actor fires. */
	requires: Predicate[]
	/** What holds after it has fired. */
	produces: Predicate[]
	/** Composite pattern: this actor is itself the flow with this id. */
	flow?: string
}

export interface FlowTemplate {
	id: string
	/** The skill this flow belongs to (aven → skills → flows → actors). */
	skill: string
	name: string
	description: string
	inputs: Port[]
	outputs: Port[]
	actors: ActorStep[]
}

/** `mail(M)` → `mail` — predicates unify on their functor name. */
export function functor(p: Predicate): string {
	const at = p.indexOf('(')
	return (at === -1 ? p : p.slice(0, at)).trim()
}

/**
 * Solve the template into stages, rule-solver style.
 *
 * Start from the input facts; every actor whose requirements are satisfied
 * joins the next stage and asserts its productions; repeat until nothing new
 * fires. Actors whose requirements never resolve land in a trailing stage —
 * visibly stranded rather than silently dropped, because a recipe with an
 * unsatisfiable step is a recipe with a bug.
 */
export function stages(flow: FlowTemplate): ActorStep[][] {
	const known = new Set(flow.inputs.map((p) => functor(p.predicate)))
	const pending = [...flow.actors]
	const result: ActorStep[][] = []

	while (pending.length > 0) {
		const ready = pending.filter((a) => a.requires.every((r) => known.has(functor(r))))
		if (ready.length === 0) {
			result.push(pending.splice(0))
			break
		}
		for (const actor of ready) {
			pending.splice(pending.indexOf(actor), 1)
			for (const p of actor.produces) known.add(functor(p))
		}
		result.push(ready)
	}
	return result
}

/** Which functors this flow's outputs consume — for marking satisfied goals. */
export function producedFunctors(flow: FlowTemplate): Set<string> {
	const set = new Set(flow.inputs.map((p) => functor(p.predicate)))
	for (const actor of flow.actors) for (const p of actor.produces) set.add(functor(p))
	return set
}

/**
 * The seed recipes.
 *
 * The intent router is the most basic flow a company has: everything — mail,
 * support, human requests, new work — lands in one intent box first, gets
 * classified, and routes out. Classify is deliberately a sub-flow, so the
 * composite pattern is true from day one.
 */
export const TEMPLATES: FlowTemplate[] = [
	{
		id: 'intent-router',
		skill: 'inbox',
		name: 'Intent Router',
		description:
			'Der Posteingang der Firma: jede Anfrage wird erst Nachricht, dann Absicht, dann Arbeit.',
		inputs: [
			{ id: 'mail', predicate: 'mail(M)', label: 'Mail' },
			{ id: 'support', predicate: 'support(M)', label: 'Support' },
			{ id: 'request', predicate: 'request(M)', label: 'Anfrage' },
			{ id: 'workitem-in', predicate: 'workitem(M)', label: 'Work Item' }
		],
		outputs: [
			{ id: 'routed-work', predicate: 'work(M, Spark)', label: 'Arbeit' },
			{ id: 'routed-reply', predicate: 'antwort(M)', label: 'Antwort' },
			{ id: 'routed-archive', predicate: 'ablage(M)', label: 'Ablage' }
		],
		actors: [
			{
				id: 'inbox',
				name: 'Inbox',
				requires: ['mail(M)', 'support(M)', 'request(M)', 'workitem(M)'],
				produces: ['message(M)']
			},
			{
				id: 'classify',
				name: 'Classify',
				requires: ['message(M)'],
				produces: ['intent(M, Class)'],
				flow: 'classify'
			},
			{
				id: 'route',
				name: 'Route',
				requires: ['intent(M, Class)'],
				produces: ['work(M, Spark)', 'antwort(M)', 'ablage(M)']
			}
		]
	},
	{
		id: 'classify',
		skill: 'inbox',
		name: 'Classify',
		description: 'Ein Actor des Intent Routers, selbst ein Flow — Komposition nach unten.',
		inputs: [{ id: 'message', predicate: 'message(M)', label: 'Nachricht' }],
		outputs: [{ id: 'intent', predicate: 'intent(M, Class)', label: 'Absicht' }],
		actors: [
			{
				id: 'normalize',
				name: 'Normalize',
				requires: ['message(M)'],
				produces: ['text(M)']
			},
			{
				id: 'embed',
				name: 'Embed',
				requires: ['text(M)'],
				produces: ['vektor(M)']
			},
			{
				id: 'label',
				name: 'Label',
				requires: ['vektor(M)', 'text(M)'],
				produces: ['intent(M, Class)']
			}
		]
	}
]
