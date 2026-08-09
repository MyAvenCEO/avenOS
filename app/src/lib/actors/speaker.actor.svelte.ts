import { Speaker } from '$lib/tts/speaker.svelte'
import { Actor } from './actor'
import { singleton } from './singleton'

/**
 * The voice as an actor. The proven TTS internals (gapless clock, sentence
 * feeding, watchdog) stay in Speaker; this wrapper gives them a manifest,
 * contracts, and a mailbox. Everything it consumes arrives as emitted
 * predicates — the same delta the chat bubble renders is the delta the
 * mouth hears.
 */
export class SpeakerActor extends Actor {
	readonly core = new Speaker()

	constructor() {
		super({
			id: 'speaker',
			name: 'Speaker',
			description:
				'Die Stimme: spricht Antworten satzweise, während sie noch geschrieben werden. ' +
				'On-device Supertonic-TTS; verstummt sofort bei Unterbrechung.',
			tags: ['voice'],
			methods: [],
			requires: ['delta(D)', 'reply(R)', 'discard(R)', 'interrupted()', 'utterance(T)'],
			produces: []
		})
		this.bind({
			delta: (p) => {
				this.core.feed(String(p.text ?? ''))
				return { record: '{"ok":true}', wire: 'ok' }
			},
			reply: () => {
				this.core.flush()
				return { record: '{"ok":true}', wire: 'ok' }
			},
			discard: () => {
				this.core.silence()
				return { record: '{"ok":true}', wire: 'ok' }
			},
			interrupted: () => {
				this.core.silence()
				return { record: '{"ok":true}', wire: 'ok' }
			},
			// The user speaking is the gesture that may wake the output device.
			utterance: () => {
				this.core.resumeAudio()
				return { record: '{"ok":true}', wire: 'ok' }
			}
		})
	}

	override instanceState(): Record<string, unknown> {
		return {
			Status: this.core.status,
			spricht: this.core.speaking ? 'ja' : 'nein',
			Ausgabe: this.core.output
		}
	}

	protected override situation(): string {
		return `Status ${this.core.status}, ${this.core.speaking ? 'spricht gerade' : 'still'}.`
	}
}

import { bus as _bus } from './bus'

export const speakerActor = singleton('aven.speaker', () => new SpeakerActor())
_bus.register(speakerActor)
