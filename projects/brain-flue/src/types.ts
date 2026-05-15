import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type {
	DispatcherBrain,
	DispatcherDecision,
	DispatcherState,
	IntentBrain,
	IntentBrainDecision,
	IntentState
} from '@jaensen/conversation-actors'
import type { SkillDefinition, SkillWorkerBrain, SkillWorkerResult } from '@jaensen/skills'

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface FlueHarnessAdapter {
	session(name: string, options?: { role?: string }): Promise<FlueSessionAdapter>
}

export interface FlueSessionAdapter {
	prompt(text: string, options: {
		schema: unknown
		role?: string
		model?: string
		thinkingLevel?: string
		signal?: AbortSignal
	}): Promise<unknown>

	task(text: string, options: {
		schema: unknown
		cwd?: string
		role?: string
		model?: string
		thinkingLevel?: string
		signal?: AbortSignal
	}): Promise<unknown>

	shell(command: string, options?: {
		cwd?: string
		signal?: AbortSignal
		timeoutMs?: number
		maxOutputBytes?: number
	}): Promise<{
		stdout: string
		stderr: string
		exitCode: number
		timedOut?: boolean
		aborted?: boolean
	}>
}

export interface CreateFlueSkillWorkerBrainInput {
	harness: FlueHarnessAdapter
	workspaceRoot: string
	skillsRoot?: string
	uploadRoot?: string
	resolveAttachmentScopeId?: (envelope: EnvelopeRecord) => string | undefined
	model?: string
	thinkingLevel?: ThinkingLevel
}

export interface CreateFlueDispatcherBrainInput {
	harness: FlueHarnessAdapter
	model?: string
	thinkingLevel?: ThinkingLevel
}

export interface CreateFlueIntentBrainInput {
	harness: FlueHarnessAdapter
	model?: string
	thinkingLevel?: ThinkingLevel
}

export interface SupervisorBrainInput {
	skill: SkillDefinition
	actorState: unknown
	envelope: EnvelopeRecord
}

export interface WorkerBrainInput {
	skill: Parameters<SkillWorkerBrain['run']>[0]['skill']
	workerActorId: string
	workerName: string
	actorState: Parameters<SkillWorkerBrain['run']>[0]['actorState']
	envelope: EnvelopeRecord
}

export type {
	DispatcherBrain,
	DispatcherDecision,
	DispatcherState,
	IntentBrain,
	IntentBrainDecision,
	IntentState,
	SkillWorkerBrain,
	SkillWorkerResult
}