import { json } from '@sveltejs/kit'
import { assertVaultRelativePath, ensureVaultDir } from '$lib/memory/vault.js'
import { loadVaultGraph } from '$lib/memory/vault-graph.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
	try {
		ensureVaultDir()
		const state = loadVaultGraph()
		const full =
			url.searchParams.get('full') === '1' || url.searchParams.get('export') === '1'
		if (full) {
			return json({ ok: true as const, state })
		}

		const rawPath = url.searchParams.get('path')
		if (!rawPath?.trim()) {
			return json({
				ok: true as const,
				generatedIso: state.generatedIso,
				stats: state.stats
			})
		}

		const posix = assertVaultRelativePath(rawPath)
		return json({
			ok: true as const,
			path: posix,
			outgoing: state.outgoing[posix] ?? [],
			backlinks: state.backlinks[posix] ?? [],
			unresolved: state.unresolvedFrom[posix] ?? []
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 400 })
	}
}
