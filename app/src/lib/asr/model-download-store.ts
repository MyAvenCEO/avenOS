/**
 * Readiness + download-progress store for the on-device voice model
 * (Gemma 4 E4B). Fed by the Rust backend: an initial `asr_status` query plus
 * streamed `asr:model-download` events. The UI uses this to drive the composer's
 * inline "preparing" pill and the Models settings page; `SparkTalkPanel`
 * derives `voiceUnavailableReason` and `voicePrep` from it.
 *
 * The reducer + `voiceUnavailableReason` are pure so they can be unit-tested
 * without a Tauri runtime.
 */
import { type Unsubscriber, writable } from 'svelte/store'

export type AsrStatus = 'idle' | 'downloading' | 'ready' | 'error' | 'unavailable'

export type AsrState = {
	status: AsrStatus
	/** Friendly model name for labels, e.g. "Gemma 4 E4B". */
	model: string
	/** Selected quantization/optimization, e.g. "AFQ4 · Apple-optimized". */
	quant: string
	receivedBytes: number
	totalBytes: number
	error?: string
}

/** Payload of the `asr:model-download` Tauri event and the `asr_status` reply. */
export type AsrEvent = {
	status?: AsrStatus
	name?: string
	model?: string
	quant?: string
	receivedBytes?: number
	totalBytes?: number
	error?: string
}

export const ASR_MODEL_LABEL = 'Gemma 4 E4B'
export const ASR_EVENT = 'asr:model-download'
export const ASR_STATUS_COMMAND = 'asr_status'

export const initialAsrState: AsrState = {
	status: 'idle',
	model: ASR_MODEL_LABEL,
	quant: '',
	receivedBytes: 0,
	totalBytes: 0
}

/** Pure: fold one backend event/reply into the next state. */
export function reduceAsrEvent(state: AsrState, ev: AsrEvent): AsrState {
	const next: AsrState = {
		...state,
		model: ev.model ?? ev.name ?? state.model,
		quant: ev.quant ?? state.quant,
		receivedBytes: ev.receivedBytes ?? state.receivedBytes,
		totalBytes: ev.totalBytes ?? state.totalBytes
	}
	if (ev.status) next.status = ev.status
	next.error = ev.status === 'error' ? (ev.error ?? state.error ?? 'download failed') : undefined
	if (next.status === 'ready') {
		// On ready, present a full bar if totals were never reported.
		if (next.totalBytes > 0 && next.receivedBytes < next.totalBytes) {
			next.receivedBytes = next.totalBytes
		}
	}
	return next
}

/** Pure: download fraction in [0, 1], or `null` when total is unknown. */
export function downloadFraction(state: AsrState): number | null {
	if (state.totalBytes <= 0) return null
	return Math.max(0, Math.min(1, state.receivedBytes / state.totalBytes))
}

/**
 * Pure: the short reason the voice feature isn't ready, or `null` when ready.
 * `SparkTalkPanel` passes this to the composer; while non-null, clicking the mic
 * opens the mini modal instead of recording.
 */
export function voiceUnavailableReason(state: AsrState): string | null {
	switch (state.status) {
		case 'ready':
			return null
		case 'downloading':
		case 'idle':
			return 'Voice model downloading…'
		case 'error':
			return state.error ? `Voice model error: ${state.error}` : 'Voice model failed to load'
		case 'unavailable':
			return 'On-device voice transcription is not available in this build'
	}
}

export const asrState = writable<AsrState>(initialAsrState)

/** Apply a backend event to the shared store. */
export function applyAsrEvent(ev: AsrEvent): void {
	asrState.update((s) => reduceAsrEvent(s, ev))
}

/**
 * Wire the store to the Rust backend: read `asr_status` once, then subscribe to
 * `asr:model-download` events. No-op (and returns a no-op unsubscriber) outside
 * the Tauri runtime. Safe to call from a layout `$effect`.
 */
export async function startAsrReadiness(): Promise<Unsubscriber> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
		return () => {}
	}
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event')
	])

	try {
		const reply = await invoke<AsrEvent>(ASR_STATUS_COMMAND)
		applyAsrEvent(reply ?? { status: 'unavailable' })
	} catch {
		// Command missing / feature off → treat as unavailable, not a hard error.
		applyAsrEvent({ status: 'unavailable' })
	}

	const unlisten = await listen<AsrEvent>(ASR_EVENT, (e) => {
		if (e.payload) applyAsrEvent(e.payload)
	})
	return () => unlisten()
}

/** A model directory found in the on-device HF cache (`asr_local_models`). */
export type LocalModel = {
	/** Hugging Face repo id, e.g. "google/gemma-4-E4B-it". */
	id: string
	/** Bytes occupied on disk. */
	sizeBytes: number
	/** True for the model AvenOS manages for voice transcription. */
	isActive: boolean
}

/**
 * List models present on disk (the HF cache under `.avenOS/models`). Returns an
 * empty list outside the Tauri runtime or when nothing has been downloaded yet.
 */
export async function listLocalModels(): Promise<LocalModel[]> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
		return []
	}
	const { invoke } = await import('@tauri-apps/api/core')
	try {
		return (await invoke<LocalModel[]>('asr_local_models')) ?? []
	} catch {
		return []
	}
}

/** Stop the in-flight voice-model download and reset progress to idle. */
export async function cancelDownload(): Promise<void> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('asr_cancel_download')
}

/** (Re)start the voice-model download in the background. */
export async function startDownload(): Promise<void> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('asr_start_download')
}

/** Delete a model's files from the on-device cache (cancels its download first). */
export async function deleteModel(id: string): Promise<void> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
	const { invoke } = await import('@tauri-apps/api/core')
	await invoke('asr_delete_model', { id })
}
