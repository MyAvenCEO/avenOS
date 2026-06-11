import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get, writable } from 'svelte/store'
import { browser } from '$app/environment'
import { avendbSessionReady, peerMeshSnapshot } from '$lib/runtime/avendb-runtime'
import { resetAvenDbShell } from '$lib/runtime/avendb-shell'
import { resetAllTableRowStores } from '$lib/runtime/table-stores'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
export const DEVICE_PEER_SLOT = 'device_default'

/** Pinned Rust identity (`plugin:self|active_identity`) — authoritative while unlocked. */
export type ActiveVaultIdentity = {
	usernameSlug: string
	pairingLabel?: string | null
	ppkHex: string
}

export type DeviceSession =
	| { kind: 'locked' }
	/** Root + derived keys live in Rust; frontend only mirrors slug + signing ppK hex. */
	| { kind: 'unlocked'; identity: ActiveVaultIdentity }

export const deviceSession = writable<DeviceSession>({ kind: 'locked' })

export async function fetchActiveVaultIdentity(): Promise<ActiveVaultIdentity | null> {
	if (!browser || !isTauriRuntime()) return null
	const row = await invoke<ActiveVaultIdentity | null>('plugin:self|active_identity')
	return row ?? null
}

/** Sets unlocked session from Rust authoritative identity snapshot. */
export function setUnlockedWithIdentity(identity: ActiveVaultIdentity): void {
	deviceSession.set({ kind: 'unlocked', identity })
}

export function applyLockedFrontendState(): void {
	resetAllTableRowStores()
	resetAvenDbShell()
	avendbSessionReady.set(false)
	peerMeshSnapshot.set(undefined)
	deviceSession.set({ kind: 'locked' })
}

/** Best-effort lock: zeros Rust root and resets mirrored stores. */
export async function clearDeviceSession(): Promise<void> {
	try {
		await invoke('plugin:self|lock')
	} catch {
		// swallow — locking is best-effort
	}
	applyLockedFrontendState()
}

/** One-shot listeners: keep webview mirrored when Rust lock/unlock happens outside LockGate (rare). */
export function attachSelfRustEventMirrors(): () => void {
	if (!browser || !isTauriRuntime()) return () => {}

	let stop = () => {}

	void (async () => {
		try {
			const u1 = await listen('self:did-lock', () => {
				applyLockedFrontendState()
			})
			const u2 = await listen('self:did-unlock', async () => {
				// LockGate already runs bootstrapAvenDbStrict before setUnlocked — do not bootstrap again here
				// (parallel hydrate contends on shell_hydrate / conn and can stall pairing IPC).
				if (get(deviceSession).kind !== 'unlocked') return
				const id = await fetchActiveVaultIdentity().catch(() => null)
				if (id) setUnlockedWithIdentity(id)
			})
			stop = () => {
				u1()
				u2()
			}
		} catch {
			/* noop */
		}
	})()

	return () => stop()
}
