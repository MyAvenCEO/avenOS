import { Actor } from './actor'

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
export class WindowActor extends Actor {
	open = $state(true)
	readonly subject: Actor
	/** The Svelte component painting this window; receives { actor: subject }. */
	readonly component: unknown

	constructor(subject: Actor, component: unknown) {
		const id = `${subject.manifest.id}-window`
		super({
			id,
			name: `${subject.manifest.name} Fenster`,
			description:
				`Das Fenster von ${subject.manifest.name}: rendert dessen Zustand als ` +
				'bedienbare Oberfläche. Ein- und ausblendbar per Nachricht.',
			tags: ['window'],
			// The window consumes what its subject produces — that IS the
			// relation, and the graph draws it without anyone wiring it.
			requires: [...subject.produces],
			produces: [],
			methods: [
				{
					name: `${subject.manifest.id}_window_toggle`,
					description:
						`Blendet das ${subject.manifest.name}-Fenster auf dem Views-Tab ein oder aus. ` +
						'Ohne Argument wird umgeschaltet.',
					parameters: {
						type: 'object',
						properties: {
							open: { type: 'boolean', description: 'true = einblenden, false = ausblenden.' }
						}
					}
				}
			]
		})
		this.subject = subject
		this.component = component
		this.bind({
			[`${subject.manifest.id}_window_toggle`]: (p) => {
				this.open = typeof p.open === 'boolean' ? p.open : !this.open
				return {
					record: JSON.stringify({ ok: true, window: id, open: this.open }),
					wire: `Das Fenster ist jetzt ${this.open ? 'eingeblendet' : 'ausgeblendet'}.`
				}
			}
		})
	}

	override instanceState(): Record<string, unknown> {
		return {
			Zustand: this.open ? 'eingeblendet' : 'ausgeblendet',
			Subjekt: this.subject.manifest.id
		}
	}

	protected override situation(): string {
		return `${this.open ? 'Eingeblendet' : 'Ausgeblendet'}; zeigt den Zustand von ${this.subject.manifest.name}.`
	}
}

/** Duck-typed check that survives HMR generations (instanceof would not). */
export function isWindow(actor: Actor): actor is WindowActor {
	return actor.manifest.tags.includes('window') && 'component' in actor
}
