/**
 * Readiness + download-progress store for the on-device TTS model
 * (MOSS-TTS-Nano via onnxruntime). Sibling of `$lib/llm/model-download-store`:
 * fed by the Rust backend's initial `tts_status` query plus streamed
 * `tts:model-download` events. Drives the Models settings page (manual
 * download/delete) and the Talk panel's Speak affordance.
 */
import { type Unsubscriber, writable } from 'svelte/store'

export type TtsStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error' | 'unavailable'

export type TtsState = {
	status: TtsStatus
	model: string
	quant: string
	receivedBytes: number
	totalBytes: number
	error?: string
}

/** Payload of the `tts:model-download` event and the `tts_status` reply. */
export type TtsEvent = {
	status?: TtsStatus
	model?: string
	quant?: string
	receivedBytes?: number
	totalBytes?: number
	error?: string
}

export const TTS_MODEL_LABEL = 'MOSS-TTS-Nano'
export const TTS_EVENT = 'tts:model-download'
export const TTS_STATUS_COMMAND = 'tts_status'

export const initialTtsState: TtsState = {
	status: 'idle',
	model: TTS_MODEL_LABEL,
	quant: '',
	receivedBytes: 0,
	totalBytes: 0,
}

/** Pure: fold one backend event/reply into the next state. */
export function reduceTtsEvent(state: TtsState, ev: TtsEvent): TtsState {
	const next: TtsState = {
		...state,
		model: ev.model ?? state.model,
		quant: ev.quant ?? state.quant,
		receivedBytes: ev.receivedBytes ?? state.receivedBytes,
		totalBytes: ev.totalBytes ?? state.totalBytes,
	}
	if (ev.status) next.status = ev.status
	next.error = ev.status === 'error' ? (ev.error ?? state.error ?? 'download failed') : undefined
	if (next.status === 'ready' && next.totalBytes > 0 && next.receivedBytes < next.totalBytes) {
		next.receivedBytes = next.totalBytes
	}
	return next
}

/** Pure: download fraction in [0, 1], or `null` when total is unknown. */
export function ttsDownloadFraction(state: TtsState): number | null {
	if (state.totalBytes <= 0) return null
	return Math.max(0, Math.min(1, state.receivedBytes / state.totalBytes))
}

export const ttsState = writable<TtsState>(initialTtsState)

export function applyTtsEvent(ev: TtsEvent): void {
	ttsState.update((s) => reduceTtsEvent(s, ev))
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Wire the store to the backend: read `tts_status` once, then subscribe to
 * `tts:model-download`. No-op outside Tauri. Safe to call from a layout `$effect`.
 */
export async function startTtsReadiness(): Promise<Unsubscriber> {
	if (!isTauri()) return () => {}
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event'),
	])
	try {
		const reply = await invoke<TtsEvent>(TTS_STATUS_COMMAND)
		applyTtsEvent(reply ?? { status: 'unavailable' })
	} catch {
		applyTtsEvent({ status: 'unavailable' })
	}
	const unlisten = await listen<TtsEvent>(TTS_EVENT, (e) => {
		if (e.payload) applyTtsEvent(e.payload)
	})
	return () => unlisten()
}

export type LocalModel = { id: string; sizeBytes: number; isActive: boolean }

export async function listLocalTtsModels(): Promise<LocalModel[]> {
	if (!isTauri()) return []
	const { invoke } = await import('@tauri-apps/api/core')
	try {
		return (await invoke<LocalModel[]>('tts_local_models')) ?? []
	} catch {
		return []
	}
}

export async function cancelTtsDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('tts_cancel_download')
}

export async function startTtsDownload(): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('tts_start_download')
}

export async function deleteTtsModel(id: string): Promise<void> {
	if (!isTauri()) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('tts_delete_model', { id })
}
