import { chatActor } from '$lib/actors/chat.actor.svelte'
import { singleton } from '$lib/actors/singleton'
import { speakerActor } from '$lib/actors/speaker.actor.svelte'
import { routingQuestion } from '$lib/chat/input-copy'
import { shell } from './talk.svelte'

/**
 * The one composer — the field at the foot of the intent's stream where you
 * write, and where what you say appears as it is heard. Its draft lives here
 * rather than in a component so the page (keystrokes anywhere, the live
 * transcript) and the column that renders the field share one state.
 */
class Composer {
	/** Registered by the mounted workspace, including its current inner view. */
	historySurface = $state<'inline' | 'popup'>('popup')
	private opened = $state(false)
	get overlay(): boolean {
		return this.opened && this.historySurface === 'popup'
	}

	/** Reveal the existing history where possible; never duplicate it. */
	reveal(): void {
		this.opened = this.historySurface === 'popup'
		if (this.historySurface === 'inline') {
			shell.detail = true
			shell.rightOpen = false
		}
	}

	close(): void {
		this.opened = false
	}

	draft = $state('')
	draftError = $state('')
	/** Bumped to ask the field to take focus; the field watches it. */
	focusTick = $state(0)
	/**
	 * Raised by a keystroke or tap; remains available after submission.
	 * Explicit dismissal hides an empty field, never a non-empty draft.
	 */
	active = $state(false)

	get composing(): boolean {
		return this.active || this.draft !== '' || chatActor.core.input.items.length > 0
	}

	/** Put the field away — unless there is still something in it. */
	dismiss(): void {
		if (this.draft.trim() === '') {
			this.draft = ''
			this.active = false
		}
	}

	/** Bring the field up, optionally seeded with the keystroke that asked. */
	focus(seed = ''): void {
		this.reveal()
		if (seed) this.draft += seed
		this.active = true
		this.focusTick++
	}

	/** Submit to the input widget's admission tray, not to a conversation yet. */
	send(): void {
		const text = this.draft.trim()
		if (text === '') return
		// The send is the user gesture the audio device needs; without it the
		// first reply would synthesize into a suspended context and never be heard.
		speakerActor.core.resumeAudio()
		this.draftError = ''
		this.active = true
		try {
			const delivery = chatActor.core.send(text)
			// submit() has synchronously taken ownership before the field is cleared.
			this.draft = ''
			void delivery.catch((error) => {
				chatActor.core.failure = String(error)
			})
		} catch {
			/* onInputRejected keeps the draft, including accepted speech. */
		}
	}
}

export const composer = singleton('aven.composer', () => new Composer())
chatActor.core.onInput = () => {
	composer.active = true
}
chatActor.core.onInputRejected = (text, error) => {
	if (composer.draft.trim() !== text.trim())
		composer.draft += `${composer.draft ? '\n' : ''}${text}`
	composer.draftError = error instanceof Error ? error.message : 'The message has not been sent.'
	composer.active = true
	composer.focusTick++
}
chatActor.core.onRoutingQuestion = (item) => {
	// Only the active input owns this narration. Ordinary answer narration remains in its Intent.
	speakerActor.core.feed(routingQuestion(item))
	speakerActor.core.flush()
}
