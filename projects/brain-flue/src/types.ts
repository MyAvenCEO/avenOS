import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type {
	DispatcherBrain,
	DispatcherDecision,
	DispatcherState,
	IntentBrain,
	IntentBrainDecision,
	IntentState
} from '@jaensen/conversation-actors'
import type { SkillSupervisorBrain, SkillSupervisorDecision, SkillWorkerBrain, SkillWorkerResult } from '@jaensen/skills'

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
	}): Promise<unknown>

	task(text: string, options: {
		schema: unknown
		cwd?: string
		role?: string
		model?: string
		thinkingLevel?: string
	}): Promise<unknown>

	shell(command: string, options?: { cwd?: string }): Promise<{
		stdout: string
		stderr: string
		exitCode: number
		timedOut?: boolean
	}>
}

export interface CreateFlueSkillSupervisorBrainInput {
	harness: FlueHarnessAdapter
	workspaceRoot: string
	model?: string
	thinkingLevel?: ThinkingLevel
}

export interface CreateFlueSkillWorkerBrainInput {
	harness: FlueHarnessAdapter
	workspaceRoot: string
	skillsRoot?: string
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
	skill: Parameters<SkillSupervisorBrain['decide']>[0]['skill']
	actorState: Parameters<SkillSupervisorBrain['decide']>[0]['actorState']
	envelope: EnvelopeRecord
}

export interface WorkerBrainInput {
	skill: Parameters<SkillWorkerBrain['run']>[0]['skill']
	workerId: string
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
	SkillSupervisorBrain,
	SkillSupervisorDecision,
	SkillWorkerBrain,
	SkillWorkerResult
}