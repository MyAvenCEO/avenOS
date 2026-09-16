import {
	parseStudioSkillV2,
	StudioSkillV2Error,
	type StudioSkillPort,
	type StudioSkillStep
} from './v2'

export interface SkillPresentationStep {
	id: string
	label: string
	kind: string
	depth: number
	context?: string
	childArtifactId?: string
}

export interface SkillPresentation {
	artifactId: string
	artifactDigest: string
	status: 'valid' | 'unsupported-version' | 'malformed'
	version: number | null
	name: string
	inputs: Array<{ name: string; type: string; cardinality: string }>
	outputs: Array<{ name: string; type: string; cardinality: string }>
	parameters: Array<{ name: string; type: string; required: boolean; choices?: string[] }>
	steps: SkillPresentationStep[]
	structure: { branches: number; reviews: number; openGoals: number; collections: number }
	policy: { maxInvocations?: number; maxDepth?: number; allowModel?: boolean }
	effectCoverage: 'unknown' | 'known'
	issues: Array<{ code: string; message: string }>
}

function v2Port(name: string, port: StudioSkillPort) {
	return { name, type: `${port.type.key}@${port.type.version}`, cardinality: port.cardinality }
}

function parameterType(schema: Record<string, unknown>): string {
	if (Array.isArray(schema.enum)) return 'choice'
	return typeof schema.type === 'string' ? schema.type : 'value'
}

function v2Steps(
	steps: StudioSkillStep[],
	depth = 0,
	context?: string
): SkillPresentationStep[] {
	return steps.flatMap((step) => {
		const current: SkillPresentationStep = {
			id: step.id,
			label: step.label,
			kind: step.kind,
			depth,
			...(context && { context }),
			...(step.kind === 'skill'
				? { childArtifactId: step.skillArtifactId }
				: step.kind === 'forEach'
					? { childArtifactId: step.childSkillArtifactId }
					: {})
		}
		if (step.kind !== 'when') return [current]
		return [
			current,
			...Object.entries(step.branches).flatMap(([branch, body]) =>
				v2Steps(body.steps, depth + 1, `${step.label} · ${branch}`)
			)
		]
	})
}

function structure(steps: SkillPresentationStep[]): SkillPresentation['structure'] {
	return {
		branches: steps.filter((step) => step.kind === 'when').length,
		reviews: steps.filter((step) => step.kind === 'review').length,
		openGoals: steps.filter((step) => step.kind === 'achieve' || step.kind === 'goal').length,
		collections: steps.filter((step) => step.kind === 'forEach').length
	}
}

/** Pure saved-definition projection. It never solves, probes, dispatches, or writes. */
export function presentSkillArtifact(
	artifactId: string,
	artifactDigest: string,
	typeVersion: number,
	payload: unknown
): SkillPresentation {
	const base = { artifactId, artifactDigest, effectCoverage: 'unknown' as const }
	if (typeVersion === 2) {
		try {
			const definition = parseStudioSkillV2(payload)
			const steps = v2Steps(definition.steps)
			const properties = definition.parametersSchema.properties as Record<
				string,
				Record<string, unknown>
			>
			const required = definition.parametersSchema.required as string[]
			return {
				...base,
				status: 'valid',
				version: 2,
				name: definition.name,
				inputs: Object.entries(definition.inputs).map(([name, port]) => v2Port(name, port)),
				outputs: Object.entries(definition.outputs).map(([name, port]) => v2Port(name, port)),
				parameters: Object.entries(properties).map(([name, schema]) => ({
					name,
					type: parameterType(schema),
					required: required.includes(name),
					...(Array.isArray(schema.enum) && {
						choices: schema.enum.filter((item): item is string => typeof item === 'string')
					})
				})),
				steps,
				structure: structure(steps),
				policy: definition.policy,
				issues: []
			}
		} catch (error) {
			return {
				...base,
				status: 'malformed',
				version: 2,
				name: 'Skill preview unavailable',
				inputs: [],
				outputs: [],
				parameters: [],
				steps: [],
				structure: structure([]),
				policy: {},
				issues:
					error instanceof StudioSkillV2Error
						? error.issues.map(({ code, message }) => ({ code, message }))
						: [{ code: 'MALFORMED_SKILL', message: 'The saved definition could not be read.' }]
			}
		}
	}
	return {
		...base,
		status: 'unsupported-version',
		version: typeVersion,
		name: 'Unsupported Skill version',
		inputs: [],
		outputs: [],
		parameters: [],
		steps: [],
		structure: structure([]),
		policy: {},
		issues: [{ code: 'UNSUPPORTED_VERSION', message: 'This Skill cannot be visually interpreted.' }]
	}
}
