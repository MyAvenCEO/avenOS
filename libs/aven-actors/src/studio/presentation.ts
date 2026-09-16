import { parseStudioDefinition } from './index'
import { parseStudioSkillV2, StudioSkillV2Error, type StudioSkillPort } from './v2'

export interface SkillPresentation {
	artifactId: string
	artifactDigest: string
	status: 'valid' | 'unsupported-version' | 'malformed'
	version: number | null
	name: string
	inputs: Array<{ name: string; type: string; cardinality: string }>
	outputs: Array<{ name: string; type: string; cardinality: string }>
	steps: Array<{ id: string; label: string; kind: string; childArtifactId?: string }>
	policy: { maxInvocations?: number; maxDepth?: number; allowModel?: boolean }
	effectCoverage: 'unknown' | 'known'
	issues: Array<{ code: string; message: string }>
}

function v2Port(name: string, port: StudioSkillPort) {
	return { name, type: `${port.type.key}@${port.type.version}`, cardinality: port.cardinality }
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
			return {
				...base,
				status: 'valid',
				version: 2,
				name: definition.name,
				inputs: Object.entries(definition.inputs).map(([name, port]) => v2Port(name, port)),
				outputs: Object.entries(definition.outputs).map(([name, port]) => v2Port(name, port)),
				steps: definition.steps.map((step) => ({
					id: step.id,
					label: step.label,
					kind: step.kind,
					...(step.kind === 'skill'
						? { childArtifactId: step.skillArtifactId }
						: step.kind === 'forEach'
							? { childArtifactId: step.childSkillArtifactId }
							: {})
				})),
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
				steps: [],
				policy: {},
				issues:
					error instanceof StudioSkillV2Error
						? error.issues.map(({ code, message }) => ({ code, message }))
						: [{ code: 'MALFORMED_SKILL', message: 'The saved definition could not be read.' }]
			}
		}
	}
	// The current v1 Studio remains active until the new shared runner cutover.
	// This projection is read-only and is not a v1 execution adapter.
	if (typeVersion === 1) {
		try {
			const definition = parseStudioDefinition(payload)
			return {
				...base,
				status: 'valid',
				version: 1,
				name: definition.name,
				inputs: Object.entries(definition.inputs).map(([name, type]) => ({
					name,
					type: `${type.key}@${type.version}`,
					cardinality: 'one'
				})),
				outputs: [
					{
						name: 'result',
						type: `${definition.output.type.key}@${definition.output.type.version}`,
						cardinality: 'one'
					}
				],
				steps: definition.steps.map((step) => ({
					id: step.id,
					label: step.label,
					kind: step.kind,
					...(step.kind === 'skill' && step.ref ? { childArtifactId: step.ref } : {})
				})),
				policy: definition.policy,
				issues: []
			}
		} catch {
			// Fall through to a bounded unsupported card and optional raw inspection.
		}
	}
	return {
		...base,
		status: 'unsupported-version',
		version: typeVersion,
		name: 'Unsupported Skill version',
		inputs: [],
		outputs: [],
		steps: [],
		policy: {},
		issues: [{ code: 'UNSUPPORTED_VERSION', message: 'This Skill cannot be visually interpreted.' }]
	}
}
