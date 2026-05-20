import { writable } from 'svelte/store'

/**
 * Populated by root layout when the user drops files anywhere in the app (while unlocked).
 * Intents `+page` consumes this once the composer bar is mounted, then clears.
 */
export const pendingIntentFileDrop = writable<File[] | null>(null)
