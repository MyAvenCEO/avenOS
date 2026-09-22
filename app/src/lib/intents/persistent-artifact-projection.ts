import type { ArtifactProcessingState } from '@avenos/artifact-store'

/** A finished source must not hide a sibling still running or needing attention. */
export function summarizeFileSources(sources: readonly { state?: ArtifactProcessingState }[]) {
	const counts = { succeeded: 0, active: 0, needs_review: 0, failed: 0 }
	for (const source of sources) counts[source.state ?? 'active']++
	const state: ArtifactProcessingState = counts.active
		? 'active'
		: counts.failed
			? 'failed'
			: counts.needs_review
				? 'needs_review'
				: 'succeeded'
	return {
		state,
		note: `${sources.length} files · ${counts.succeeded} ready · ${counts.active} processing · ${counts.needs_review} to review · ${counts.failed} failed`
	}
}

export interface ProjectionArtifact {
	artifactId: string
	localKey: string
	typeKey: string
	publicationId: string
	scopeSequence: number
	publicationOrdinal: number
}

export interface IntentSourceArtifact {
	artifactId: string
	typeKey: 'core.file'
	title?: string
}

interface ArtifactEnvelope {
	payload?: Record<string, unknown>
}

interface FileProjection {
	type: string
	status: string
	artifacts: unknown[]
	skills: unknown[]
}

export interface IntentDocumentAttachment {
	intentId: string
	artifactId: string
	title: string
}

/** Immutable links are separate from upload roots; never replace the original file. */
export async function discoverIntentAttachments(
	artifacts: readonly ProjectionArtifact[],
	loadEnvelope: (artifactId: string) => Promise<ArtifactEnvelope>,
	onUnavailable?: () => void
): Promise<IntentDocumentAttachment[]> {
	const result: IntentDocumentAttachment[] = []
	const links = artifacts.filter((a) => a.typeKey === 'intent.attachment')
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(6, links.length) }, async () => {
			while (next < links.length) {
				const link = links[next++]!
				try {
					const { payload } = await loadEnvelope(link.artifactId)
					if (
						typeof payload?.intentId !== 'string' ||
						typeof payload?.documentArtifactId !== 'string' ||
						typeof payload?.title !== 'string'
					)
						throw Error('Invalid attachment')
					await loadEnvelope(payload.documentArtifactId)
					result.push({
						intentId: payload.intentId,
						artifactId: payload.documentArtifactId,
						title: payload.title
					})
				} catch {
					onUnavailable?.()
				}
			}
		})
	)
	return result
}

/**
 * Intent Service currently owns conversation state, while the immutable
 * intent-to-file association lives in Artifact Store. An upload commits the
 * `intent.declaration` and `core.file` roots in one publication. Reconstruct
 * that association without inventing a second mutable copy of it.
 */
export async function discoverIntentSources(
	artifacts: readonly ProjectionArtifact[],
	loadEnvelope: (artifactId: string) => Promise<ArtifactEnvelope>,
	onUnavailable?: () => void
): Promise<Map<string, IntentSourceArtifact[]>> {
	const byPublication = new Map<string, ProjectionArtifact[]>()
	for (const artifact of artifacts) {
		const members = byPublication.get(artifact.publicationId) ?? []
		members.push(artifact)
		byPublication.set(artifact.publicationId, members)
	}

	const declarations = artifacts.filter(
		(artifact) => artifact.typeKey === 'intent.declaration' && artifact.localKey === 'intent'
	)
	const load = async (declaration: ProjectionArtifact) => {
		try {
			const envelope = await loadEnvelope(declaration.artifactId)
			const intentId = envelope.payload?.intentId
			if (typeof intentId !== 'string' || intentId.trim() === '') {
				onUnavailable?.()
				return null
			}
			const source = byPublication
				.get(declaration.publicationId)
				?.find((artifact) => artifact.typeKey === 'core.file' && artifact.localKey === 'file')
			if (!source) return null
			return { intentId, source, title: envelope.payload?.title }
		} catch {
			// One unreadable historical declaration must not hide every other intent.
			onUnavailable?.()
			return null
		}
	}
	const candidates: Array<Awaited<ReturnType<typeof load>>> = []
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(6, declarations.length) }, async () => {
			while (next < declarations.length) {
				const declaration = declarations[next++]
				candidates.push(await load(declaration))
			}
		})
	)

	const newestFirst = candidates
		.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
		.sort(
			(left, right) =>
				right.source.scopeSequence - left.source.scopeSequence ||
				right.source.publicationOrdinal - left.source.publicationOrdinal ||
				right.source.artifactId.localeCompare(left.source.artifactId)
		)
	const result = new Map<string, IntentSourceArtifact[]>()
	for (const candidate of newestFirst) {
		const sources = result.get(candidate.intentId) ?? []
		if (sources.some((source) => source.artifactId === candidate.source.artifactId)) continue
		sources.push({
			artifactId: candidate.source.artifactId,
			typeKey: 'core.file',
			...(typeof candidate.title === 'string' ? { title: candidate.title } : {})
		})
		result.set(candidate.intentId, sources)
	}
	return result
}

/**
 * A plain Intent Service refresh can legitimately have no artifact projection.
 * In that case it must not erase a newer live file-skill projection assembled
 * from Artifact Store publications and processing events.
 */
export function preserveLiveFileProjection<T extends FileProjection>(
	persisted: T,
	live: T | undefined,
	persistedHasProjection: boolean
): T {
	if (persistedHasProjection || !live || live.artifacts.length === 0) return persisted
	return {
		...persisted,
		type: live.type,
		status: live.status,
		artifacts: live.artifacts,
		skills: live.skills
	}
}
