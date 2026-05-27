/**
 * Reactive view of the `/self` settings pages: peer status, active genesis, and derived
 * public keys. Created in `/self/+layout.svelte` (via `provideSelfContext`) and consumed
 * by sibling pages (via `useSelfContext`) so data is fetched once and shared.
 */

import { invoke } from '@tauri-apps/api/core'
import { browser } from '$app/environment'
import { getContext, setContext } from 'svelte'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { DEVICE_PEER_SLOT } from '$lib/self/device-session-store'

export type PeerStatus = {
	platformSupported: boolean
	registered: boolean
	unlocked: boolean
}

const KEY = Symbol('self-context')

export type SelfContext = ReturnType<typeof createSelfContext>

export function bytesToBase64(bytes: number[] | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	let s = ''
	for (const b of arr) s += String.fromCharCode(b)
	return btoa(s)
}

export function base64ToBytes(b64: string): number[] {
	const bin = atob(b64)
	const out = new Array<number>(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

function createSelfContext() {
	let status = $state<PeerStatus | undefined>()
	let statusErr = $state<string | undefined>()

	let genesisB64 = $state<string | undefined>()
	let genesisShort = $state<string | undefined>()

	let relayUrl = $state<string | undefined>()
	let relayPublicKeyHex = $state<string | undefined>()
	let dhtBootstrap = $state<string | undefined>()
	let relayAddr = $state<string | undefined>()

	let peerPubB64 = $state<string | undefined>()

	let signingPubB64 = $state<string | undefined>()
	let signingPeerDid = $state<string | undefined>()
	let devicePeerDid = $state<string | undefined>()

	async function refresh(): Promise<void> {
		if (!browser || !isTauriRuntime()) return
		statusErr = undefined
		devicePeerDid = undefined
		signingPeerDid = undefined

		try {
			status = await invoke<PeerStatus>('plugin:self|peer_status', { slot: DEVICE_PEER_SLOT })
		} catch (e) {
			status = undefined
			statusErr = e instanceof Error ? e.message : String(e)
			return
		}

		try {
			const g = await invoke<number[]>('genesis_network_id')
			genesisB64 = bytesToBase64(g)
			genesisShort = `${genesisB64.slice(0, 6)}…${genesisB64.slice(-6)}`
		} catch (e) {
			genesisB64 = undefined
			genesisShort = undefined
			statusErr = e instanceof Error ? e.message : String(e)
		}

		try {
			const relay = await invoke<{
				relayUrl?: string | null
				relayPublicKeyHex?: string | null
				dhtBootstrap?: string | null
				relayAddr?: string | null
			}>('avenos_relay_identity_snapshot')
			relayUrl = relay.relayUrl?.trim() || undefined
			relayPublicKeyHex = relay.relayPublicKeyHex?.trim().toLowerCase() || undefined
			dhtBootstrap = relay.dhtBootstrap?.trim() || undefined
			relayAddr = relay.relayAddr?.trim() || undefined
		} catch {
			relayUrl = undefined
			relayPublicKeyHex = undefined
			dhtBootstrap = undefined
			relayAddr = undefined
		}

		if (status?.registered) {
			try {
				const pk = await invoke<number[]>('plugin:self|public_key', { slot: DEVICE_PEER_SLOT })
				peerPubB64 = bytesToBase64(pk)
			} catch (e) {
				peerPubB64 = undefined
				statusErr = e instanceof Error ? e.message : String(e)
			}

			try {
				devicePeerDid = await invoke<string>('plugin:self|device_peer_did', {
					slot: DEVICE_PEER_SLOT,
				})
			} catch {
				devicePeerDid = undefined
			}
		} else {
			peerPubB64 = undefined
		}

		if (status?.unlocked) {
			try {
				const pk = await invoke<number[]>('plugin:self|signing_public_key')
				signingPubB64 = bytesToBase64(pk)
			} catch (e) {
				signingPubB64 = undefined
				statusErr = e instanceof Error ? e.message : String(e)
			}

			try {
				signingPeerDid = await invoke<string>('plugin:self|signing_peer_did')
			} catch {
				signingPeerDid = undefined
			}
		} else {
			signingPubB64 = undefined
		}
	}

	return {
		get status() {
			return status
		},
		get statusErr() {
			return statusErr
		},
		get genesisB64() {
			return genesisB64
		},
		get genesisShort() {
			return genesisShort
		},
		get relayUrl() {
			return relayUrl
		},
		get relayPublicKeyHex() {
			return relayPublicKeyHex
		},
		get dhtBootstrap() {
			return dhtBootstrap
		},
		get relayAddr() {
			return relayAddr
		},
		get peerPubB64() {
			return peerPubB64
		},
		get signingPubB64() {
			return signingPubB64
		},
		get signingPeerDid() {
			return signingPeerDid
		},
		get devicePeerDid() {
			return devicePeerDid
		},
		refresh,
	}
}

export function provideSelfContext(): SelfContext {
	const ctx = createSelfContext()
	setContext(KEY, ctx)
	return ctx
}

export function useSelfContext(): SelfContext {
	const ctx = getContext<SelfContext>(KEY)
	if (!ctx) throw new Error('useSelfContext: provider missing — wrap pages in /self/+layout.svelte')
	return ctx
}
