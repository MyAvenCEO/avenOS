import type { ToolSpec } from '$lib/chat/redpill'
import type { Activity } from './activity.svelte'

/**
 * One skill: a self-contained cluster of tools the model can use.
 *
 * Everything a tool cluster is made of lives in the skill's own folder — the
 * tool specs the model sees, the executor that runs a call against the
 * skill's state, the summarizer that turns a raw result into a displayable
 * entry, and the skill's own view. The dashboard composes skills without
 * knowing what any of them do: specs are concatenated for the model, a call
 * is offered to each skill until one claims it, and the entries feed the
 * toast and the transcript alike. Adding a skill is adding a folder.
 */
export interface Skill {
	/** Stable identifier; also the tab id. */
	id: string
	/** Tab label. */
	label: string
	/** The tools this skill contributes to the model. */
	tools: ToolSpec[]
	/**
	 * Execute one call, or decline it. Null means "not mine" and the call is
	 * offered to the next skill; a result carries the raw record for the
	 * transcript and the prose the model reads back.
	 */
	run(name: string, args: string): { record: string; wire: string } | null
	/** One displayable entry out of a raw result, or null for a no-op. */
	summarize(name: string, resultJson: string): Omit<Activity, 'id'> | null
}
