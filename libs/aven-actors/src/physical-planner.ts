import type { Predicate } from './actor'
import type { AuthorizedActorTarget, AuthorizedRegistryView } from './authorization'
import {
	type AdHocProgram,
	type Ingredient,
	type PlanStep,
	type SolveOptions,
	type SolveResult,
	solve
} from './planner'
import type { ExecutionEnvironment } from './registry'

export interface PhysicalPlanStep extends PlanStep {
	target: AuthorizedActorTarget
}

export interface PhysicalProgram extends Omit<AdHocProgram, 'steps'> {
	registryRevision: number
	plannedFor: { subjectId: string; tenantId?: string }
	executionEnvironment: ExecutionEnvironment
	steps: PhysicalPlanStep[]
}

export interface PhysicalPlanningOptions extends SolveOptions {
	/** One run is placed wholly in one environment. */
	executionEnvironment: ExecutionEnvironment
}

export type PhysicalPlanResult =
	| { ok: true; program: PhysicalProgram; exploredStates: number }
	| Extract<SolveResult, { ok: false }>

/** Search only the capabilities and placements visible to this principal. */
export function solveAuthorized(
	view: AuthorizedRegistryView,
	ingredients: Ingredient[],
	goals: Predicate[],
	options: PhysicalPlanningOptions
): PhysicalPlanResult {
	const capabilities = view.capabilities
		.map(({ capability, targets }) => ({
			capability,
			targets: targets.filter(
				(target) => target.executionEnvironment === options.executionEnvironment
			)
		}))
		.filter(({ targets }) => targets.length > 0)
	const logical = solve(
		capabilities.map(({ capability, targets }) => ({
			...capability,
			cost: (capability.cost ?? 1) + Math.min(...targets.map((target) => target.cost))
		})),
		ingredients,
		goals,
		options
	)
	if (!logical.ok) return logical
	const targets = new Map(
		capabilities.map(({ capability, targets: candidates }) => [capability.id, candidates[0]])
	)
	const steps: PhysicalPlanStep[] = logical.program.steps.map((step) => {
		const target = targets.get(step.capability)
		if (!target) throw new Error(`authorized target disappeared for ${step.capability}`)
		return { ...step, target }
	})
	return {
		ok: true,
		exploredStates: logical.exploredStates,
		program: {
			...logical.program,
			registryRevision: view.registryRevision,
			plannedFor: {
				subjectId: view.principal.subjectId,
				...(view.access.tenantId && { tenantId: view.access.tenantId })
			},
			executionEnvironment: options.executionEnvironment,
			steps
		}
	}
}
