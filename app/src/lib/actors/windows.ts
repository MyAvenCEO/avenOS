import AvenUiView from './AvenUiView.svelte'
import { bus } from './bus'
import { catalogActors, composerActor, negotiatorActor } from './chat.actor.svelte'
import { instanceWindows } from './instance-windows'
import { registryTick } from './reactivity.svelte'
import { singleton } from './singleton'
import { isWindow, WindowActor } from './window.actor.svelte'
import { workItems } from './workitems.svelte'

/**
 * The windows — views as actors, one per subject, colocated here and
 * registered like everyone else. The Views surface derives from the
 * registry; the model can toggle any of these by message.
 *
 * Catalog actors get their windows here too: the declared view goes to the
 * universal renderer, extra named views become their own switchable windows
 * over the SAME actor, and an actor without a view keeps the generic one.
 * All of it follows from code — nothing is created at runtime.
 */
export const listWindow = singleton(
	'aven.window.list',
	() =>
		new WindowActor(workItems, AvenUiView, {
			key: 'list',
			name: 'Project List'
		})
)
export const boardWindow = singleton(
	'aven.window.board',
	() =>
		new WindowActor(workItems, AvenUiView, {
			key: 'board',
			name: 'Kanban Board',
			props: { view: workItems.manifest.views?.[0]?.view },
			open: false
		})
)
// The board and the list are two FACES of the same subject — each its own
// window actor, switched like any other ("show the board"). The combined
// workitems-window from before this split may linger on the HMR-surviving
// bus; clear it so it cannot shadow the pair.
bus.unregister('workitems-window')
bus.register(listWindow)
bus.register(boardWindow)

bus.onChange = () => {
	registryTick.v++
}

// One window per catalog actor, plus one per extra named view. Closed on
// boot: the stage belongs to whoever the user asks for.
for (const actor of catalogActors) {
	if (!bus.get(`${actor.manifest.id}-window`)) {
		bus.register(new WindowActor(actor, AvenUiView, { open: false }))
	}
	for (const named of actor.manifest.views ?? []) {
		const id = `${actor.manifest.id}-${named.key}-window`
		if (!bus.get(id)) {
			bus.register(
				new WindowActor(actor, AvenUiView, {
					key: `${actor.manifest.id}-${named.key}`,
					name: named.name,
					props: { view: named.view, style: named.style },
					open: false
				})
			)
		}
	}
}

// The negotiator paints its own review gate — a window like any other.
export const negotiatorWindow = singleton(
	'aven.window.negotiator',
	() =>
		new WindowActor(negotiatorActor, AvenUiView, {
			key: 'negotiator',
			name: 'Negotiator',
			open: false
		})
)
bus.register(negotiatorWindow)

// The composer (0135) paints its whole process — goal, proofs, interviews,
// the staged draft with its buttons — as its own window.
export const composerWindow = singleton(
	'aven.window.composer',
	() =>
		new WindowActor(composerActor, AvenUiView, {
			key: 'composer',
			name: 'Composer',
			open: false
		})
)
bus.register(composerWindow)

// Spawned instances get their windows the moment they exist — same views,
// their own state; dispose takes the windows with it (0133). The first
// window opens: a spoken "make me a second list" should be SEEN.
bus.onSpawned = (actor) => {
	instanceWindows(actor.manifest, actor.instanceName).forEach((w, i) => {
		if (bus.get(`${w.key}-window`)) return
		const window = new WindowActor(actor, AvenUiView, {
			key: w.key,
			name: w.name,
			props: { view: w.view, style: w.style },
			open: i === 0
		})
		if (i === 0) {
			for (const other of bus.actors()) {
				if (isWindow(other)) other.open = false
			}
		}
		bus.register(window)
	})
}
bus.onDisposed = (actor) => {
	for (const w of bus.actors()) {
		if (isWindow(w) && w.subject === actor) bus.unregister(w.manifest.id)
	}
}

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
