import type { JaensenStorage, IntentRecord } from '../storage/types.js'
import type { SandboxFactory } from '../sandbox/types.js'

export interface JaensenInput {
	message: string
	from?: string
	subject?: string
	metadata?: Record<string, unknown>
	attachment?: {
		archiveKey?: string
		name?: string
		contentType?: string
		base64?: string
	}
}

export interface DispatcherRoutingDecision {
	relevantIntentIds: string[]
	createIntent?: { title: string; summary: string }
}

export interface RegisteredSkill {
	id: string
	description?: string
	doc: string
	operations: string[]
	runtimeSupported: boolean
}

export type SkillRegistry = Record<string, RegisteredSkill>

export interface SkillAction {
	skill: string
	operation: string
	input: Record<string, unknown>
}

export interface IntentDecision {
	summary: string
	status?: IntentRecord['status']
	contextUpdates?: Record<string, unknown>
	actions: SkillAction[]
	humanLoop?: { needed: boolean; reason?: string; message?: string }
	replyDraft: string
}

export interface SkillResult {
	skill: string
	ok: boolean
	summary: string
	data?: Record<string, unknown>
}

export interface RuntimeDependencies {
	storage: JaensenStorage
	sandboxFactory: SandboxFactory
	generate: (prompt: string) => Promise<string>
	now?: Date
	skillRegistry: SkillRegistry
}

export interface RunResult {
	response: string
	routing: DispatcherRoutingDecision
	primaryIntent: IntentRecord
	relevantIntents: IntentRecord[]
	intentDecision: IntentDecision
	skillResults: SkillResult[]
	humanNotification?: string
}