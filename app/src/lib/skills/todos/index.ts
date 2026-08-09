import type { Skill } from '../skill'
import { Todos } from './store.svelte'
import { summarize } from './summarize'
import { describeResult, runTodoTool, TODO_TOOLS } from './tools'

export { Todos } from './store.svelte'

/**
 * The todo list as a skill: its store, its tools, its result language and its
 * view (TodosView.svelte), all in this folder.
 */
export class TodosSkill implements Skill {
	id = 'todos'
	label = 'Todos'
	tools = TODO_TOOLS
	store = new Todos()

	run(name: string, args: string): { record: string; wire: string } | null {
		if (!this.tools.some((tool) => tool.name === name)) return null
		const record = runTodoTool(this.store, name, args)
		// The model gets prose, not JSON — braces fed back into a history are a
		// pattern to fall into; the raw record stays for transcript and toast.
		return { record, wire: describeResult(record) }
	}

	summarize(name: string, resultJson: string) {
		return summarize(name, resultJson)
	}
}
