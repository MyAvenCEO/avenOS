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
export const workItemsWindow = singleton(
	'aven.window.workitems',
	() => new WindowActor(workItems, WorkItemsView)
)
bus.register(workItemsWindow)

bus.onChange = () => {
	registryTick.v++
}

registryActor.onCreated = (actor) => {
	const windowId = `${actor.manifest.id}-window`
	if (!bus.get(windowId)) bus.register(new WindowActor(actor, DefaultActorView))
}
registryActor.onRemoved = (id) => {
	bus.unregister(`${id}-window`)
}
registryActor.announceExisting()

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
