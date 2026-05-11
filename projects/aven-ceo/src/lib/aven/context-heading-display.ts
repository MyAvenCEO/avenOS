/**
 * Talk “On this page” labels: under `.data/agents/maia/` show **Maia** + slice (Identity, Rules, …);
 * under `.data/knowledge` vault index show **Knowledge** + **Index**. Other `.data/` paths fall back to a single root badge + path tail.
 */

const MAIA_SCOPE = 'border-indigo-400/40 bg-indigo-500/[0.12] text-indigo-950'
const MAIA_SLICE = 'border-violet-400/38 bg-violet-500/[0.11] text-violet-950'

const KNOW_PRIMARY = 'border-emerald-400/40 bg-emerald-500/[0.12] text-emerald-950'
const KNOW_INDEX = 'border-teal-400/38 bg-teal-500/[0.11] text-teal-950'

const ROOT_FALLBACK = 'border-border/60 bg-white/18 text-foreground/85'

export type ContextHeadingSegment = { label: string; className: string }

export type ContextHeadingParts = {
	/** Empty → render `tail` as the only line (e.g. preferences prose). */
	segments: ContextHeadingSegment[]
	tail: string
}

function fileName(posix: string): string {
	const i = posix.lastIndexOf('/')
	return i >= 0 ? posix.slice(i + 1) : posix
}

/**
 * Parses headings like `@.data/agents/maia/SOUL.md`, `@.data/knowledge (live index)`,
 * or plain text without `.data/` (returned as tail-only).
 */
export function contextHeadingParts(raw: string): ContextHeadingParts {
	const s = raw.trim()

	const agentsMaia = s.match(/^@?\.data\/agents\/(maia\/[\s\S]+)$/i)
	if (agentsMaia) {
		let rel = agentsMaia[1].trim().replace(/^\/+/, '')
		if (rel.toLowerCase().startsWith('maia/')) rel = rel.slice(5)
		const lower = rel.toLowerCase()

		const maia: ContextHeadingSegment = { label: 'Maia', className: MAIA_SCOPE }

		if (lower === 'soul.md' || lower.endsWith('/soul.md')) {
			return {
				segments: [maia, { label: 'Identity', className: MAIA_SLICE }],
				tail: 'SOUL.md'
			}
		}
		if (lower === 'rules.md' || lower.endsWith('/rules.md')) {
			return {
				segments: [maia, { label: 'Rules', className: MAIA_SLICE }],
				tail: 'RULES.md'
			}
		}
		if (lower.startsWith('tools/')) {
			return {
				segments: [maia, { label: 'Tools', className: MAIA_SLICE }],
				tail: fileName(rel) || rel
			}
		}
		if (lower === 'messages' || lower.endsWith('/messages')) {
			return {
				segments: [maia, { label: 'Messages', className: MAIA_SLICE }],
				tail: 'conversation.json · mN.md'
			}
		}

		return {
			segments: [maia, { label: 'Agent', className: MAIA_SLICE }],
			tail: rel
		}
	}

	const knowledge = s.match(/^@?\.data\/knowledge([\s\S]*)$/i)
	if (knowledge) {
		let rest = knowledge[1].trim()
		// `@.data/knowledge (live index)` → split badges, no dot-only tail
		const liveIdx = /^\(\s*live\s+index\s*\)\s*$/i.test(rest)
		if (liveIdx || rest === '' || rest === '·') {
			return {
				segments: [
					{ label: 'Knowledge', className: KNOW_PRIMARY },
					{ label: 'Index', className: KNOW_INDEX }
				],
				tail: ''
			}
		}
		if (rest.startsWith('/')) rest = rest.slice(1)
		return {
			segments: [
				{ label: 'Knowledge', className: KNOW_PRIMARY },
				{ label: 'Index', className: KNOW_INDEX }
			],
			tail: rest || '·'
		}
	}

	const generic = s.match(/^@?\.data\/([^/]+)([\s\S]*)$/i)
	if (generic) {
		const root = generic[1].toLowerCase()
		let tail = generic[2].trim()
		if (tail.startsWith('/')) tail = tail.slice(1)
		return {
			segments: [{ label: root, className: ROOT_FALLBACK }],
			tail: tail || '·'
		}
	}

	return { segments: [], tail: s }
}
