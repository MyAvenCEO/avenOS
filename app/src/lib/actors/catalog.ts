import type { Manifest } from './actor'

/**
 * The catalog: every future data-declared actor lives HERE, in code — the
 * single source of truth (0130). An entry is a manifest whose face is a
 * `vibe` (view/style/logic as validated JSON + sandboxed program); the boot
 * wiring registers it and the windows layer gives every vibe its window.
 *
 * Deliberately empty right now: the essentials — workitems (todos), the
 * registry, the llm lane and the speech/chat actors — are full classes with
 * their own state and are constructed directly. The calendar/habits/notes
 * demo actors are gone; what returns here must arrive as a vibe.
 */
export const catalog: Manifest[] = []
