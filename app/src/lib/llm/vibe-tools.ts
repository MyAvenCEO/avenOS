/**
 * Vibe-owned agent tools. A vibe ships its OWN tool schema (`tools.json`) + a
 * sandboxed executor (`executeTool` in its `logic.js`). This module is the host side of the
 * planner/applier split:
 *
 *   - the vibe's QuickJS sandbox is the PLANNER — given the model's `args` + the live data, it
 *     validates and returns a PLAN (CRUD `ops` + a machine-facing `toolResult`). It never touches
 *     avenDB, so an untrusted/dynamically-loaded vibe can only ever propose ops on its own table.
 *   - the HOST is the APPLIER — it runs the plan's ops against avenDB through the {@link ToolContext}
 *     (and the agent's cloud loop gates deletes via HITL before this runs).
 *
 * Today the todos vibe is the only tool-bearing vibe; `VIBE_TOOL_DEFS` / `VIBE_TOOL_EXECUTORS`
 * are the seam a future vibe registry plugs into.
 */

import { todoLogic, todoTools } from '@avenos/aven-ui/vibes/todos'
import { sessionRunTool } from '$lib/aven-ui/sandbox-qjs-session'
import { t } from '$lib/i18n'
import type { ToolContext, ToolDef, ToolDispatchResult } from './tools'

/** Tool schemas declared by vibes (today: the todos vibe). Advertised to the cloud model. */
export const VIBE_TOOL_DEFS: ToolDef[] = todoTools as ToolDef[]

/** One op in the plan the sandbox returns; the host applies these to avenDB. */
type TodoOp =
	| { kind: 'create'; title: string }
	| { kind: 'update'; id: string; patch: { title?: string; done?: boolean } }
	| { kind: 'delete'; id: string }

/** The PLAN the todos vibe's sandboxed `executeTool` returns (JSON). */
type TodoPlan = {
	action: 'list' | 'create' | 'update' | 'delete' | 'unknown'
	ops: TodoOp[]
	titles: string[]
	errors: string[]
	toolResult: string
}

/** Localized summary for a completed batch (singular for one, plural for several). */
function todosSummary(
	action: 'create' | 'update' | 'delete',
	titles: string[]
): { message: string; response: string } {
	const base = { create: 'todoAdded', update: 'todoUpdated', delete: 'todoDeleted' }[action]
	if (titles.length === 1) {
		return {
			message: t(`identities.talk.${base}`, { title: titles[0] }),
			response: t(`identities.talk.${base}Reply`, { title: titles[0] })
		}
	}
	const params = { count: titles.length, titles: titles.join(', ') }
	const plural = base.replace('todo', 'todos')
	return {
		message: t(`identities.talk.${plural}`, params),
		response: t(`identities.talk.${plural}Reply`, params)
	}
}

/**
 * Host applier for the todos vibe tool: read the live todos, run the vibe's sandboxed planner to
 * get a CRUD plan, then apply the ops to avenDB via the {@link ToolContext}. The sandbox decided
 * WHAT to do (pure, bounded); the host does the writes.
 */
async function executeTodosVibe(
	args: Record<string, unknown>,
	ctx: ToolContext
): Promise<ToolDispatchResult> {
	const data = ctx.listTodos()
	let plan: TodoPlan | null
	try {
		plan = (await sessionRunTool({
			logic: todoLogic,
			name: 'todos',
			toolArgs: args,
			data
		})) as TodoPlan | null
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) }
	}
	if (!plan) return { ok: false, message: t('identities.talk.todoNoChange') }

	if (plan.action === 'list') {
		return {
			ok: true,
			message: t('identities.talk.todosListed', { count: data.length }),
			toolResult: plan.toolResult
		}
	}
	if (plan.action === 'unknown') {
		return { ok: false, message: t('identities.talk.todoNoChange'), toolResult: plan.toolResult }
	}
	if (!plan.ops?.length) {
		return {
			ok: false,
			message: (plan.errors ?? []).join('; ') || t('identities.talk.todoEmpty'),
			toolResult: plan.toolResult
		}
	}

	const errors = [...(plan.errors ?? [])]
	for (const op of plan.ops) {
		try {
			if (op.kind === 'create') await ctx.createTodo(op.title)
			else if (op.kind === 'update') await ctx.updateTodoById(op.id, op.patch)
			else if (op.kind === 'delete') await ctx.deleteTodoById(op.id)
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e))
		}
	}

	const titles = plan.titles ?? []
	if (titles.length === 0) {
		return {
			ok: false,
			message: errors.join('; ') || t('identities.talk.todoEmpty'),
			toolResult: plan.toolResult
		}
	}
	const { message, response } = todosSummary(plan.action, titles)
	return {
		ok: errors.length === 0,
		message: errors.length > 0 ? `${message} · ⚠️ ${errors.join('; ')}` : message,
		response,
		toolResult: plan.toolResult
	}
}

/** Vibe tool name → host applier. The agent's dispatcher routes vibe-tool calls through here. */
export const VIBE_TOOL_EXECUTORS: Record<
	string,
	(args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolDispatchResult>
> = {
	todos: executeTodosVibe
}
