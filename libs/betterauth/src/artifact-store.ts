import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@avenos/aven-skills'
import { sql } from 'kysely'
import { db } from './db'

// Postgres-`bytea` ArtifactStore (board 0089). Bytes cross the wire as base64 and Postgres does the
// bytea conversion (decode/encode), so the Neon serverless driver never handles raw binary params.
// Content-addressed by sha256; idempotent. The bytes NEVER enter the predication graph — only the hash.
export function pgArtifactStore(): ArtifactStore {
	return {
		async put(bytes, mime) {
			const sha = createHash('sha256').update(bytes).digest('hex')
			const b64 = Buffer.from(bytes).toString('base64')
			await sql`
				INSERT INTO artifact (sha256, bytes, mime, size)
				VALUES (${sha}, decode(${b64}, 'base64'), ${mime}, ${bytes.length})
				ON CONFLICT (sha256) DO NOTHING
			`.execute(db())
			return sha
		},
		async get(sha256) {
			const r = await sql<{ b64: string; mime: string }>`
				SELECT encode(bytes, 'base64') AS b64, mime FROM artifact WHERE sha256 = ${sha256}
			`.execute(db())
			const row = r.rows[0]
			if (!row) return null
			return { bytes: new Uint8Array(Buffer.from(row.b64, 'base64')), mime: row.mime }
		}
	}
}
