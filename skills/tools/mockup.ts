// board 0115 — SKILLIFY's GLM DESIGN actors, split by intent (create vs edit — one tool that did both
// silently minted a NEW mockup when the model forgot `name` on a refinement):
//   · create_mockup — "design me a banking screen…" → a NEW mockup, rendered the same turn.
//   · edit_mockup   — "make the total bigger" → REFINES an existing mockup (name REQUIRED, EXACT match —
//     the route injects the exact names; a miss fails honestly with the available list, no heuristics).
// Both stream GLM's raw authoring tokens live into the chat panel (no dead "Thinking…").

import type { ToolActor, ToolDefinition, ToolResult } from './types'

const label = (name: string): string => name.replace(/^mock-/, '').replace(/-/g, ' ')

export const CREATE_MOCKUP_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'create_mockup',
		description:
			'DESIGN a NEW screen mockup for a skill feature (look only — view, style, example data; no real ' +
			'data). Use when the user wants to design/mock/sketch a screen that does not exist yet. To change ' +
			'an existing mockup use edit_mockup; to just display one use mockups.',
		parameters: {
			type: 'object',
			properties: {
				description: {
					type: 'string',
					description:
						"What the screen should show, in the user's words (e.g. \"banking accounts with balances and a total\")."
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['description']
		}
	}
}

export const EDIT_MOCKUP_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'edit_mockup',
		description:
			'REFINE an existing screen mockup ("make the total bigger", "add a progress bar"). Requires the ' +
			'mockup `name` — never creates a new one. To design from scratch use create_mockup.',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Which mockup to change (kebab-case or plain words).' },
				description: { type: 'string', description: 'The change to apply, in the user\'s words.' },
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['name', 'description']
		}
	}
}

export const createMockup: ToolActor = {
	definition: CREATE_MOCKUP_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.mockup) return { content: { ok: false, error: 'mockup capability not available' } }
		const args = raw as { description?: string; response?: string }
		const request = String(args.description ?? '').trim()
		if (!request) return { content: { ok: false, error: 'a description of the screen is required' } }
		const res = await ctx.mockup.mint(request, { promptActor: 'create_mockup' })
		if (res.error || !res.name)
			return { detail: 'mockup failed', content: { ok: false, error: res.error ?? 'mint failed' } }
		const said = typeof args.response === 'string' ? args.response.trim() : ''
		return {
			detail: `create ${res.name}`,
			content: {
				ok: true,
				name: res.name,
				note: 'The mockup card is shown. Reply with ONE short sentence — do not re-describe it.'
			},
			reply: said || `Here is the "${label(res.name)}" mockup.`,
			// NO data — VibeCard renders the mockup's EXAMPLE source (the vibe_source row).
			vibe: { schema: res.name }
		}
	}
}

export const editMockup: ToolActor = {
	definition: EDIT_MOCKUP_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.mockup) return { content: { ok: false, error: 'mockup capability not available' } }
		const args = raw as { name?: string; description?: string; response?: string }
		const request = String(args.description ?? '').trim()
		if (!request) return { content: { ok: false, error: 'describe the change to apply' } }
		// Deterministic canonicalizing resolution (the save-time mockName rule — walled name, app name,
		// or label all hit); a genuine miss fails honestly with the available names so the model
		// self-corrects — no string heuristics.
		const hit = await ctx.mockup.resolve(String(args.name ?? ''))
		if (!hit)
			return {
				detail: 'mockup not found',
				content: {
					ok: false,
					error: `no mockup matching "${args.name}". Retry with one of the available names.`,
					available: (await ctx.mockup.list()).map((m) => m.label)
				}
			}
		const res = await ctx.mockup.mint(request, { name: hit, promptActor: 'edit_mockup' })
		if (res.error || !res.name)
			return { detail: 'refine failed', content: { ok: false, error: res.error ?? 'refine failed' } }
		const said = typeof args.response === 'string' ? args.response.trim() : ''
		return {
			detail: `edit ${res.name}`,
			content: {
				ok: true,
				name: res.name,
				note: 'The updated mockup card is shown. Reply with ONE short sentence.'
			},
			reply: said || `Updated the "${label(res.name)}" mockup.`,
			vibe: { schema: res.name }
		}
	}
}
