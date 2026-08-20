/**
 * avenCITY — the third world.
 *
 * Ported from the standalone avenCITY repo (raw three.js + SvelteKit) into this
 * monorepo lib. What was an app with routes is now two components: the world,
 * and the biome sandbox it can swap to. Everything below `src/` is the original
 * source, with `$lib/` aliases rewritten to relative paths.
 *
 * `AvenCityGame` is the whole world — it renders full-screen and owns its own
 * three.js scene, so mount it as a leaf, not inside app chrome.
 */
export { default as AvenCityGame } from './AvenCityGame.svelte'
export { default as AvenCitySandbox } from './AvenCitySandbox.svelte'
export type { BiomeId, HexTile } from './game/hexmap'
export { BIOME_IDS, BIOME_RESOURCES, tileResources } from './game/hexmap'
export { timeOfDay } from './game/timeOfDay.svelte'
