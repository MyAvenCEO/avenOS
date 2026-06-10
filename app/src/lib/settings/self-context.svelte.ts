/**
 * Reactive view of the `/self` settings pages: peer status, network seed, and derived
 * public keys. Created in `/settings/+layout.svelte` (via `provideSelfContext`) and consumed
 * by sibling pages (via `useSelfContext`) so data is fetched once and shared.
 */

import { invoke } from '@tauri-apps/api/core'
import { browser } from '$app/environment'
import { getContext, setContext } from 'svelte'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { DEVICE_PEER_SLOT } from '$lib/settings/device-session-store'
import { NETWORK_SEED as NETWORK_SEED_FALLBACK } from '$lib/settings/network'

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

	let networkSeed = $state<string>(NETWORK_SEED_FALLBACK)

	let signingPubB64 = $state<string | undefined>()
	let signerDid = $state<string | undefined>()

	async function refresh(): Promise<void> {
		if (!browser || !isTauriRuntime()) return
		statusErr = undefined
		signerDid = undefined

		try {
			networkSeed = await invoke<string>('network_seed')
		} catch {
			networkSeed = NETWORK_SEED_FALLBACK
		}

		try {
			status = await invoke<PeerStatus>('plugin:self|peer_status', { slot: DEVICE_PEER_SLOT })
		} catch (e) {
			status = undefined
			statusErr = e instanceof Error ? e.message : String(e)
			return
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
				signerDid = await invoke<string>('plugin:self|signer_did')
			} catch {
				signerDid = undefined
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
		get networkSeed() {
			return networkSeed
		},
		get signingPubB64() {
			return signingPubB64
		},
		get signerDid() {
			return signerDid
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
	if (!ctx) throw new Error('useSelfContext: provider missing — wrap pages in /settings/+layout.svelte')
	return ctx
}
