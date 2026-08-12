import { bus } from './bus'
import { catalogActors } from './chat.actor.svelte'
import DefaultActorView from './DefaultActorView.svelte'
import { registryTick } from './reactivity.svelte'
import SpecFaceView from './SpecFaceView.svelte'
import { singleton } from './singleton'
import WorkItemsView from './WorkItemsView.svelte'
import { isWindow, WindowActor } from './window.actor.svelte'
import { workItems } from './workitems.svelte'

/**
 * The windows — views as actors, one per subject, colocated here and
 * registered like everyone else. The Views surface derives from the
 * registry; the model can toggle any of these by message.
 *
 * Catalog actors get their windows here too: the declared face goes to the
 * universal renderer, extra named faces become their own switchable windows
 * over the SAME actor, and an actor without a face keeps the generic one.
 * All of it follows from code — nothing is created at runtime.
 */
export const listWindow = singleton(
	'aven.window.list',
	() =>
		new WindowActor(workItems, WorkItemsView, {
			key: 'list',
			name: 'Task List',
			props: { mode: 'list' }
		})
)
export const boardWindow = singleton(
	'aven.window.board',
	() =>
		new WindowActor(workItems, WorkItemsView, {
			key: 'board',
			name: 'Kanban Board',
			props: { mode: 'board' },
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

// One window per catalog actor, plus one per extra named face. Closed on
// boot: the stage belongs to whoever the user asks for.
for (const actor of catalogActors) {
	const component = actor.manifest.face ? SpecFaceView : DefaultActorView
	if (!bus.get(`${actor.manifest.id}-window`)) {
		bus.register(new WindowActor(actor, component, { open: false }))
	}
	for (const named of actor.manifest.faces ?? []) {
		const id = `${actor.manifest.id}-${named.key}-window`
		if (!bus.get(id)) {
			bus.register(
				new WindowActor(actor, SpecFaceView, {
					key: `${actor.manifest.id}-${named.key}`,
					name: named.name,
					props: { spec: named.spec },
					open: false
				})
			)
		}
	}
}

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
