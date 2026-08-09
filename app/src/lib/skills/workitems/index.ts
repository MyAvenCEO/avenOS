import type { Skill } from '../skill'
import { WorkItems } from './store.svelte'
import { summarize } from './summarize'
import { describeResult, runWorkItemTool, WORKITEM_TOOLS } from './tools'

export { SPARKS, WorkItems } from './store.svelte'

/**
 * The todo list as a skill: its store, its tools, its result language and its
 * view (WorkItemsView.svelte), all in this folder.
 */
export class WorkItemsSkill implements Skill {
	id = 'workitems'
	label = 'Work Items'
	tools = WORKITEM_TOOLS
	store = new WorkItems()

	run(name: string, args: string): { record: string; wire: string } | null {
		if (!this.tools.some((tool) => tool.name === name)) return null
		const record = runWorkItemTool(this.store, name, args)
		// The model gets prose, not JSON — braces fed back into a history are a
		// pattern to fall into; the raw record stays for transcript and toast.
		return { record, wire: describeResult(record) }
	}

	summarize(name: string, resultJson: string) {
		return summarize(name, resultJson)
	}
}

/**
 * The one instance. The spark rail lives in the dashboard layout while the
 * workspace lives in the page — both must see the same store, so the skill is
 * a singleton rather than something each surface constructs for itself.
 */
export const workItemsSkill = new WorkItemsSkill()
