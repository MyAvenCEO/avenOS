import { bus } from './bus'
import { singleton } from './singleton'
import WorkItemsView from './WorkItemsView.svelte'
import { WindowActor } from './window.actor.svelte'
import { workItems } from './workitems.svelte'

/**
 * The windows — views as actors, one per subject, colocated here and
 * registered like everyone else. The Views surface derives from the
 * registry; the model can toggle any of these by message.
 */
export const workItemsWindow = singleton(
	'aven.window.workitems',
	() => new WindowActor(workItems, WorkItemsView)
)
bus.register(workItemsWindow)

/** Imported for its side effects by the shell. */
export const windowsBound = true
