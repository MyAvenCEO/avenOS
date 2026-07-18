// board aven-voice — the ONE place that decides which vibe (and what data) to push after a data change,
// used by BOTH the voice relay tool loop (voice-tools) and the chat/HITL confirm path (ai.ts). DRY:
// realtime refresh logic lives here, not duplicated per surface.
//
// - vibeForSchema (vibe-registry) resolves the render vibe for a schema (schema-named view, else the
//   skill's data_crud actor binding / manifest — e.g. shift + slot → 'dienstplan').
// - MULTI_SCHEMA_VIBES declares vibes that OVERLAY several schemas (dienstplan = slots + shifts); their
//   data source fetches every overlaid schema.
// - refreshVibeForSchema() returns the {schema, data} to push after a mutation, or null when the schema
//   has no vibe (then no card — same guard chat/voice already apply).

import { crud } from './actor-run'
import { vibeForSchema } from './vibe-registry'

/** Vibes that MERGE several schemas into one card: name → the schemas to fetch and their source keys. */
export const MULTI_SCHEMA_VIBES: Record<string, { key: string; schema: string }[]> = {
	dienstplan: [
		{ key: 'slots', schema: 'slot' },
		{ key: 'shifts', schema: 'shift' }
	]
}

/** Build a vibe's data source: merge-vibes fetch all their schemas; others list the one schema. */
export async function vibeSource(
	userId: string,
	vibeName: string,
	fallbackSchema: string,
	extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
	const spec = MULTI_SCHEMA_VIBES[vibeName]
	if (spec) {
		const out: Record<string, unknown> = { ...extra }
		for (const { key, schema } of spec) {
			const r = await crud(userId, { schema, action: 'list' } as Parameters<typeof crud>[1]).catch(
				() => null
			)
			out[key] = (r as { items?: unknown } | null)?.items ?? r ?? []
		}
		return out
	}
	const r = await crud(userId, { schema: fallbackSchema, action: 'list' } as Parameters<typeof crud>[1])
	return { items: (r as { items?: unknown } | undefined)?.items ?? r, ...extra }
}

/**
 * The vibe to push after a mutation on `schema` — resolves the render vibe and builds its FULL, fresh
 * data (fetching every schema a merge-vibe overlays). Returns null when the schema has no vibe.
 */
export async function refreshVibeForSchema(
	userId: string,
	schema: string,
	extra: Record<string, unknown> = {}
): Promise<{ schema: string; data: Record<string, unknown> } | null> {
	const vibeName = await vibeForSchema(schema).catch(() => null)
	if (!vibeName) return null
	const data = await vibeSource(userId, vibeName, schema, extra)
	return { schema: vibeName, data }
}
