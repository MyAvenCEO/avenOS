/**
 * Typed client for the .NET stdio sidecar. The ONLY place UI code reaches the sidecar.
 *
 * UI code never imports `@tauri-apps/api/core` for sidecar calls directly — it goes
 * through these helpers so invoke/event details, error normalization, and event
 * narrowing all live in one place (milestone plan M4).
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { normalizeSidecarError, SidecarRpcError } from './errors'
import { SIDECAR_EVENT } from './events'
import type {
	AgentRuntimeEvent,
	AgentSubmitInput,
	HumanPromptView,
	MessageResult,
	SidecarEnvelope,
	SidecarHello,
	SidecarStatus,
	SubmitResult
} from './types'

export { normalizeSidecarError, SidecarRpcError } from './errors'
export { narrowSidecarEvent, SIDECAR_EVENT } from './events'
export type * from './types'

function ensureDesktop(): void {
	if (!isTauriRuntime()) {
		throw new SidecarRpcError({
			code: 'runtime_not_ready',
			message: 'The .NET agent sidecar is desktop-only and is not available in this runtime.',
			retryable: false
		})
	}
}

/** Generic sidecar RPC. Returns the method `result`; throws {@link SidecarRpcError} on failure. */
export async function agentSidecarInvoke<T = unknown>(
	method: string,
	params: Record<string, unknown> = {}
): Promise<T> {
	ensureDesktop()
	try {
		return await invoke<T>('agent_sidecar_invoke', { method, params })
	} catch (e) {
		throw new SidecarRpcError(normalizeSidecarError(e))
	}
}

// ---- lifecycle commands (dedicated Tauri commands, not the generic invoke) ----

export async function sidecarStatus(): Promise<SidecarStatus> {
	ensureDesktop()
	return invoke<SidecarStatus>('agent_sidecar_status')
}

export async function startSidecar(): Promise<SidecarStatus> {
	ensureDesktop()
	try {
		return await invoke<SidecarStatus>('agent_sidecar_start')
	} catch (e) {
		throw new SidecarRpcError(normalizeSidecarError(e))
	}
}

export async function stopSidecar(): Promise<SidecarStatus> {
	ensureDesktop()
	try {
		return await invoke<SidecarStatus>('agent_sidecar_stop')
	} catch (e) {
		throw new SidecarRpcError(normalizeSidecarError(e))
	}
}

// ---- typed method helpers ----

export const sidecarHello = () => agentSidecarInvoke<SidecarHello>('session.hello')

export const sidecarPing = () => agentSidecarInvoke<{ ok: boolean }>('session.ping')

export const submitMessage = (input: AgentSubmitInput) =>
	agentSidecarInvoke<SubmitResult>('messages.submit', { ...input })

/** Poll target for the settled outcome of a routed turn (until live events land in M8). */
export const getMessageResult = (agentId: string) =>
	agentSidecarInvoke<MessageResult>('messages.result', { agentId })

export const listHumanPrompts = () =>
	agentSidecarInvoke<{ prompts: HumanPromptView[] }>('humanPrompts.list')

export const answerHumanPrompt = (promptId: string, answer: string) =>
	agentSidecarInvoke<Record<string, unknown>>('humanPrompts.answer', { promptId, answer })

export const cancelHumanPrompt = (promptId: string, reason?: string) =>
	agentSidecarInvoke<Record<string, unknown>>('humanPrompts.cancel', { promptId, reason })

// ---- events ----

/**
 * Subscribe to sidecar runtime events, already narrowed to {@link AgentRuntimeEvent}.
 * Returns an unlisten function. Raw envelopes that don't map to a known event are ignored.
 */
export async function listenAgentSidecarEvents(
	handler: (event: AgentRuntimeEvent) => void
): Promise<() => void> {
	ensureDesktop()
	const { narrowSidecarEvent } = await import('./events')
	return listen<SidecarEnvelope>(SIDECAR_EVENT, (e) => {
		const narrowed = narrowSidecarEvent(e.payload)
		if (narrowed) handler(narrowed)
	})
}
