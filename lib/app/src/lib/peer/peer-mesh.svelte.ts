import { browser } from '$app/environment'
import { get } from 'svelte/store'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { deviceSession } from '$lib/self/device-session-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerMeshStatusReply } from '$lib/peer/mesh-state'
import {
	peerMeshSnapshot,
	peerMeshStatus,
} from '$lib/runtime/groove-runtime'

/** @deprecated Import `peerMeshSnapshot` from `$lib/runtime/groove-runtime` */
export { peerMeshSnapshot }

const MESH_CHANGED_EVENT = 'peer:mesh-changed'

let storeGeneration = 0

/**
 * Subscribe once at app shell level (`+layout.svelte`).
 * Initial hydrate + push events; `avenos:runtime` mesh is handled by `attachAvenosRuntimeBridge`.
 */
export function startPeerMeshStore(): () => void {
	if (!browser || !isTauriRuntime()) {
		return () => {}
	}

	const gen = ++storeGeneration
	const unsubs: UnlistenFn[] = []

	const apply = (snap: PeerMeshStatusReply) => {
		if (gen === storeGeneration) peerMeshSnapshot.set(snap)
	}

	void peerMeshStatus().then((snap) => {
		if (gen === storeGeneration) apply(snap)
	})

	void listen<PeerMeshStatusReply>(MESH_CHANGED_EVENT, (e) => apply(e.payload)).then((u) =>
		unsubs.push(u),
	)
	void listen('peer:hyperswarm-ready', () => void peerMeshStatus().then(apply)).then((u) =>
		unsubs.push(u),
	)
	void listen('peer:invite-paired', () => void peerMeshStatus().then(apply)).then((u) =>
		unsubs.push(u),
	)

	const stopSession = deviceSession.subscribe((s) => {
		if (s.kind !== 'unlocked') {
			peerMeshSnapshot.set(undefined)
		}
	})

	return () => {
		if (gen !== storeGeneration) return
		storeGeneration += 1
		unsubs.forEach((u) => u())
		stopSession()
		peerMeshSnapshot.set(undefined)
	}
}

/** Imperative refresh after local actions (invite accept, revoke) — backend will also push. */
export async function refreshPeerMeshSnapshot(): Promise<PeerMeshStatusReply | undefined> {
	if (!browser || !isTauriRuntime() || get(deviceSession).kind !== 'unlocked') {
		peerMeshSnapshot.set(undefined)
		return undefined
	}
	try {
		const st = await peerMeshStatus()
		peerMeshSnapshot.set(st)
		return st
	} catch {
		peerMeshSnapshot.set(undefined)
		return undefined
	}
}
