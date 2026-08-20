import { Actor } from './actor'

/**
 * A GENERIC actor, built entirely from a data manifest — no domain subclass.
 * The one job the base can't do itself is hold reactive state: `$state` lives
 * only in a `.svelte.ts`, so this thin class adds it and nothing else. Any
 * skill config becomes a running, reactive actor via `new ConfigActor(config)`.
 *
 * Self-talk (`situation`/`instanceState`) is derived generically from `state`
 * — whatever the sandbox produced — so the registry and the LLM can describe
 * the actor without a line of per-domain code.
 */
export class ConfigActor extends Actor {
	state = $state<Record<string, unknown>>({})

	override instanceState(): Record<string, unknown> | null {
		const s = this.state
		return s.counts ? { ...(s.counts as Record<string, unknown>), active: s.active } : null
	}
}
