/** One immutable artifact draft emitted by a client-side actor procedure. */
export interface ClientArtifactDraft {
	localKey: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	output: { role: string; ordinal: number }
	blob?: { mediaType: string; base64: string }
}

export type ArtifactLocator =
	| { kind: 'artifact-root' }
	| { kind: 'json-pointer'; pointer: string }
	| { kind: 'byte-range'; start: number; endExclusive: number }
	| { kind: 'page-region'; page: number; x: number; y: number; width: number; height: number }

export interface ClientEvidence {
	ordinal: number
	outputLocalKey: string
	outputLocator: ArtifactLocator
	inputRole: string
	inputOrdinal: number
	inputLocator: ArtifactLocator
}

export interface ClientRunInput {
	role: string
	ordinal: number
	artifactId: string
}

export interface ClientRunPublication {
	publicationId: string
	procedureKey: string
	procedureVersion: 'client-v1' | 'server-v1'
	inputs: ClientRunInput[]
	parameters: Record<string, unknown>
	artifacts: ClientArtifactDraft[]
	evidence: ClientEvidence[]
}

export interface PublishedClientArtifact {
	localKey: string
	artifactId: string
}

export interface PublishedClientRun {
	publicationId: string
	runId: string
	replayed: boolean
	artifacts: PublishedClientArtifact[]
}

export interface ClientArtifactGateway {
	publish(run: ClientRunPublication): Promise<PublishedClientRun>
}

export interface ClientPublicationRetryPolicy {
	delaysMs: readonly number[]
	shouldRetry(error: unknown): boolean
}

const wait = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Serializes publications through one client and optionally retries transient
 * transport failures. Artifact publication remains idempotent because every
 * run carries its stable publicationId.
 */
export class QueuedClientArtifactGateway implements ClientArtifactGateway {
	#tail: Promise<void> = Promise.resolve()

	constructor(
		private readonly delegate: ClientArtifactGateway,
		private readonly retry?: ClientPublicationRetryPolicy
	) {}

	publish(run: ClientRunPublication): Promise<PublishedClientRun> {
		const publication = this.#tail.then(() => this.publishWithRetry(run))
		this.#tail = publication.then(
			() => undefined,
			() => undefined
		)
		return publication
	}

	private async publishWithRetry(run: ClientRunPublication): Promise<PublishedClientRun> {
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.delegate.publish(run)
			} catch (error) {
				const delay = this.retry?.delaysMs[attempt]
				if (delay === undefined || !this.retry?.shouldRetry(error)) throw error
				await wait(delay)
			}
		}
	}
}
