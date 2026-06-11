import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { browser } from '$app/environment'
import { writable, get } from 'svelte/store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerMeshStatusReply } from '$lib/peer/mesh-state'
import { applyRuntimeSession } from '$lib/runtime/avendb-shell'
import { getTableRowsStore } from '$lib/runtime/table-stores'
import { avenDbRuntime } from '$lib/runtime/avendb-ipc'

export { avenDbRuntime } from '$lib/runtime/avendb-ipc'

/**
 * Live mesh snapshot — updated only by `avenos:runtime` `{ kind: 'mesh' }`.
 */
export const peerMeshSnapshot = writable<PeerMeshStatusReply | undefined>(undefined)

/**
 * Local avenDB shell is hydrated and ACL/mesh gates may run.
 * Driven by `avenos:runtime` `{ kind: 'session', avendbReady }` and unlock/bootstrap paths.
 */
export const avendbSessionReady = writable(false)

/** Resolves when LockGate/bootstrap has hydrated the local avenDB shell. */
export function waitForAvenDbSessionReady(): Promise<void> {
	if (get(avendbSessionReady)) return Promise.resolve()
	return new Promise((resolve) => {
		let unsub: (() => void) | undefined
		const done = () => {
			unsub?.()
			resolve()
		}
		unsub = avendbSessionReady.subscribe((ready) => {
			if (ready) done()
		})
		if (get(avendbSessionReady)) done()
	})
}

type AvenosRuntimePayload =
	| {
			kind: 'session'
			avendbReady?: boolean
			phase?: string
			message?: string
			signerDid?: string
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
			if (typeof p.avendbReady === 'boolean') {
				avendbSessionReady.set(p.avendbReady)
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
	return avenDbRuntime<PeerMeshStatusReply>('meshStatus', {})
}
