import { json } from '@sveltejs/kit'
import fs from 'node:fs'
import path from 'node:path'
import {
	ensureMaiaAgentWorkspace,
	ensureMaiaRulesFile,
	maiaReadmePath,
	maiaRulesDataPath
} from '$lib/memory/maia-rules-md.js'
import { ensureSoulMarkdownFile, soulMarkdownPath } from '$lib/memory/soul-md.js'
import type { RequestHandler } from './$types'

const KINDS = ['soul', 'rules', 'readme'] as const
type Kind = (typeof KINDS)[number]

function resolvePath(kind: Kind): string {
	switch (kind) {
		case 'soul':
			return soulMarkdownPath()
		case 'rules':
			return maiaRulesDataPath()
		case 'readme':
			return maiaReadmePath()
	}
}

function parseKind(raw: string | null): Kind | null {
	if (!raw) return null
	const k = raw.trim().toLowerCase()
	return KINDS.includes(k as Kind) ? (k as Kind) : null
}

export const GET: RequestHandler = async ({ url }) => {
	const kind = parseKind(url.searchParams.get('kind'))
	if (!kind) {
		return json({ ok: false as const, error: 'Query ?kind=soul|rules|readme required.' }, { status: 400 })
	}
	try {
		ensureMaiaAgentWorkspace()
		ensureSoulMarkdownFile()
		ensureMaiaRulesFile()
		const abs = resolvePath(kind)
		const content = fs.readFileSync(abs, 'utf8')
		return json({
			ok: true as const,
			kind,
			path: `.data/agents/maia/${kind === 'soul' ? 'SOUL.md' : kind === 'rules' ? 'RULES.md' : 'README.md'}`,
			content
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 500 })
	}
}

export const PUT: RequestHandler = async ({ request, url }) => {
	const kind = parseKind(url.searchParams.get('kind'))
	if (!kind) {
		return json({ ok: false as const, error: 'Query ?kind=soul|rules|readme required.' }, { status: 400 })
	}
	let body: unknown
	try {
		body = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}
	if (body === null || typeof body !== 'object' || typeof (body as { content?: unknown }).content !== 'string') {
		return json({ ok: false as const, error: 'Body must include { "content": string }.' }, { status: 400 })
	}
	const content = (body as { content: string }).content
	try {
		ensureMaiaAgentWorkspace()
		ensureSoulMarkdownFile()
		ensureMaiaRulesFile()
		const abs = resolvePath(kind)
		fs.mkdirSync(path.dirname(abs), { recursive: true })
		fs.writeFileSync(abs, content, 'utf8')
		return json({ ok: true as const, kind })
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 500 })
	}
}
