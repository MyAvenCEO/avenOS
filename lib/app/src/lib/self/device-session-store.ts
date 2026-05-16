import { invoke } from '@tauri-apps/api/core'
import { writable } from 'svelte/store'

/** Single-device Secure Enclave slot label (`PEER_ID_<device>` keychain partition). */
export const DEVICE_PEER_SLOT = 'device_default'

export type DeviceSession =
	| { kind: 'locked' }
	/** Root secret + every derived key live in the Rust process, not in this WebView. */
	| { kind: 'unlocked' }
	/** CI / Linux dev escape — no hardware identity (never ship unlocked prod flows here). */
	| { kind: 'dev_bypass' }

export const deviceSession = writable<DeviceSession>({ kind: 'locked' })

export function setUnlocked(): void {
	deviceSession.set({ kind: 'unlocked' })
}

export function devBypassUnlock(): void {
	deviceSession.set({ kind: 'dev_bypass' })
}

/** Best-effort lock: zeroizes the Rust-side root and resets the store. Safe to call when locked. */
export async function clearDeviceSession(): Promise<void> {
	try {
		await invoke('plugin:self|lock')
	} catch {
		// Swallow — locking is best-effort (e.g. mid-shutdown the bridge may already be gone).
	}
	deviceSession.set({ kind: 'locked' })
}
