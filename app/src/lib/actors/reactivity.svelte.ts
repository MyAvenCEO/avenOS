/**
 * The one reactive crumb the plain-TS bus leaves for Svelte: a version that
 * bumps when the registry changes, so derived lists (Views, the explorer
 * nav, the graph) re-render when an actor is spoken into existence or
 * removed. The bus itself stays rune-free and testable under bun.
 */
export const registryTick = $state({ v: 0 })
