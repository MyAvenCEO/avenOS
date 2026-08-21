import { singleton } from '$lib/actors/singleton'

/**
 * The shell's one surface switch: the left rail drives it — intents (the
 * default) or the skills platform.
 *
 * `talk` used to live here too, a boolean for "the chat is showing" that had
 * quietly become a scoping rule for HITL gates as well. Both jobs moved to
 * `$lib/query` (0159), where the answer surface owns its own state and its
 * intent context IS the scope.
 */
class ShellState {
	tab = $state<'intents' | 'skills'>('intents')
}

export const shell = singleton('aven.shell', () => new ShellState())
