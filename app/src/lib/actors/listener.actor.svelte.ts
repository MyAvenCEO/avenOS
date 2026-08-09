import { Listener } from '$lib/asr/listener.svelte'
import { Actor } from './actor'
import { bus } from './bus'

/**
 * The ears as an actor. VAD + recognition stay in Listener; the wrapper
 * declares what they mean to the mesh: finished utterances and barge-ins are
 * emitted predicates, delivered to whoever requires them — today the chat
 * and the speaker, tomorrow whoever else registers.
 */
export class ListenerActor extends Actor {
	readonly core = new Listener({
		// Barge-in fires on voice activity alone, ~64ms in.
		onSpeechStart: () => {
			void bus.emit('interrupted()', {}, 'listener')
		},
		onUtterance: (text) => {
			void bus.emit('utterance(T)', { text }, 'listener')
		}
	})

	constructor() {
		super({
			id: 'listener',
			name: 'Listener',
			description:
				'Die Ohren: Silero-VAD und Nemotron-Erkennung on-device. Fertige Äußerungen ' +
				'werden als utterance emittiert, Dazwischenreden als unterbrochen.',
			tags: ['voice'],
			methods: [],
			requires: [],
			produces: ['utterance(T)', 'interrupted()']
		})
	}

	override instanceState(): Record<string, unknown> {
		return {
			Status: this.core.status,
			'hört gerade': this.core.speech ? 'ja' : 'nein',
			Abtastrate: this.core.rate || '—'
		}
	}

	protected override situation(): string {
		return `Status ${this.core.status}${this.core.speech ? ', hört gerade jemanden' : ''}.`
	}
}

import { bus as _bus } from './bus'

export const listenerActor = new ListenerActor()
_bus.register(listenerActor)
