#!/usr/bin/env bun
/**
 * Render the design-system page from the configs, with aven-ui.
 *
 *   bun run design:render
 *
 * This is the architecture running end to end on its own documentation:
 *
 *   aven-ceo (config)  ->  aven-ui (render)  ->  CSS + HTML  ->  a static file
 *
 * The page is a `ViewDef` exported by the brand package, walked by the same
 * string renderer the marketing site will prerender through. Nothing about the
 * page is hand-written HTML — which is the point, because a hand-written
 * showcase drifts from the system the moment someone adds a component and
 * forgets to add a demo.
 *
 * It doubles as the renderer's hardest test. This is the largest view in either
 * repo, so if `renderViewToString` cannot carry a real page it fails here, on
 * something nobody ships, rather than on the website.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViewDef } from '@avenos/aven-ui'
import { renderViewToString } from '@avenos/aven-ui'
import { componentCss, themeCss } from '@myavenceo/aven-ceo/generate'
import { kitchenSinkCss, kitchenSinkView } from '@myavenceo/aven-ceo/kitchen-sink'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The page belongs to the BRAND package, not to any app that consumes it.
 *
 * It briefly landed in `app/static/`, which was convenient — the dev server
 * would serve it — and wrong: the Mac app would then ship a copy of the design
 * system, and there would be two places to look. The kitchen sink is the single
 * source for all of this, so it is written where the definitions live.
 *
 * The RENDERING happens here because this is where aven-ui is; the ARTIFACT
 * belongs next to the configs it documents. `AVEN_CEO_PATH` overrides the
 * location for a checkout that is not the sibling default.
 */
const brandRepo = process.env.AVEN_CEO_PATH ?? path.resolve(repoRoot, '../../../../avenCEO')
const out = path.join(brandRepo, 'packages/aven-ceo/kitchen-sink.html')

/**
 * Values in the view are literals, so the evaluator passes them through.
 *
 * A live surface supplies the engine's real evaluator here, which resolves
 * `{state.x}` against its state. The page has no state — it IS the config — so
 * identity is the honest evaluator for it.
 */
const evaluate = (expression: unknown) => expression

const body = await renderViewToString(kitchenSinkView() as ViewDef, {}, { evaluate })

/* Three stylesheets, all generated: the tokens, the shared components and
   primitives, and the page's own furniture. No stylesheet is authored. */
const html = `<!doctype html>
<meta charset="utf-8">
<title>Design system — @myavenceo/aven-ceo</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..800&display=swap" rel="stylesheet">
<style>
${themeCss('plain')}
${componentCss()}
${kitchenSinkCss()}
body { font-family: var(--font-sans); background: var(--color-linen); color: var(--color-ink); margin: 0; -webkit-font-smoothing: antialiased; }
</style>
${body}
`

writeFileSync(out, html)
console.log(`kitchen sink -> ${out} (${Math.round(html.length / 1024)} KB)`)
