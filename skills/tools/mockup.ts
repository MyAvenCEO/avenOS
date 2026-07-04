// board 0115 — SKILLIFY part 1, the GLM DESIGN actor: "design me a banking screen — my accounts with
// balances" → GLM-5.2 authors {view, style, example source} as pure config, the server gates validate +
// wall it into the mock- namespace, and the minted card renders in the SAME turn (the vibe's example
// source is the state). Naming an existing mockup REFINES it (the rows are fed back as GLM context).

import type { ToolActor, ToolDefinition, ToolResult } from './types'

export const MOCKUP_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'mockup',
		description:
			'DESIGN or REFINE a screen mockup for a new skill feature (look only — view, style, example ' +
			'data; no real data). Use when the user wants to design/mock/sketch a new screen or change how ' +
			'an existing MOCKUP looks ("make the total bigger"). Pass `name` when refining a known mockup.',
		parameters: {
			type: 'object',
			properties: {
				description: {
					type: 'string',
					description:
						"What the screen should show, in the user's words (e.g. \"banking accounts with balances and a total\")."
				},
				name: {
					type: 'string',
					description: 'Refine THIS existing mockup (its kebab-case name); omit when creating new.'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['description']
		}
	}
}

export const mockup: ToolActor = {
	definition: MOCKUP_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.mockup) return { content: { ok: false, error: 'mockup capability not available' } }
		const args = raw as { description?: string; name?: string; response?: string }
		const request = String(args.description ?? '').trim()
		if (!request) return { content: { ok: false, error: 'a description of the screen is required' } }
		const res = await ctx.mockup.mint(request, args.name)
		if (res.error || !res.name) {
			// the model gets the gate's message and can re-try with a corrected design request.
			return { detail: 'mockup failed', content: { ok: false, error: res.error ?? 'mint failed' } }
		}
		const said = typeof args.response === 'string' ? args.response.trim() : ''
		return {
			detail: `mockup ${res.name}`,
			content: {
				ok: true,
				name: res.name,
				note: 'The mockup card is shown. Reply with ONE short sentence — do not re-describe it.'
			},
			reply: said || `Here is the "${res.name.replace(/^mock-/, '').replace(/-/g, ' ')}" mockup.`,
			// NO data — VibeCard renders the mockup's EXAMPLE source (the vibe_source row).
			vibe: { schema: res.name }
		}
	}
}
