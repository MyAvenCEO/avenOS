/**
 * avenOS's UI layer: the brand styling and the vibes this product ships.
 *
 * The ENGINE is no longer here. It became `@myavenceo/aven-vibes`, a standalone
 * framework with no knowledge of any brand — which is what it always was, once
 * the two files that knew about avenCEO were separated from the 1,258 lines
 * that did not.
 *
 * What remains is the part that could never have shipped in a framework: the
 * brand tokens wired into a StyleDef, and the chat vibe. The engine is
 * re-exported so existing imports of `@avenos/aven-ui` keep resolving; new code
 * can take it from the package directly.
 */

export * from '@myavenceo/aven-vibes'
export { brandBaseSelectors, brandTokens, withBrand } from './brand-style.js'
