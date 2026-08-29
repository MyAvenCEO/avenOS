import type { CapabilitySlot, Manifest, Predicate } from './actor'
import { resourceId } from './ids'
import { type Bindings, parseTerm, resolve, unify } from './term'

/** A durable value which is already available when planning starts. */
export interface Ingredient {
	predicate: Predicate
	artifactId?: string
}

/**
 * One invocable operation advertised by an actor.
 *
 * This is intentionally method-level. Actor-level requires/produces are useful
 * for discovery and diagrams, but a plan must name the envelope it can send.
 */
export interface Capability {
	id: string
	actor: string
	method: string
	requires: Predicate[]
	produces: Predicate[]
	/** A relative planning cost. Runtime telemetry can supply this later. */
	cost?: number
	/** Unavailable physical implementations remain discoverable but are not planned. */
	available?: boolean
	mode?: 'transform' | 'observe' | 'effect' | 'stream' | 'view'
	idempotency?: 'pure' | 'idempotent' | 'reconcilable' | 'none'
	parametersSchema?: Record<string, unknown>
	inputSlots?: CapabilitySlot[]
	outputSlots?: CapabilitySlot[]
}

/**
 * Turn actor registry contributions into the method-level operations the
 * planner can actually invoke.
 *
 * Method contracts win when present. Actor-level contracts remain a useful
 * shorthand for actors that expose one transformation and are inherited by a
 * method only when that method does not declare its own side of the contract.
 */
export function capabilitiesFromManifests(manifests: readonly Manifest[]): Capability[] {
	return manifests.flatMap((manifest) =>
		manifest.methods.flatMap((method) => {
			const requires = method.requires ?? manifest.requires ?? []
			const produces = method.produces ?? manifest.produces ?? []
			if (produces.length === 0) return []
			return [
				{
					id: resourceId({
						authority: manifest.authority,
						kind: 'capability',
						namespace: `${manifest.namespace}.${manifest.id}`,
						name: method.name,
						version: manifest.version
					}),
					actor: resourceId({
						authority: manifest.authority,
						kind: 'actor',
						namespace: manifest.namespace,
						name: manifest.id,
						version: manifest.version
					}),
					method: method.name,
					requires: [...requires],
					produces: [...produces],
					mode: method.mode ?? 'transform',
					idempotency: method.idempotency ?? 'none',
					...(method.cost !== undefined && { cost: method.cost }),
					parametersSchema: method.parameters,
					...(method.inputSlots && { inputSlots: method.inputSlots }),
					...(method.outputSlots && { outputSlots: method.outputSlots })
				}
			]
		})
	)
}

export interface PlanValue {
	predicate: Predicate
	source:
		| { kind: 'ingredient'; artifactId?: string }
		| { kind: 'step'; stepId: string; output: number }
}

export interface PlanStep {
	id: string
	capability: string
	actor: string
	method: string
	inputs: PlanValue[]
	outputs: PlanValue[]
	dependsOn: string[]
	cost: number
}

export interface AdHocProgram {
	goals: Predicate[]
	steps: PlanStep[]
	totalCost: number
	/** Final facts, including their symbolic or durable source. */
	results: PlanValue[]
}

export type SolveResult =
	| { ok: true; program: AdHocProgram; exploredStates: number }
	| { ok: false; unmetGoals: Predicate[]; exploredStates: number; reason: string }

export interface SolveOptions {
	maxSteps?: number
	maxStates?: number
}

interface SearchState {
	facts: PlanValue[]
	steps: PlanStep[]
	cost: number
}

interface RequirementMatch {
	bindings: Bindings
	inputs: PlanValue[]
}

const DEFAULT_MAX_STEPS = 24
const DEFAULT_MAX_STATES = 2_000

/**
 * Compile a goal into the cheapest program reachable from the supplied facts.
 *
 * This is uniform-cost forward search over AND/OR capabilities:
 * - every `requires` entry of one capability is an AND;
 * - multiple capabilities producing the same goal are alternatives (OR);
 * - predicate variables are bound consistently across all inputs of a step;
 * - the resulting dependency links expose which steps may run in parallel.
 *
 * The function plans only. It does not send envelopes or mutate runtime state.
 */
