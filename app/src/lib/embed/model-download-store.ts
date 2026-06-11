/**
 * Readiness + download-progress store for the on-device brain embedder
 * (EmbeddingGemma-300m ONNX). Sibling of `$lib/llm/model-download-store` — the
 * EXACT same flow: fed by the Rust backend's initial `embed_status` query plus
 * streamed `embed:model-download` events. Drives the Models settings page; once
 * the weights land, the brain embeds with Gemma instead of the stub (run
 * `brainReembed` to migrate existing memories into Gemma space).
 */
import { type Unsubscriber, writable } from 'svelte/store'

export type EmbedStatus = 'idle' | 'downloading' | 'ready' | 'error' | 'unavailable'

export type EmbedState = {
	status: EmbedStatus
	model: string
	receivedBytes: number
	totalBytes: number
	error?: string
}

/** Payload of the `embed:model-download` event and the `embed_status` reply. */
export type EmbedEvent = {
	status?: EmbedStatus
	model?: string
	receivedBytes?: number
	totalBytes?: number
	error?: string
}

export const EMBED_MODEL_LABEL = 'EmbeddingGemma 300m'
export const EMBED_EVENT = 'embed:model-download'
export const EMBED_STATUS_COMMAND = 'embed_status'

export const initialEmbedState: EmbedState = {
	status: 'idle',
	model: EMBED_MODEL_LABEL,
	receivedBytes: 0,
	totalBytes: 0
}

/** Pure: fold one backend event/reply into the next state. */
export function reduceEmbedEvent(state: EmbedState, ev: EmbedEvent): EmbedState {
	const next: EmbedState = {
		...state,
		model: ev.model ?? state.model,
		receivedBytes: ev.receivedBytes ?? state.receivedBytes,
		totalBytes: ev.totalBytes ?? state.totalBytes
	}
	if (ev.status) next.status = ev.status
	next.error = ev.error ?? (ev.status ? undefined : state.error)
	if (next.status === 'ready' && next.totalBytes > 0 && next.receivedBytes < next.totalBytes) {
		next.receivedBytes = next.totalBytes
	}
	return next
}

/** Pure: download fraction in [0, 1], or `null` when total is unknown. */
export function embedDownloadFraction(state: EmbedState): number | null {
	if (state.totalBytes <= 0) return null
	return Math.max(0, Math.min(1, state.receivedBytes / state.totalBytes))
}

export const embedState = writable<EmbedState>(initialEmbedState)

export function applyEmbedEvent(ev: EmbedEvent): void {
	embedState.update((s) => reduceEmbedEvent(s, ev))
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Wire the store to the backend: read `embed_status` once, then subscribe to
 * `embed:model-download`. No-op outside Tauri. Safe to call from a layout `$effect`.
 */
export async function startEmbedReadiness(): Promise<Unsubscriber> {
	if (!isTauri()) return () => {}
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event')
	])
	try {
		const reply = await invoke<EmbedEvent>(EMBED_STATUS_COMMAND)
		applyEmbedEvent(reply ?? { status: 'unavailable' })
	} catch {
		applyEmbedEvent({ status: 'unavailable' })
	}
	const unlisten = await listen<EmbedEvent>(EMBED_EVENT, (e) => {
		if (e.payload) applyEmbedEvent(e.payload)
	})
	return () => unlisten()
}

export type LocalEmbedModel = { id: string; sizeBytes: number; isActive: boolean }

export async function listLocalEmbedModels(): Promise<LocalEmbedModel[]> {
	if (!isTauri()) return []
	const { invoke } = await import('@tauri-apps/api/core')
	try {
		return (await invoke<LocalEmbedModel[]>('embed_local_models')) ?? []
	} catch {
		return []
	}
}

export async function cancelEmbedDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('embed_cancel_download')
}

export async function startEmbedDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('embed_start_download')
}

export async function deleteEmbedModel(id: string): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('embed_delete_model', { id })
}
