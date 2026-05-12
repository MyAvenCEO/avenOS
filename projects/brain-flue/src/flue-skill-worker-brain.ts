import type { SkillWorkerBrain } from '@jaensen/skills'

import { toFlueBrainModelError } from './errors'
import { buildWorkerPrompt } from './prompts'
import { skillWorkerResultSchema, validateWorkerResult } from './schemas'
import { createSupervisorSessionName, createWorkerSessionName } from './session-names'
import type { CreateFlueSkillWorkerBrainInput } from './types'
import { runWorkerToolLoop } from './worker-tool-loop'

export function createFlueSkillWorkerBrain(input: CreateFlueSkillWorkerBrainInput): SkillWorkerBrain {
	return {
		async run({ skill, workerId, actorState, envelope, signal }) {
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
					skill,
					skillId: skill.id,
					workerId,
					actorState,
					workerPolicy,
					prompt,
					workspaceRoot: input.workspaceRoot,
					skillsRoot: input.skillsRoot,
					uploadRoot: input.uploadRoot,
					attachmentScopeId: input.resolveAttachmentScopeId?.(envelope),
					model: input.model,
					thinkingLevel: input.thinkingLevel,
					signal
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
	skill: Parameters<SkillWorkerBrain['run']>[0]['skill']
	skillId: string
	workerId: string
	actorState: Parameters<SkillWorkerBrain['run']>[0]['actorState']
	workerPolicy: 'ephemeral' | 'pooled' | 'durable'
	prompt: string
	workspaceRoot: string
	skillsRoot?: string
	uploadRoot?: string
	attachmentScopeId?: string
	model?: string
	thinkingLevel?: string
	signal?: AbortSignal
}) {
	if (input.workerPolicy === 'durable' || input.workerPolicy === 'pooled') {
		const session = await input.harness.session(createWorkerSessionName(input.skillId, input.workerId), {
			role: 'jaensen-skill-worker'
		})

		return runWorkerToolLoop({
			skill: input.skill,
			workspaceRoot: input.workspaceRoot,
			skillsRoot: input.skillsRoot,
			uploadRoot: input.uploadRoot,
			attachmentScopeId: input.attachmentScopeId,
			runShell: (command, options) => session.shell(command, options),
			invokeModel: (prompt) => session.prompt(prompt, {
				schema: skillWorkerResultSchema,
				role: 'jaensen-skill-worker',
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				signal: input.signal
			}),
			basePrompt: input.prompt,
			currentState: input.actorState,
			validateFinalResult: validateWorkerResult,
			unwrapModelData: readFlueData,
			signal: input.signal,
			shellTimeoutMs: 30_000,
			shellMaxOutputBytes: 64 * 1024
		})
	}

	const parentSession = await input.harness.session(createSupervisorSessionName(input.skillId), {
		role: 'jaensen-skill-supervisor'
	})

	return runWorkerToolLoop({
		skill: input.skill,
		workspaceRoot: input.workspaceRoot,
		skillsRoot: input.skillsRoot,
		uploadRoot: input.uploadRoot,
		attachmentScopeId: input.attachmentScopeId,
		runShell: (command, options) => parentSession.shell(command, options),
		invokeModel: (prompt) => parentSession.task(prompt, {
			schema: skillWorkerResultSchema,
			cwd: input.workspaceRoot,
			role: 'jaensen-skill-worker',
			model: input.model,
			thinkingLevel: input.thinkingLevel,
			signal: input.signal
		}),
		basePrompt: input.prompt,
		currentState: input.actorState,
		validateFinalResult: validateWorkerResult,
		unwrapModelData: readFlueData,
		signal: input.signal,
		shellTimeoutMs: 30_000,
		shellMaxOutputBytes: 64 * 1024
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
