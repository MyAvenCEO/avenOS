/**
 * Readiness + download-progress store for the on-device text LLM
 * (LFM2.5-8B-A1B ONNX via onnxruntime). Sibling of `$lib/asr/model-download-store`:
 * fed by the Rust backend's initial `llm_status` query plus streamed
 * `llm:model-download` events. Drives the Models settings page and the Talk
 * panel's "agent unavailable / preparing" affordances.
 */
import { type Unsubscriber, writable } from 'svelte/store'

export type LlmStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error' | 'unavailable'

export type LlmState = {
	status: LlmStatus
	model: string
	quant: string
	receivedBytes: number
	totalBytes: number
	error?: string
}

/** Payload of the `llm:model-download` event and the `llm_status` reply. */
export type LlmEvent = {
	status?: LlmStatus
	model?: string
	quant?: string
	receivedBytes?: number
	totalBytes?: number
	error?: string
}

export const LLM_MODEL_LABEL = 'LFM2.5 1.2B'
export const LLM_EVENT = 'llm:model-download'
export const LLM_STATUS_COMMAND = 'llm_status'

export const initialLlmState: LlmState = {
	status: 'idle',
	model: LLM_MODEL_LABEL,
	quant: '',
	receivedBytes: 0,
	totalBytes: 0
}

/** Pure: fold one backend event/reply into the next state. */
export function reduceLlmEvent(state: LlmState, ev: LlmEvent): LlmState {
	const next: LlmState = {
		...state,
		model: ev.model ?? state.model,
		quant: ev.quant ?? state.quant,
		receivedBytes: ev.receivedBytes ?? state.receivedBytes,
		totalBytes: ev.totalBytes ?? state.totalBytes
	}
	if (ev.status) next.status = ev.status
	next.error = ev.status === 'error' ? (ev.error ?? state.error ?? 'download failed') : undefined
	if (next.status === 'ready' && next.totalBytes > 0 && next.receivedBytes < next.totalBytes) {
		next.receivedBytes = next.totalBytes
	}
	return next
}

/** Pure: download fraction in [0, 1], or `null` when total is unknown. */
export function llmDownloadFraction(state: LlmState): number | null {
	if (state.totalBytes <= 0) return null
	return Math.max(0, Math.min(1, state.receivedBytes / state.totalBytes))
}

/** Pure: short reason the agent isn't ready to reply, or `null` when ready. */
export function agentUnavailableReason(state: LlmState): string | null {
	switch (state.status) {
		case 'ready':
			return null
		case 'idle':
			return 'AI model not set up'
		case 'downloading':
			return 'AI model downloading…'
		case 'loading':
			return 'AI model loading…'
		case 'error':
			return state.error ? `AI model error: ${state.error}` : 'AI model failed to load'
		case 'unavailable':
			return 'On-device AI is not available in this build'
	}
}

export const llmState = writable<LlmState>(initialLlmState)

export function applyLlmEvent(ev: LlmEvent): void {
	llmState.update((s) => reduceLlmEvent(s, ev))
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Wire the store to the backend: read `llm_status` once, then subscribe to
 * `llm:model-download`. No-op outside Tauri. Safe to call from a layout `$effect`.
 */
export async function startLlmReadiness(): Promise<Unsubscriber> {
	if (!isTauri()) return () => {}
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event')
	])
	try {
		const reply = await invoke<LlmEvent>(LLM_STATUS_COMMAND)
		applyLlmEvent(reply ?? { status: 'unavailable' })
	} catch {
		applyLlmEvent({ status: 'unavailable' })
	}
	const unlisten = await listen<LlmEvent>(LLM_EVENT, (e) => {
		if (e.payload) applyLlmEvent(e.payload)
	})
	return () => unlisten()
}

export type LocalModel = { id: string; sizeBytes: number; isActive: boolean }

export async function listLocalLlmModels(): Promise<LocalModel[]> {
	if (!isTauri()) return []
	const { invoke } = await import('@tauri-apps/api/core')
	try {
		return (await invoke<LocalModel[]>('llm_local_models')) ?? []
	} catch {
		return []
	}
}

export async function cancelLlmDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('llm_cancel_download')
}

export async function startLlmDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('llm_start_download')
}

export async function deleteLlmModel(id: string): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('llm_delete_model', { id })
}
