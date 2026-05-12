import type { SkillWorkerBrain } from '@jaensen/skills'

import { toFlueBrainModelError } from './errors'
import { buildWorkerPrompt } from './prompts'
import { skillWorkerResultSchema, validateWorkerResult } from './schemas'
import { createSupervisorSessionName, createWorkerSessionName } from './session-names'
import type { CreateFlueSkillWorkerBrainInput } from './types'

export function createFlueSkillWorkerBrain(input: CreateFlueSkillWorkerBrainInput): SkillWorkerBrain {
	return {
		async run({ skill, workerId, actorState, envelope }) {
			const workerPolicy = readWorkerPolicy(skill.frontmatter)
			const prompt = buildWorkerPrompt({
				skill,
				workerId,
				actorState,
				envelope,
				workspaceRoot: input.workspaceRoot,
				resourceHints: readResourceHints(skill.frontmatter),
				workerPolicy
			})

			try {
				const response = await runWorkerPrompt({
					harness: input.harness,
					skillId: skill.id,
					workerId,
					workerPolicy,
					prompt,
					workspaceRoot: input.workspaceRoot,
					model: input.model,
					thinkingLevel: input.thinkingLevel
				})

				return validateWorkerResult(readFlueData(response))
			} catch (error) {
				throw toFlueBrainModelError(`Flue worker run failed for skill ${skill.id} worker ${workerId}`, error)
			}
		}
	}
}

async function runWorkerPrompt(input: {
	harness: CreateFlueSkillWorkerBrainInput['harness']
	skillId: string
	workerId: string
	workerPolicy: 'ephemeral' | 'pooled' | 'durable'
	prompt: string
	workspaceRoot: string
	model?: string
	thinkingLevel?: string
}) {
	if (input.workerPolicy === 'durable' || input.workerPolicy === 'pooled') {
		const session = await input.harness.session(createWorkerSessionName(input.skillId, input.workerId), {
			role: 'jaensen-skill-worker'
		})

		return session.prompt(input.prompt, {
			schema: skillWorkerResultSchema,
			role: 'jaensen-skill-worker',
			model: input.model,
			thinkingLevel: input.thinkingLevel
		})
	}

	const parentSession = await input.harness.session(createSupervisorSessionName(input.skillId), {
		role: 'jaensen-skill-supervisor'
	})

	return parentSession.task(input.prompt, {
		schema: skillWorkerResultSchema,
		cwd: input.workspaceRoot,
		role: 'jaensen-skill-worker',
		model: input.model,
		thinkingLevel: input.thinkingLevel
	})
}

function readWorkerPolicy(frontmatter: Record<string, unknown>): 'ephemeral' | 'pooled' | 'durable' {
	const policy = frontmatter.worker_policy
	if (policy === 'durable' || policy === 'pooled') {
		return policy
	}

	return 'ephemeral'
}

function readResourceHints(frontmatter: Record<string, unknown>): unknown {
	return frontmatter.resources ?? null
}

function readFlueData<T>(value: T): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
		return (value as { data: unknown }).data
	}

	return value
}
