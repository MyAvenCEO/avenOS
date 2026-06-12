/**
 * Agentic memory tools (board 0025) — the model's explicit brain surface, mirroring
 * `vibe-tools.ts`. Until now memory was fully implicit (every turn auto-stored, recall
 * auto-injected via `assemble_context`); these tools make it DELIBERATE, mnemosyne-style:
 * the model decides what is worth keeping (with an importance), searches deeper on
 * demand, links related memories, attests what proved true, and forgets on request.
 *
 * Executors are thin wrappers over the brain IPCs ({@link brainIngest} & co) — the same
 * traced path the automatic context manager uses, so a tool-driven `memory_recall`
 * surfaces in the Context-tab receipt like auto recall does (no invisible memory reads).
 * `memory_forget` is HITL-gated in the agent loop (like `todos` delete) before it
 * reaches its executor here.
 */

import { brainAttest, brainForget, brainIngest, brainLink, brainSearch } from '$lib/brain/api'
import type { ToolContext, ToolDef, ToolDispatchResult } from './tools'

/** The standard human-facing `response` property (same contract as the other tools). */
const RESPONSE_PROP = {
	response: {
		type: 'string',
		description:
			"A short, friendly reply to the user in the user's language (one sentence). " +
			'This is shown and spoken back to the user.'
	}
} as const

/** Tool schemas advertised to the cloud model. */
export const MEMORY_TOOL_DEFS: ToolDef[] = [
	{
		name: 'memory_remember',
		description:
			'Deliberately store a durable memory — a fact, preference, decision, or detail you would ' +
			'want in a future session ("would I want this next session?"). Choose an importance ' +
			'(0..1, how salient it should be in recall) and a veracity ("stated" when the user said ' +
			'it outright, "inferred" when you concluded it). Routine chat is stored automatically — ' +
			'call this only for things worth keeping.',
		parameters: {
			type: 'object',
			properties: {
				content: { type: 'string', description: 'The memory text to store, self-contained.' },
				importance: {
					type: 'number',
					description: 'Salience 0..1 (0.5 = neutral; reserve >0.8 for things that must surface).'
				},
				veracity: {
					type: 'string',
					enum: ['stated', 'inferred'],
					description: 'How you know it: the user stated it, or you inferred it.'
				},
				...RESPONSE_PROP
			},
			required: ['content', 'response']
		}
	},
	{
		name: 'memory_recall',
		description:
			'Search your long-term memory on demand — when the auto-assembled context does not ' +
			'contain the answer, or the user asks what you remember/know about something. Returns ' +
			'the top matching memories with ids (use the ids for memory_link / memory_attest / ' +
			'memory_forget).',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'What to search for.' },
				k: { type: 'number', description: 'How many memories to return (default 6, max 12).' },
				...RESPONSE_PROP
			},
			required: ['query', 'response']
		}
	},
	{
		name: 'memory_link',
		description:
			'Explicitly link two memories that belong together (a "refers_to" relation), so ' +
			'recalling one can lead to the other. Use ids from a prior memory_recall result.',
		parameters: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Memory id (from memory_recall).' },
				to: { type: 'string', description: 'Memory id to link it to.' },
				...RESPONSE_PROP
			},
			required: ['from', 'to', 'response']
		}
	},
	{
		name: 'memory_attest',
		description:
			'Strengthen a memory that proved true (raises its trust toward "stated", so it ranks ' +
			'higher in recall). Use the id from a prior memory_recall result.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Memory id (from memory_recall).' },
				...RESPONSE_PROP
			},
			required: ['id', 'response']
		}
	},
	{
		name: 'memory_forget',
		description:
			'Remove a memory from recall — ONLY when the user explicitly asks you to forget ' +
			'something. The user is asked to confirm before it happens. Use the id from a prior ' +
			'memory_recall result.',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Memory id (from memory_recall).' },
				...RESPONSE_PROP
			},
			required: ['id', 'response']
		}
	}
]

function asText(v: unknown): string {
	return String(v ?? '').trim()
}

async function executeRemember(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const content = asText(args.content)
	if (!content) return { ok: false, message: 'memory_remember: empty content' }
	const importance =
		typeof args.importance === 'number' ? Math.min(1, Math.max(0, args.importance)) : 0.5
	const veracity = asText(args.veracity) === 'stated' ? 'stated' : 'inferred'
	// Stream `note` — a deliberate note, recallable everywhere but not part of the
	// talk working window (the conversation itself is auto-ingested as `talk`).
	const { id } = await brainIngest(ctx.identityId, content, {
		stream: 'note',
		authorRole: 'agent',
		contentDateMs: Date.now(),
		veracity,
		importance
	})
	return {
		ok: true,
		message: `🧠 remembered (importance ${importance})`,
		toolResult: JSON.stringify({ ok: true, id, importance, veracity })
	}
}

async function executeRecall(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const query = asText(args.query)
	if (!query) return { ok: false, message: 'memory_recall: empty query' }
	const k = typeof args.k === 'number' ? Math.min(12, Math.max(1, Math.round(args.k))) : 6
	const hits = await brainSearch(ctx.identityId, query, k)
	return {
		ok: true,
		message: `🧠 recalled ${hits.length} memor${hits.length === 1 ? 'y' : 'ies'}`,
		toolResult: JSON.stringify(
			hits.map((h) => ({
				id: h.id,
				content: h.content,
				via: h.via,
				veracity: h.veracity ?? 'unknown',
				importance: h.importance
			}))
		)
	}
}

async function executeLink(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const from = asText(args.from)
	const to = asText(args.to)
	if (!from || !to) return { ok: false, message: 'memory_link: from and to ids required' }
	await brainLink(ctx.identityId, from, to)
	return { ok: true, message: '🧠 linked', toolResult: JSON.stringify({ ok: true, from, to }) }
}

async function executeAttest(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const id = asText(args.id)
	if (!id) return { ok: false, message: 'memory_attest: id required' }
	const { veracity } = await brainAttest(ctx.identityId, id)
	return {
		ok: true,
		message: `🧠 attested → ${veracity}`,
		toolResult: JSON.stringify({ ok: true, id, veracity })
	}
}

async function executeForget(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const id = asText(args.id)
	if (!id) return { ok: false, message: 'memory_forget: id required' }
	await brainForget(ctx.identityId, id)
	return { ok: true, message: '🧠 forgotten', toolResult: JSON.stringify({ ok: true, id }) }
}

/** Memory tool name → executor. Routed via the agent dispatcher (`executeToolCall`). */
export const MEMORY_TOOL_EXECUTORS: Record<
	string,
	(args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolDispatchResult>
> = {
	memory_remember: executeRemember,
	memory_recall: executeRecall,
	memory_link: executeLink,
	memory_attest: executeAttest,
	memory_forget: executeForget
}
