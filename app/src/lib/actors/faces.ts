import WorkItemsView from './WorkItemsView.svelte'
import { workItems } from './workitems.svelte'

/**
 * The face bindings — Abject's "every object paints its own window", locally.
 * A face is a Svelte component taking { actor }; binding it here (next to the
 * actors, importable by the shell) keeps component and actor colocated
 * without a module cycle. The Views surface derives from the registry: an
 * actor with a face appears, one without doesn't — nothing is listed twice.
 */
workItems.face = WorkItemsView

/** Imported for its side effects by the shell. */
export const facesBound = true
