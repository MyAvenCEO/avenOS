/**
 * User-facing knobs, persisted across launches.
 *
 * Deliberately tiny: one object, localStorage, no schema machinery. The
 * settings page writes it, the engines read it at the moment of use — the
 * speaker passes `voice` on every synthesis call, so a change applies from
 * the next spoken sentence without any restart.
 */

/** Every voice Supertonic ships; must match `VOICES` in src-tauri/src/tts. */
export const VOICES = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const
export type Voice = (typeof VOICES)[number]

const KEY = 'aven.settings'

function load(): { voice: Voice } {
	try {
		const raw = localStorage.getItem(KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (VOICES.includes(parsed.voice)) return { voice: parsed.voice }
		}
	} catch {
		// Corrupt or unavailable storage reads as defaults.
	}
	return { voice: 'M5' }
}

class Settings {
	voice = $state<Voice>(load().voice)

	constructor() {
		$effect.root(() => {
			$effect(() => {
				localStorage.setItem(KEY, JSON.stringify({ voice: this.voice }))
			})
		})
	}
}

export const settings = new Settings()
