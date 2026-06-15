import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { NetworkId } from './network'

/**
 * Which network the user picked on the Select Network intro. Persisted locally so the
 * choice is remembered across launches; there is intentionally no in-app switch UI
 * (changing networks means clearing this key). Lives in localStorage because the pick
 * happens BEFORE any vault exists — there's no crypto store to read from yet.
 */
const STORAGE_KEY = 'avenos.network'

function readStored(): NetworkId | null {
	if (!browser) return null
	const raw = localStorage.getItem(STORAGE_KEY)
	return raw === 'testnet' || raw === 'mainnet' ? raw : null
}

export const selectedNetwork = writable<NetworkId | null>(readStored())

/** Persist + apply the user's network choice from the Select Network intro. */
export function selectNetwork(id: NetworkId): void {
	if (browser) localStorage.setItem(STORAGE_KEY, id)
	selectedNetwork.set(id)
}
