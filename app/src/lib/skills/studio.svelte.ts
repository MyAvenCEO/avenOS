import type { PlanRunRecord } from '@avenos/actors'
import type {
	CompiledStudioProgram,
	StudioCapability,
	StudioDefinition,
	StudioIssue
} from '@avenos/actors/studio'
import { invoke } from '@tauri-apps/api/core'

export interface StudioArtifact {
	artifactId: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	committedAt: string
}
export interface StudioDraft {
	id: string
	revision: number
	definition: StudioDefinition
	published_artifact_id: string | null
	published_revision: number | null
}
export interface StudioConnection {
	id: string
	revision: number
	enabled: boolean
	last_error: string | null
	record: {
		name: string
		skillArtifactId: string
		sourceArtifactId: string | null
		inputType: { key: string; version: number }
	}
}
export interface StudioSnapshot {
	scopeId: string
	subjectId: string
	drafts: StudioDraft[]
	connections: StudioConnection[]
	runs: PlanRunRecord[]
	files: StudioArtifact[]
	skills: StudioArtifact[]
	sources: StudioArtifact[]
	artifacts: StudioArtifact[]
	deliveries: Array<{ id: string; last_error: string | null; run_id: string | null }>
	catalog: StudioCapability[]
	dispatchMode: 'authorized-session'
}
export interface StudioPreview {
	ok: boolean
	program?: CompiledStudioProgram
	issues?: StudioIssue[]
}
export interface StudioOpportunity {
	label: string
	definition: StudioDefinition
	conditional: boolean
	steps: StudioCapability[]
}
export interface StudioExploration {
	source: StudioArtifact
	opportunities: StudioOpportunity[]
	next: string
}
export const studioName = (a: StudioArtifact) =>
	String(
		a.payload.name ?? a.payload.originalName ?? a.payload.title ?? a.payload.subject ?? a.typeKey
	)

/** UI and agent use exactly the same customer-scoped native boundary. No browser-local program store. */
export const studio = $state({
	snapshot: null as StudioSnapshot | null,
	requestedArtifactId: null as string | null,
	refreshVersion: 0
})
export async function studioRequest<T = unknown>(
	operation: string,
	data: Record<string, unknown> = {}
): Promise<T> {
	const result = await invoke<T>('studio_request', { command: { operation, data } })
	if (!['state', 'inspect', 'explore', 'preview', 'compare'].includes(operation))
		studio.refreshVersion++
	return result
}
let refreshSequence = 0
export async function refreshStudio() {
	const sequence = ++refreshSequence
	const snapshot = await studioRequest<StudioSnapshot>('state')
	if (sequence === refreshSequence) studio.snapshot = snapshot
	return snapshot
}
