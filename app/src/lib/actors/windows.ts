import AvenUiView from './AvenUiView.svelte'
import { bus } from './bus'
import { chatActor } from './chat.actor.svelte'
import { ConfigActor } from './config-actor.svelte'
import { inboxConfig } from './inbox.config'
import { registryTick } from './reactivity.svelte'
import { singleton } from './singleton'
import { todoActor } from './todo.svelte'
import { isWindow, WindowActor } from './window.actor.svelte'

/** The inbox — declared + mocked (0153): a generic actor over its config. */
export const inboxActor = singleton('aven.inbox', () => new ConfigActor(inboxConfig))
bus.register(inboxActor)

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
		new WindowActor(todoActor, AvenUiView, {
			key: 'list',
			name: 'Todos'
		})
)
export const boardWindow = singleton(
	'aven.window.board',
	() =>
		new WindowActor(todoActor, AvenUiView, {
			key: 'board',
			name: 'Kanban Board',
			props: { view: todoActor.manifest.views?.[0]?.view },
			open: false
		})
)
/**
 * The conversation as a window too (no bespoke tab needed to SEE it): the
 * transcript rendered by the universal engine over the chat actor's state.
 * The voice pill stays the input; this is the view.
 */
export const chatWindow = singleton(
	'aven.window.chat',
	() =>
		new WindowActor(chatActor, AvenUiView, {
			key: 'chat',
			name: 'Chat',
			open: false
		})
)
// The board and the list are two FACES of the same subject — each its own
// window actor, switched like any other ("show the board"). The combined
// todos-window from before this split may linger on the HMR-surviving
// bus; clear it so it cannot shadow the pair.
export const inboxWindow = singleton(
	'aven.window.inbox',
	() =>
		new WindowActor(inboxActor, AvenUiView, {
			key: 'inbox',
			name: 'Inbox',
			open: false
		})
)
bus.unregister('todos-window')
bus.register(listWindow)
bus.register(boardWindow)
bus.register(chatWindow)
bus.register(inboxWindow)

bus.onChange = () => {
	registryTick.v++
}

export { isWindow }

/** Imported for its side effects by the shell. */
export const windowsBound = true
