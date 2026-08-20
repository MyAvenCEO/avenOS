import { ConfigActor } from './config-actor.svelte'
import { singleton } from './singleton'
import { todoConfig } from './todo.config'

/**
 * The todo actor — now just an assembly line: a GENERIC actor over the todo
 * DATA config. No subclass, no domain methods; behaviour is the sandbox
 * (`todoConfig.logic`), flow is the machine (todo-machine.pl, injected), and
 * the manifest/tools/views are data. The whole "todo" lives in `todo.config`.
 */
export const todoActor = singleton('aven.todo', () => new ConfigActor(todoConfig))

// Re-exported so existing importers (the spark rail) keep one import site.
export { SPARKS, type Spark, type Todo, type TodoStatus } from './todo.config'
