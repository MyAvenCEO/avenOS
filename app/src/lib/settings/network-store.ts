import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { NetworkId } from './network'

/**
 * Which world the user is in, and which one they were in last.
 *
 * These are deliberately two different things:
 *
 * - `selectedNetwork` is the ACTIVE world, and it is session-scoped — it lives
 *   in memory only. Every sign-in therefore starts on the Select Network intro,
 *   which is the point: the world is a choice you make on the way in, not a
 *   setting that quietly decides for you.
 * - `lastNetwork` is the world you chose last time, and it IS persisted. The
 *   intro pre-selects it, so "same world as before" costs one click or one
 *   Enter rather than a fresh decision.
 *
 * It was previously one persisted key, which meant logging out of mainnet had
 * to delete it to get you back to the intro — so the choice was forgotten
 * outright. Splitting the two keeps the intro on every sign-in AND remembers.
 *
 * localStorage, not the vault, because the pick happens BEFORE any vault exists
 * — there is no crypto store to read from yet.
 */
const LAST_KEY = 'avenos.network.last'

function readLast(): NetworkId | null {
	if (!browser) return null
	const raw = localStorage.getItem(LAST_KEY)
	return raw === 'testnet' || raw === 'mainnet' || raw === 'city' ? raw : null
}

/** The world this session is in. Starts null on every launch → the intro shows. */
export const selectedNetwork = writable<NetworkId | null>(null)

/** The world chosen last time, used to pre-select a card on the intro. */
export const lastNetwork = writable<NetworkId | null>(readLast())

/** Persist + apply the user's network choice from the Select Network intro. */
export function selectNetwork(id: NetworkId): void {
	if (browser) localStorage.setItem(LAST_KEY, id)
	lastNetwork.set(id)
	selectedNetwork.set(id)
}

/**
 * Leave the current world → the app returns to the Select Network intro.
 *
 * Only the active pick is dropped; `lastNetwork` survives so the intro still
 * knows where you were. Callers sign out of the world FIRST (bearer token on
 * mainnet, device session on testnet) — this never touches a session itself.
 */
export function clearNetwork(): void {
	selectedNetwork.set(null)
}
