import { bus } from './bus'
import ComposerView from './ComposerView.svelte'
import { composerActor, registryActor } from './chat.actor.svelte'
import { clearRecords } from './created.actor.svelte'
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
 * Actors spoken into existence get a window too: the generic face renders
 * identity, contract, live state and the interview until someone paints a
 * real one. The registry's hooks keep windows in step with create, update
 * and delete — and rehydrated actors are announced after the hooks exist.
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
// window actor, switched like any other ("zeig das Board"). The combined
// workitems-window from before this split may linger on the HMR-surviving
// bus; clear it so it cannot shadow the pair.
export const composerWindow = singleton(
	'aven.window.composer',
	() =>
		new WindowActor(composerActor, ComposerView, {
			key: 'composer',
			name: 'Composer',
			open: false
		})
)
// The flow face takes the stage the moment a draft starts — creating an
// actor is something you WATCH, not a silent tool call.
composerActor.onStage = () => {
	for (const other of bus.actors()) {
		if (isWindow(other)) other.open = false
	}
	composerWindow.open = true
}
bus.unregister('workitems-window')
bus.register(listWindow)
bus.register(boardWindow)
bus.register(composerWindow)

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
	// A declared face gets the universal renderer — the composed mini app;
	// actors without one keep the generic face.
	const component = actor.manifest.face ? SpecFaceView : DefaultActorView
	const window = new WindowActor(actor, component, { open })
	if (open) {
		for (const other of bus.actors()) {
			if (isWindow(other)) other.open = false
		}
	}
	bus.register(window)
	// Named extra views: one more window per declared face, all sharing this
	// actor — the workitems list/board pattern, driven by data.
	for (const named of actor.manifest.faces ?? []) {
		const namedId = `${actor.manifest.id}-${named.key}-window`
		if (!bus.get(namedId)) {
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
registryActor.onRemoved = (id) => {
	const windowId = `${id}-window`
	const window = bus.get(windowId)
	if (window && isWindow(window) && window.open) stagedRemovals.add(windowId)
	// Every window whose subject this is goes with it — the default one AND
	// all named views.
	for (const w of bus.actors()) {
		if (isWindow(w) && w.subject.manifest.id === id) bus.unregister(w.manifest.id)
	}
}
registryActor.onDeleted = (id) => {
	clearRecords(id)
}
registryActor.announceExisting()

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
