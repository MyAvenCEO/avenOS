import { bus } from './bus'
import { registryActor } from './chat.actor.svelte'
import DefaultActorView from './DefaultActorView.svelte'
import { registryTick } from './reactivity.svelte'
import { singleton } from './singleton'
import WorkItemsView from './WorkItemsView.svelte'
import { isWindow, WindowActor } from './window.actor.svelte'
import { workItems } from './workitems.svelte'

/**
 * The windows — views as actors, one per subject, colocated here and
 * registered like everyone else. The Views surface derives from the
 * registry; the model can toggle any of these by message.
 *
 * Actors spoken into existence get a window too: the generic face renders
 * identity, contract, live state and the interview until someone paints a
 * real one. The registry's hooks keep windows in step with create, update
 * and delete — and rehydrated actors are announced after the hooks exist.
 */
export const listeWindow = singleton(
	'aven.window.liste',
	() =>
		new WindowActor(workItems, WorkItemsView, {
			key: 'liste',
			name: 'Aufgaben-Liste',
			props: { mode: 'list' }
		})
)
export const boardWindow = singleton(
	'aven.window.board',
	() =>
		new WindowActor(workItems, WorkItemsView, {
			key: 'board',
			name: 'Kanban-Board',
			props: { mode: 'board' },
			open: false
		})
)
// The board and the list are two FACES of the same subject — each its own
// window actor, switched like any other ("zeig das Board"). The combined
// workitems-window from before this split may linger on the HMR-surviving
// bus; clear it so it cannot shadow the pair.
bus.unregister('workitems-window')
bus.register(listeWindow)
bus.register(boardWindow)

bus.onChange = () => {
	registryTick.v++
}

/** Windows whose actor was just removed while shown — updates keep the stage. */
const stagedRemovals = new Set<string>()

registryActor.onCreated = (actor, fresh) => {
	const windowId = `${actor.manifest.id}-window`
	if (bus.get(windowId)) return
	// Freshly spoken actors take the stage (their window opens and the others
	// close — the single-active rule); rehydrated ones wait quietly. An update
	// (remove + recreate) keeps whatever stage state the window had.
	const staged = stagedRemovals.delete(windowId)
	const open = fresh || staged
	const window = new WindowActor(actor, DefaultActorView, { open })
	if (open) {
		for (const other of bus.actors()) {
			if (isWindow(other)) other.open = false
		}
	}
	bus.register(window)
}
registryActor.onRemoved = (id) => {
	const windowId = `${id}-window`
	const window = bus.get(windowId)
	if (window && isWindow(window) && window.open) stagedRemovals.add(windowId)
	bus.unregister(windowId)
}
registryActor.announceExisting()

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
