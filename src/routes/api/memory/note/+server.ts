import { json } from '@sveltejs/kit'
import { appendMemoryProvenance } from '$lib/memory/memory-provenance.js'
import { rebuildVaultGraph } from '$lib/memory/vault-graph.js'
import { ensureVaultDir, readVaultNote, writeVaultNote } from '$lib/memory/vault.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
	const pathParam = url.searchParams.get('path')
	if (!pathParam?.trim()) {
		return json({ ok: false as const, error: 'Missing path query.' }, { status: 400 })
	}
	try {
		ensureVaultDir()
		const content = readVaultNote(pathParam)
		return json({ ok: true as const, path: pathParam, content })
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 404 })
	}
}

export const PUT: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}
	if (
		typeof raw !== 'object' ||
		raw === null ||
		typeof (raw as { path?: unknown }).path !== 'string' ||
		typeof (raw as { content?: unknown }).content !== 'string'
	) {
		return json(
			{ ok: false as const, error: 'Body must include path and content strings.' },
			{ status: 400 }
		)
	}
	const { path: relPath, content } = raw as { path: string; content: string }
	try {
		ensureVaultDir()
		const merged = appendMemoryProvenance(content, { type: 'memory_ui' })
		writeVaultNote(relPath, merged)
		rebuildVaultGraph()
		return json({ ok: true as const, path: relPath })
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 400 })
	}
}
