import { AsyncLocalStorage } from 'node:async_hooks'

/** Injected around Talk `executeMemoryTool` calls so vault edits can cite the triggering turn (`mN.md`). */
export type MemoryToolSource =
	| { type: 'talk'; messageTurn: number }
	| { type: 'memory_ui' }

export const memoryToolSourceAls = new AsyncLocalStorage<MemoryToolSource | undefined>()
