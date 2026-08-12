import { functor, type Predicate } from './actor'
import type { MessageBus } from './bus'
import { unifiable } from './term'

/**
 * The recipe (0137) — a declared chain of STEP ACTORS, as plain data.
 *
 * Board 0083 dissolved the old flow engine into the actor model because "a
 * stored flow template freezes a judgment". The recipe returns WITHOUT that
 * sin, because it is built OF the primitives that exist now: every step is
 * a full actor (manifest, sandboxed logic, its own view), step IO are the
 * same Prolog contracts everything speaks, the chain runs on the
 * continuation pump — and the recipe itself is code-owned JSON that the
 * PROVER validates statically: change the registry and the recipe must be
 * provable again, or it does not run.
 */

export interface RecipeStep {
	/** The step actor's template id — its output lands in flow data under this key. */
	actor: string
	/** Stepper label; defaults to the actor id. */
	label?: string
	/**
	 * Hold semantics: 'human' — the step may HOLD the flow (its record says
	 * hold:true) until a flow_answer arrives; 'button' — the step's outcome
	 * waits for a physical button press (view events on the flow), the pump
	 * never continues past it.
	 */
	hold?: 'human' | 'button'
	/**
	 * The scrum seam: when this step fails, jump back to `backTo` with the
	 * error riding in flow data as `retry` — at most `maxRuns` failures
	 * across the whole run before the flow fails for good.
	 */
	onFail?: { backTo: string; maxRuns: number }
}

export interface Recipe {
	id: string
	name: string
	/** What the world must supply to start — external facts, as predicates. */
	inputs: Predicate[]
	steps: RecipeStep[]
}

export interface RecipeProblem {
	step: string
	predicate: string
	reason: string
}

/**
 * Static validation — the prover's judgment over the chain: every step's
 * requires must unify with something a PRIOR step produces or a declared
 * flow input. An invalid recipe never runs; the first problem is named.
 */
export function validateRecipe(bus: MessageBus, recipe: Recipe): RecipeProblem | null {
	const known: Predicate[] = [...recipe.inputs]
	for (const step of recipe.steps) {
		const actor = bus.get(step.actor)
		if (!actor) {
			return { step: step.actor, predicate: '', reason: `no actor "${step.actor}" in the mesh` }
		}
		for (const need of actor.requires) {
			if (!known.some((k) => unifiable(k, need))) {
				return {
					step: step.actor,
					predicate: functor(need),
					reason:
						`step "${step.actor}" requires ${need}, but no prior step produces it ` +
						'and it is no declared flow input'
				}
			}
		}
		if (step.onFail && !recipe.steps.some((s) => s.actor === step.onFail?.backTo)) {
			return {
				step: step.actor,
				predicate: '',
				reason: `onFail.backTo "${step.onFail.backTo}" is not a step of this recipe`
			}
		}
		known.push(...actor.produces)
	}
	return null
}
