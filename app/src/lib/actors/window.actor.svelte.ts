import { Actor } from './actor'
import { bus } from './bus'

/**
 * A window is an actor too — the Abject Canvas idea taken literally. The
 * view is not a property hanging off its subject; it is its own citizen of
 * the registry: it has a manifest (so the explorer explains it and ask()
 * interviews it), a contract (it REQUIRES what its subject PRODUCES, so the
 * graph shows the subject feeding its window), instance state (open or
 * not), and a method — which means the model can open and close windows the
 * same way it does everything else: by message.
 *
 * The Views surface derives from the registry: every open window renders
 * its component over its subject's state. Nothing is listed by hand.
 */
export interface WindowFace {
	/** Window identity; defaults to the subject id. Two faces over one subject differ here. */
	key?: string
	/** Display name; defaults to "<subject> Fenster". */
	name?: string
	/** Extra props for the component beside { actor } — e.g. which mode to render. */
	props?: Record<string, unknown>
	open?: boolean
}

export class WindowActor extends Actor {
	open = $state(true)
	readonly subject: Actor
	/** The Svelte component painting this window; receives { actor: subject, ...props }. */
	readonly component: unknown
	readonly props: Record<string, unknown>

	constructor(subject: Actor, component: unknown, face: WindowFace = {}) {
		const key = face.key ?? subject.manifest.id
		const id = `${key}-window`
		const name = face.name ?? `${subject.manifest.name} Window`
		super({
			id,
			name,
			description:
				`The "${name}" window of ${subject.manifest.name}: renders its state as an ` +
				'operable surface. Shown and hidden by message.',
			tags: ['window'],
			// The window consumes what its subject produces — that IS the
			// relation, and the graph draws it without anyone wiring it.
			requires: [...subject.produces],
			produces: [],
			methods: [
				{
					name: `${key}_window_toggle`,
					description:
						`Shows "${name}" on the Views tab (open=true) or hides it. ` +
						'Without an argument it toggles.',
					parameters: {
						type: 'object',
						properties: {
							open: { type: 'boolean', description: 'true = show, false = hide.' }
						}
					}
				}
			]
		})
		this.subject = subject
		this.component = component
		this.props = face.props ?? {}
		this.open = face.open ?? true
		this.bind({
			[`${key}_window_toggle`]: (p) => {
				this.open = typeof p.open === 'boolean' ? p.open : !this.open
				// One face at a time, like a window manager showing one screen:
				// opening this window closes every other. "Zeig mir den Kalender"
				// REPLACES the Aufgaben, it does not stack beside them.
				if (this.open) {
					for (const other of bus.actors()) {
						if (other !== this && isWindow(other)) other.open = false
					}
				}
				return {
					record: JSON.stringify({ ok: true, window: id, open: this.open }),
					wire: this.open ? `${name} is now on screen.` : `"${name}" is hidden.`
				}
			}
		})
	}

	override instanceState(): Record<string, unknown> {
		return {
			state: this.open ? 'shown' : 'hidden',
			subject: this.subject.manifest.id
		}
	}

	protected override situation(): string {
		return `${this.open ? 'Shown' : 'Hidden'}; renders the state of ${this.subject.manifest.name}.`
	}
}

/** Duck-typed check that survives HMR generations (instanceof would not). */
export function isWindow(actor: Actor): actor is WindowActor {
	return actor.manifest.tags.includes('window') && 'component' in actor
}
