import type { PlanRunRecord } from '@avenos/actors'
import type { StudioSkillV2, StudioSkillV2Issue } from '@avenos/actors/studio/v2'
import { resetCombinedStudioCatalog } from './studio-catalog'
import { authorizedStudioRequest } from './studio-request'

export interface StudioArtifact {
	artifactId: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	committedAt: string
}
export interface StudioDraft {
	id: string
	subjectId: string
	revision: number
	definition: StudioSkillV2
	publishedArtifactId: string | null
	publishedRevision: number | null
	updatedAt: string
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
	dispatchMode: 'authorized-session'
}
export interface StudioPreview {
	ok: boolean
	mode: 'authoring-contract'
	publishes: false
	definitionDigest?: string
	transitiveChildArtifactIds: string[]
	issues: StudioSkillV2Issue[]
}
export interface StudioOpportunity {
	label: string
	definition: StudioSkillV2
	conditional: boolean
	steps: Array<{ id: string; label: string }>
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
	requestedSkillId: null as string | null,
	requestedSkillAction: 'open' as 'open' | 'use' | 'prepare',
	refreshVersion: 0
})
export async function studioRequest<T = unknown>(
	operation: string,
	data: Record<string, unknown> = {}
): Promise<T> {
	const result = await authorizedStudioRequest<T>(operation, data)
	if (
		!['state', 'inspect', 'explore', 'preview', 'compare', 'catalog', 'present'].includes(operation)
	)
		studio.refreshVersion++
	return result
}
let refreshSequence = 0
let catalogContextKey = ''
export async function refreshStudio() {
	const sequence = ++refreshSequence
	const snapshot = await studioRequest<StudioSnapshot>('state')
	if (sequence === refreshSequence) {
		const nextContext = `${snapshot.scopeId}\0${snapshot.subjectId}`
		if (nextContext !== catalogContextKey) {
			catalogContextKey = nextContext
			resetCombinedStudioCatalog()
		}
		studio.snapshot = snapshot
	}
	return snapshot
}

let activeSynchronization: Promise<void> | null = null
/** Session-bound, bounded delivery pass. Polling state alone cannot start subscriptions. */
export function synchronizeStudio(): Promise<void> {
	if (activeSynchronization) return activeSynchronization
	const current = studio.snapshot
	activeSynchronization = (async () => {
		await authorizedStudioRequest('sync')
		if (
			current &&
			studio.snapshot &&
			(current.scopeId !== studio.snapshot.scopeId ||
				current.subjectId !== studio.snapshot.subjectId)
		)
			return
		await refreshStudio()
	})().finally(() => {
		activeSynchronization = null
	})
	return activeSynchronization
}
