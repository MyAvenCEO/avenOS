// Tools the chat advertises to the model so it can surface + edit the user's site. Kept PURE (no
// DOM / Storage) so the server can import them for the Tinfoil tool list, exactly like the generic
// data_crud tool. `show_website` is handled server-side (flow the Composer vibe into the chat); the
// `edit_website` execution runs the specialist model via this skill's editWebsiteDiff. board 0055/0056.

/** Read-only: load the Composer vibe (file list + live preview) inline in the chat. Edits nothing. */
export const SHOW_WEBSITE_TOOL = {
	type: 'function',
	function: {
		name: 'show_website',
		description:
			"Display the signed-in user's website Composer (READ-ONLY) inline in the chat so they can " +
			'see their site files and live preview. Call this whenever the user asks to see, show, open, ' +
			'view, or look at their website / site / composer / page. Does NOT create or edit anything.',
		parameters: {
			type: 'object',
			properties: {
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			}
		}
	}
} as const

/**
 * Website edit: the chat model passes a plain-language `instruction`; the SERVER runs the
 * specialist web model (Tinfoil glm-5-2) via this skill's editWebsiteDiff and relays the changed
 * files to the chat, which writes them through the composer's tauriFs Storage adapter (same
 * primitive as the Tigris deploy). GLM does the website work; the chat model just routes. board 0055.
 */
export const EDIT_WEBSITE_TOOL = {
	type: 'function',
	function: {
		name: 'edit_website',
		description:
			"Edit the user's website — a multi-file static site (index.html + a file per route, e.g. " +
			'blog.html). Pass a clear, self-contained `instruction` describing the change (e.g. "add a ' +
			'home/blog nav and a blog page"). A specialist web model applies it as a fast diff across ' +
			'the relevant files (creating new files per route as needed) and saves them — you do NOT ' +
			'write any HTML yourself. Prefer ONE comprehensive instruction, but you MAY call it again ' +
			'to refine — edits compound. Call this when the user asks to change, edit, update, restyle, ' +
			'add to, or fix their website / site / page.',
		parameters: {
			type: 'object',
			properties: {
				instruction: {
					type: 'string',
					description: 'A clear, self-contained description of the change to make to the website.'
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['instruction']
		}
	}
} as const

/** Every Composer-vibe tool the chat advertises: read-only viewer + multi-file editor. */
export const COMPOSER_TOOLS = [SHOW_WEBSITE_TOOL, EDIT_WEBSITE_TOOL]
