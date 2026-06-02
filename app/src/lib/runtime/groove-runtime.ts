import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { browser } from '$app/environment'
import { writable, get } from 'svelte/store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerMeshStatusReply } from '$lib/peer/mesh-state'
import { applyRuntimeSession } from '$lib/runtime/jazz-shell'
import { getTableRowsStore } from '$lib/runtime/table-stores'
import { grooveRuntime } from '$lib/runtime/groove-ipc'

export { grooveRuntime } from '$lib/runtime/groove-ipc'

/**
 * Live mesh snapshot — updated only by `avenos:runtime` `{ kind: 'mesh' }`.
 */
export const peerMeshSnapshot = writable<PeerMeshStatusReply | undefined>(undefined)

/**
 * Local Groove shell is hydrated and ACL/mesh gates may run.
 * Driven by `avenos:runtime` `{ kind: 'session', grooveReady }` and unlock/bootstrap paths.
 */
export const grooveSessionReady = writable(false)

/** Resolves when LockGate/bootstrap has hydrated the local Groove shell. */
export function waitForGrooveSessionReady(): Promise<void> {
	if (get(grooveSessionReady)) return Promise.resolve()
	return new Promise((resolve) => {
		let unsub: (() => void) | undefined
		const done = () => {
			unsub?.()
			resolve()
		}
		unsub = grooveSessionReady.subscribe((ready) => {
			if (ready) done()
		})
		if (get(grooveSessionReady)) done()
	})
}

type AvenosRuntimePayload =
	| {
			kind: 'session'
			grooveReady?: boolean
			phase?: string
			message?: string
			peerDid?: string
			defaultSparkUrn?: string
			tables?: string[]
	  }
	| { kind: 'mesh'; snapshot: PeerMeshStatusReply }
	| { kind: 'table'; table?: string; rows?: unknown[] }
	| { kind: string; [key: string]: unknown }

let bridgeGeneration = 0

/** Single `avenos:runtime` listener for session + mesh (layout-level). */
export function attachAvenosRuntimeBridge(): () => void {
	if (!browser || !isTauriRuntime()) {
		return () => {}
	}

	const gen = ++bridgeGeneration
	const unsubs: UnlistenFn[] = []

	void listen<AvenosRuntimePayload>('avenos:runtime', (e) => {
		const p = e.payload
		if (!p || typeof p !== 'object') return
		if (gen !== bridgeGeneration) return
		if (p.kind === 'session') {
			applyRuntimeSession(p as Extract<AvenosRuntimePayload, { kind: 'session' }>)
			if (typeof p.grooveReady === 'boolean') {
				grooveSessionReady.set(p.grooveReady)
			}
		}
		if (p.kind === 'mesh' && p.snapshot && typeof p.snapshot === 'object') {
			peerMeshSnapshot.set(p.snapshot as PeerMeshStatusReply)
		}
		if (p.kind === 'table' && typeof p.table === 'string' && Array.isArray((p as { rows?: unknown }).rows)) {
			const pl = p as { table: string; rows: unknown[] }
			getTableRowsStore(pl.table).set(pl.rows)
		}
	}).then((u) => unsubs.push(u))

	return () => {
		if (gen !== bridgeGeneration) return
		bridgeGeneration += 1
		unsubs.forEach((u) => u())
	}
}

export async function peerMeshStatus(): Promise<PeerMeshStatusReply> {
	return grooveRuntime<PeerMeshStatusReply>('meshStatus', {})
}
