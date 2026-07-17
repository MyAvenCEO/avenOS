/**
 * Ports for the generic flow runner (board 0089). Side-effecting capabilities the runner + its
 * actors need, expressed as injectable interfaces so the engine stays environment-agnostic: the
 * betterauth host injects Postgres-backed impls; tests inject in-memory fakes. Mirrors the actor
 * model's "talk to a capability, don't import it" boundary (same as the ingestor's ports).
 */

import { type HashPort, webCryptoHashPort } from '../ingestor/ports.js'

/** Raw bytes + their mime, as returned from an ArtifactStore. */
export interface StoredArtifact {
	bytes: Uint8Array
	mime: string
}

/**
 * A content-addressed store for raw source artifacts (the original file/photo bytes) of ANY ingesting
 * skill — abstracted so the backend is swappable (Postgres `bytea` now; object storage later, no
 * caller change). Only the sha256 ever enters the predication graph; the bytes stay here.
 */
export interface ArtifactStore {
	/** Persist bytes content-addressed; returns the sha256 hex id. Idempotent (same bytes → same id). */
	put(bytes: Uint8Array, mime: string): Promise<string>
	/** Fetch the bytes + mime for a sha256, or null when absent. */
	get(sha256: string): Promise<StoredArtifact | null>
}

/** In-memory ArtifactStore — deterministic content addressing, for tests + no-host defaults. */
export function memoryArtifactStore(hash: HashPort = webCryptoHashPort): ArtifactStore {
	const blobs = new Map<string, StoredArtifact>()
	return {
		async put(bytes, mime) {
			const sha = await hash.sha256Hex(bytes)
			if (!blobs.has(sha)) blobs.set(sha, { bytes, mime })
			return sha
		},
		async get(sha256) {
			return blobs.get(sha256) ?? null
		}
	}
}
