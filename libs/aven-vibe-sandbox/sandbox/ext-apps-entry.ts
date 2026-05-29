/**
 * Entry that re-exports the public surface vibe apps need from
 * `@modelcontextprotocol/ext-apps`. `bun build` bundles this into a
 * single self-contained ESM file at `sandbox/dist/ext-apps.js` that
 * each vibe app loads via `<script type="module">` from the sandbox
 * origin (no per-app bundler needed).
 */
export { App } from '@modelcontextprotocol/ext-apps'
