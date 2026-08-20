import { singleton } from '$lib/actors/singleton'

/**
 * The one Talk-to-MAIA switch, shared between the shell and the intents
 * workspace: any chat activity (typed or spoken, from the global pill)
 * flips it on, so the conversation surface is ALWAYS where the answer —
 * including inline views like the todo list — appears.
 */
class TalkState {
	open = $state(false)
	/** The intent currently in view (null while talking) — HITL gates scope to it. */
	intentContext = $state<string | null>(null)
}

export const talk = singleton('aven.talk', () => new TalkState())
