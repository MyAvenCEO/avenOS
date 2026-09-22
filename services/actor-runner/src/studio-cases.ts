import {
	assertStudioCaseEvidenceIdentity,
	parseStudioCase,
	StudioCaseError,
	type StudioCaseRecord,
	simulateStudioCase
} from '@avenos/actors/studio/case'
import { ArtifactStoreProblem } from '@avenos/artifact-store'
import {
	type StudioArtifact,
	type StudioArtifacts,
	studioIdentity,
	studioPlanDigest
} from './studio-artifacts.js'

/** Immutable authoring records. Evidence supplied by a client is attributed, not certified. */
export class StudioCases {
	constructor(readonly artifacts: StudioArtifacts) {}
	async read(id: string): Promise<{ artifact: StudioArtifact; record: StudioCaseRecord }> {
		const artifact = await this.artifacts.get(id)
		if (artifact.typeKey !== 'studio.case' || artifact.typeVersion !== 1)
			throw new StudioCaseError('Select a case artifact.')
		const record = artifact.payload as unknown as StudioCaseRecord
		parseStudioCase(record.case)
		if (!['proposed', 'confirmed'].includes(record.status))
			throw new StudioCaseError('Invalid case status.')
		return { artifact, record }
	}
	async propose(raw: unknown, subject: string, predecessorArtifactId?: string) {
		const value = parseStudioCase(raw)
		if (predecessorArtifactId) {
			const previous = await this.read(predecessorArtifactId)
			assertStudioCaseEvidenceIdentity(previous.record.case, value)
		}
		// Resolving artifact evidence through this scope prevents foreign artifact references.
		for (const evidence of value.evidence) {
			if (evidence.kind !== 'artifact') continue
			try {
				await this.artifacts.get(evidence.sourceId)
			} catch (error) {
				if (error instanceof ArtifactStoreProblem && [400, 403, 404].includes(error.status))
					throw new StudioCaseError(
						`Evidence ${evidence.id}: artifact ${evidence.sourceId} is unavailable in this workspace. Use an exact readable artifact ID, not a catalog cursor, capability ID or guessed identifier.`
					)
				throw error
			}
		}
		return this.write({
			case: value,
			status: 'proposed',
			predecessorArtifactId: predecessorArtifactId ?? null,
			recordedBy: subject
		})
	}
	/** Resolve an exact immutable proposal, never repeat its publication. The Actor
	 * resolves incremental changes from their immutable predecessor before calling
	 * this method. A missing receipt remains uncertain, not permission to retry. */
	async recoverProposal(raw: unknown, subject: string, predecessorArtifactId?: string) {
		return this.lookup({
			case: parseStudioCase(raw),
			status: 'proposed',
			predecessorArtifactId: predecessorArtifactId ?? null,
			recordedBy: subject
		})
	}
	async confirm(id: string, subject: string) {
		const { record, artifact } = await this.read(id)
		if (record.status === 'confirmed') return artifact
		return this.write({
			...record,
			status: 'confirmed',
			predecessorArtifactId: id,
			recordedBy: subject
		})
	}
	async whatIf(id: string) {
		const { record } = await this.read(id)
		return simulateStudioCase(record.case)
	}
	private identity(record: StudioCaseRecord) {
		return studioIdentity(this.artifacts.scope, 'case', record.recordedBy, studioPlanDigest(record))
	}
	private async lookup(record: StudioCaseRecord) {
		const id = await this.identity(record)
		const existing = await this.artifacts.lookup(id)
		if (!existing) return null
		const artifact = existing[0]
		if (
			existing.length !== 1 ||
			!artifact ||
			artifact.scopeId !== this.artifacts.scope ||
			artifact.publicationId !== id ||
			artifact.typeKey !== 'studio.case' ||
			artifact.typeVersion !== 1 ||
			studioPlanDigest(artifact.payload) !== studioPlanDigest(record)
		)
			throw new StudioCaseError('The case publication receipt does not match this proposal.')
		return artifact
	}
	private async write(record: StudioCaseRecord) {
		const existing = await this.lookup(record)
		if (existing) return existing
		const id = await this.identity(record)
		// The Artifact Store's committedAt is the authoritative time. Keep retry bytes identical.
		const payload = record
		const refs = [
			...(record.predecessorArtifactId
				? [{ role: 'predecessor', id: record.predecessorArtifactId }]
				: []),
			...[
				...new Set(record.case.evidence.filter((e) => e.kind === 'artifact').map((e) => e.sourceId))
			].map((id) => ({ role: 'evidence', id }))
		]
		const [artifact] = await this.artifacts.publish({
			id,
			procedure: 'studio.case',
			principal: record.recordedBy,
			inputs: refs.map((r) => ({ id: r.id, role: r.role })),
			parameters: { status: record.status },
			artifacts: [{ key: 'case', type: 'studio.case', payload, references: refs }]
		})
		return artifact
	}
}
