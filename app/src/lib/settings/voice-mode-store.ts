import { writable } from 'svelte/store'

/**
 * Which voice pipeline the main voice interaction uses (board 0120):
 *   `realtime`   — full realtime live voice: Voxtral realtime STT → fast Tinfoil LLM → Voxtral
 *                  TTS, all inside the Tinfoil enclave, brokered by the Alberobello proxy. DEFAULT.
 *   `on-device`  — the local chain: Parakeet STT → LFM2 → MOSS-TTS-Nano. Offline / no-account.
 *
 * Persisted locally so the choice survives launches; chosen in Account → AI. The default is
 * `realtime`. We read/write through `typeof localStorage` (not `$app/environment`) so the pure
 * logic stays import-safe under `bun test` and during prerender.
 */
export type VoiceMode = 'realtime' | 'on-device'

export const DEFAULT_VOICE_MODE: VoiceMode = 'realtime'
const STORAGE_KEY = 'avenos.voiceMode'

/** Narrow an unknown persisted value to a `VoiceMode`. */
export function isVoiceMode(v: unknown): v is VoiceMode {
	return v === 'realtime' || v === 'on-device'
}

/** Read a persisted mode from any Storage-like backend, defaulting to `realtime`. */
export function readVoiceMode(storage: Pick<Storage, 'getItem'> | null): VoiceMode {
	const raw = storage?.getItem(STORAGE_KEY) ?? null
	return isVoiceMode(raw) ? raw : DEFAULT_VOICE_MODE
}

function backend(): Storage | null {
	return typeof localStorage !== 'undefined' ? localStorage : null
}

export const voiceMode = writable<VoiceMode>(readVoiceMode(backend()))

/** Persist + apply the user's voice-mode choice (from the AI settings tab). */
export function setVoiceMode(mode: VoiceMode): void {
	backend()?.setItem(STORAGE_KEY, mode)
	voiceMode.set(mode)
}