export function solve(
	capabilities: Capability[],
	ingredients: Ingredient[],
	goals: Predicate[],
	options: SolveOptions = {}
): SolveResult {
	const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
	const maxStates = options.maxStates ?? DEFAULT_MAX_STATES
	const start: SearchState = {
		facts: ingredients.map((ingredient) => ({
			predicate: ingredient.predicate,
			source: {
				kind: 'ingredient',
				...(ingredient.artifactId && { artifactId: ingredient.artifactId })
			}
		})),
		steps: [],
		cost: 0
	}
	const queue = [start]
	const best = new Map<string, number>()
	let exploredStates = 0

	while (queue.length > 0 && exploredStates < maxStates) {
		queue.sort(compareStates)
		const state = queue.shift()
		if (!state) break
		const key = stateKey(state)
		if ((best.get(key) ?? Number.POSITIVE_INFINITY) <= state.cost) continue
		best.set(key, state.cost)
		exploredStates++

		const results = resolveGoals(goals, state.facts)
		if (results) {
			return {
				ok: true,
				program: { goals, steps: state.steps, totalCost: state.cost, results },
				exploredStates
			}
		}
		if (state.steps.length >= maxSteps) continue

		for (const capability of [...capabilities].sort((a, b) => a.id.localeCompare(b.id))) {
			if (capability.available === false) continue
			for (const match of matchRequirements(capability.requires, state.facts)) {
				const outputPredicates = capability.produces.map((p) => substitute(p, match.bindings))
				if (outputPredicates.every((p) => state.facts.some((f) => unify(f.predicate, p)))) continue

				const stepId = `step-${state.steps.length + 1}`
				const outputs: PlanValue[] = outputPredicates.map((predicate, output) => ({
					predicate,
					source: { kind: 'step', stepId, output }
				}))
				const stepCost = capability.cost ?? 1
				const step: PlanStep = {
					id: stepId,
					capability: capability.id,
					actor: capability.actor,
					method: capability.method,
					inputs: match.inputs,
					outputs,
					dependsOn: [
						...new Set(
							match.inputs.flatMap((input) =>
								input.source.kind === 'step' ? [input.source.stepId] : []
							)
						)
					],
					cost: stepCost
				}
				queue.push({
					facts: [...state.facts, ...outputs],
					steps: [...state.steps, step],
					cost: state.cost + stepCost
				})
			}
		}
	}

	const reachable = closure(capabilities, start.facts, maxSteps)
	const unmetGoals = goals.filter((goal) => !reachable.some((fact) => unify(goal, fact.predicate)))
	return {
		ok: false,
		unmetGoals,
		exploredStates,
		reason:
			exploredStates >= maxStates
				? `search limit reached after ${maxStates} states`
				: `no program produces: ${unmetGoals.join(', ')}`
	}
}

function matchRequirements(requirements: Predicate[], facts: PlanValue[]): RequirementMatch[] {
	if (requirements.length === 0) return [{ bindings: {}, inputs: [] }]
	const matches: RequirementMatch[] = []
	const visit = (index: number, bindings: Bindings, inputs: PlanValue[]) => {
		if (index === requirements.length) {
			matches.push({ bindings, inputs })
			return
		}
		for (const fact of facts) {
			const next = unify(requirements[index] ?? '', fact.predicate, bindings)
			if (next) visit(index + 1, next, [...inputs, fact])
		}
	}
	visit(0, {}, [])
	return matches
}

function substitute(predicate: Predicate, bindings: Bindings): Predicate {
	const term = parseTerm(predicate)
	if (!predicate.includes('(')) return term.functor
	return `${term.functor}(${term.args.map((arg) => resolve(arg, bindings)).join(', ')})`
}

function resolveGoals(goals: Predicate[], facts: PlanValue[]): PlanValue[] | null {
	const results: PlanValue[] = []
	for (const goal of goals) {
		const fact = facts.find((candidate) => unify(goal, candidate.predicate))
		if (!fact) return null
		results.push(fact)
	}
	return results
}

function stateKey(state: SearchState): string {
	return [...state.facts.map((fact) => fact.predicate)].sort().join('|')
}

function compareStates(a: SearchState, b: SearchState): number {
	return (
		a.cost - b.cost || a.steps.length - b.steps.length || stateKey(a).localeCompare(stateKey(b))
	)
}

/** A cheap reachability pass used only to make failure diagnostics useful. */
function closure(capabilities: Capability[], initial: PlanValue[], maxSteps: number): PlanValue[] {
	let facts = [...initial]
	for (let pass = 0; pass < maxSteps; pass++) {
		let changed = false
		for (const capability of capabilities) {
			if (capability.available === false) continue
			const match = matchRequirements(capability.requires, facts)[0]
			if (!match) continue
			for (const predicate of capability.produces.map((p) => substitute(p, match.bindings))) {
				if (facts.some((fact) => unify(fact.predicate, predicate))) continue
				facts = [
					...facts,
					{ predicate, source: { kind: 'step', stepId: `closure-${capability.id}`, output: 0 } }
				]
				changed = true
			}
		}
		if (!changed) break
	}
	return facts
}
