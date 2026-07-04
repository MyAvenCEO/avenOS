// board 0115 — SKILLIFY part 1, the no-LLM VIEWER actor: "show me my mockups" → an instant grid of every
// minted mockup; "show the banking screen" → renders that mockup with its example source. Zero GLM
// rounds — pure registry lookups, mirroring the goals/locations viewer pattern.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

export const MOCKUPS_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'mockups',
		description:
			'SHOW existing screen mockups (no designing): pass `name` to render ONE mockup card ("show me ' +
			'the banking screen"), or omit it to list ALL minted mockups as a grid. Instant — never use ' +
			'this to create or change a mockup (that is the `mockup` tool).',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'The mockup to show (kebab-case or plain words).' },
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
}

export const mockups: ToolActor = {
	definition: MOCKUPS_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.mockup) return { content: { ok: false, error: 'mockup capability not available' } }
		const args = raw as { name?: string; response?: string }
		const said = typeof args.response === 'string' ? args.response.trim() : ''
		const all = await ctx.mockup.list()
		if (args.name) {
			// EXACT name or exact label (the route context carries the exact names); miss → available list.
			const want = args.name.trim().toLowerCase()
			const hit = all.find((m) => m.name === want) ?? all.find((m) => m.label === want)
			if (!hit)
				return {
					detail: 'mockup not found',
					content: { ok: false, error: `no mockup matching "${args.name}"`, available: all.map((m) => m.label) }
				}
			return {
				detail: `show ${hit.name}`,
				content: { ok: true, name: hit.name, note: 'The mockup card is shown. ONE short sentence.' },
				reply: said || `Showing the "${hit.label}" mockup.`,
				vibe: { schema: hit.name } // no data → the card renders its example source
			}
		}
		return {
			detail: 'mockups',
			content: { ok: true, count: all.length, mockups: all },
			reply: said || `You have ${all.length} mockup(s).`,
			vibe: { schema: 'mockups', data: { mockups: all } }
		}
	}
}
