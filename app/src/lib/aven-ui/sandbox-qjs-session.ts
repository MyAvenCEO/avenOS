import type { InterfaceDef, StyleDef, UiFixtureShell, ViewDef } from '@avenos/aven-ui'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export const SANDBOX_QJS_STATE_EVENT = 'sandbox-qjs://state'

export type SandboxQjsMountRequest = {
	view: ViewDef
	style: StyleDef
	source: Record<string, unknown>
	interface: InterfaceDef
	logic: string
}

export type SandboxQjsMountResult = {
	sessionId: string
	state: Record<string, unknown>
}

export type SandboxQjsStateEvent = {
	sessionId: string
	state: Record<string, unknown>
}

export async function sessionMount(
	request: SandboxQjsMountRequest
): Promise<SandboxQjsMountResult> {
	return invoke<SandboxQjsMountResult>('plugin:sandbox-quickjs|session_mount', { request })
}

export async function sessionDispatch(args: {
	sessionId: string
	send: string
	payload?: Record<string, unknown>
}): Promise<{ ok: boolean; state?: Record<string, unknown> }> {
	return invoke('plugin:sandbox-quickjs|session_dispatch', {
		request: {
			sessionId: args.sessionId,
			send: args.send,
			payload: args.payload ?? {}
		}
	})
}

export async function sessionUnmount(sessionId: string): Promise<void> {
	await invoke('plugin:sandbox-quickjs|session_unmount', { request: { sessionId } })
}

/**
 * Run a vibe's agent-tool executor in the sandbox (stateless). Evals `logic`, calls the global
 * `executeTool(name, args, data)`, and returns the PLAN it produces. The sandbox is the planner —
 * it validates against `data` and returns ops + a machine result; the trusted host applies them.
 */
export async function sessionRunTool(req: {
	logic: string
	name: string
	toolArgs?: unknown
	data?: unknown
}): Promise<unknown> {
	return invoke('plugin:sandbox-quickjs|run_tool', {
		request: { logic: req.logic, name: req.name, args: req.toolArgs ?? {}, data: req.data ?? null }
	})
}

export async function listenSandboxQjsState(
	handler: (event: SandboxQjsStateEvent) => void
): Promise<UnlistenFn> {
	return listen<SandboxQjsStateEvent>(SANDBOX_QJS_STATE_EVENT, (e) => handler(e.payload))
}

export function mountRequestFromShell(shell: UiFixtureShell): SandboxQjsMountRequest {
	return {
		view: shell.view,
		style: shell.style,
		source: shell.source,
		interface: shell.interface,
		logic: shell.logic
	}
}
