/**
 * avenOS's BRAND binding for vibes — and nothing else.
 *
 * The engine is `@myavenceo/aven-vibes`, a standalone framework with no
 * knowledge of any brand. The brand is `@myavenceo/aven-ceo`. What is left
 * here is the seam between them: the avenCEO palette wired into a `StyleDef`
 * the vibe engine can consume.
 *
 * It no longer re-exports the engine. It used to, so that older
 * `@avenos/aven-ui` imports kept resolving, and the result was two names for
 * one framework and a chat vibe that quietly forked. Every consumer now takes
 * the engine from `@myavenceo/aven-vibes` directly, so there is exactly one
 * import path for it in this repo.
 *
 * Where this goes next (upgrade plan P3): `brand-style.ts` is avenCEO data
 * expressed as code, so it belongs in `@myavenceo/aven-ceo` beside the tokens
 * it already reads from. When it moves, this package disappears entirely.
 */
export { brandBaseSelectors, brandTokens, withBrand } from './brand-style.js'
