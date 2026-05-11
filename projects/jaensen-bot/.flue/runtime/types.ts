import type { JaensenStorage, IntentRecord } from '../storage/types.js'
import type { SandboxFactory } from '../sandbox/types.js'

export interface JaensenInput {
	message: string
	from?: string
	subject?: string
	metadata?: Record<string, unknown>
	attachment?: {
		name?: string
		contentType?: string
		base64: string
	}
}

export interface DispatcherRoutingDecision {
	relevantIntentIds: string[]
	createIntent?: { title: string; summary: string }
}

export type SkillAction =
	| { skill: 'memory'; operation: 'remember' | 'recall' | 'search'; input: Record<string, unknown> }
	| { skill: 'ingest'; operation: 'archive-url' | 'archive-attachment'; input: Record<string, unknown> }
	| { skill: 'extract'; operation: 'extract-text' | 'extract-entities'; input: Record<string, unknown> }

export interface IntentDecision {
	summary: string
	status?: IntentRecord['status']
	contextUpdates?: Record<string, unknown>
	actions: SkillAction[]
	humanLoop?: { needed: boolean; reason?: string; message?: string }
	replyDraft: string
}

export interface SkillResult {
	skill: 'memory' | 'ingest' | 'extract'
	ok: boolean
	summary: string
	data?: Record<string, unknown>
}

export interface RuntimeDependencies {
	storage: JaensenStorage
	sandboxFactory: SandboxFactory
	generate: (prompt: string) => Promise<string>
	now?: Date
	skillDocs: Record<'memory' | 'ingest' | 'extract', string>
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