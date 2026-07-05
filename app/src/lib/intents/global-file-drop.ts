import { writable } from 'svelte/store'

/**
 * Populated by root layout when the user drops files anywhere in the app (while unlocked).
 * Intents `+page` consumes this once the composer bar is mounted, then clears.
 */
export const pendingIntentFileDrop = writable<File[] | null>(null)

/**
 * Mainnet counterpart: root layout parks dropped files here when the active world is mainnet.
 * `MainnetChat` consumes it into its composer (preview thumbnails above the input), then clears —
 * so a dropped image/PDF rides along to the LLM on submit (e.g. the bookkeeping classifier). 0063.
 */
export const pendingMainnetFileDrop = writable<File[] | null>(null)
