#!/usr/bin/env bun
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * Serves `sandbox/dist/sandbox.html` with CSP from `?csp=` (tamper-proof header).
 * Run `bun run build` from this package first. Default port 8081, override with
 * `SANDBOX_PORT`.
 */
import type { McpUiResourceCsp } from '@modelcontextprotocol/ext-apps'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT ?? '8081', 10)
const DIRECTORY = join(__dirname, 'dist')
const SANDBOX_FILE = Bun.file(join(DIRECTORY, 'sandbox.html'))
const EXT_APPS_FILE = Bun.file(join(DIRECTORY, 'ext-apps.js'))

function sanitizeCspDomains(domains?: string[]): string[] {
	if (!domains) return []
	return domains.filter((d) => typeof d === 'string' && !/[;\r\n'" ]/.test(d))
}

function buildCspHeader(csp?: McpUiResourceCsp): string {
	const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(' ')
	const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(' ')
	const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(' ') || null
	const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(' ') || null

	const directives = [
		"default-src 'self' 'unsafe-inline'",
		`script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
		`style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
		`img-src 'self' data: blob: ${resourceDomains}`.trim(),
		`font-src 'self' data: blob: ${resourceDomains}`.trim(),
		`media-src 'self' data: blob: ${resourceDomains}`.trim(),
		`connect-src 'self' ${connectDomains}`.trim(),
		`worker-src 'self' blob: ${resourceDomains}`.trim(),
		frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
		"object-src 'none'",
		// Allow <base href> in inner iframe HTML (host injects sandbox origin for document.write docs).
		baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'self'"
	]

	return directives.join('; ')
}

Bun.serve({
	port: SANDBOX_PORT,
	async fetch(req) {
		if (!(await SANDBOX_FILE.exists())) {
			return new Response(
				'Run `bun run build` (in @avenos/vibe-app-sandbox) first — missing sandbox/dist/sandbox.html.',
				{ status: 503 }
			)
		}

		const url = new URL(req.url)

		// Vendored MCP App SDK — vibe apps `import 'http://.../ext-apps.js'` to
		// stay pure HTML/CSS/JS without a per-app bundler.
		if (url.pathname === '/ext-apps.js') {
			if (!(await EXT_APPS_FILE.exists())) {
				return new Response(
					'Run `bun run build:ext-apps` (in @avenos/vibe-app-sandbox) — missing sandbox/dist/ext-apps.js.',
					{ status: 503 }
				)
			}
			return new Response(EXT_APPS_FILE, {
				headers: {
					'Content-Type': 'text/javascript; charset=utf-8',
					'Cache-Control': 'public, max-age=31536000, immutable',
					// Allow same-origin loading from the inner iframe.
					'Access-Control-Allow-Origin': '*'
				}
			})
		}

		if (url.pathname !== '/' && url.pathname !== '/sandbox.html') {
			return new Response('Only sandbox.html and ext-apps.js are served on this port.', {
				status: 404
			})
		}

		let cspConfig: McpUiResourceCsp | undefined
		const cspParam = url.searchParams.get('csp')
		if (cspParam) {
			try {
				cspConfig = JSON.parse(cspParam) as McpUiResourceCsp
			} catch (e) {
				console.warn('[vibe-app-sandbox] Invalid CSP query param:', e)
			}
		}

		const cspHeader = buildCspHeader(cspConfig)

		return new Response(SANDBOX_FILE, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': cspHeader,
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				Pragma: 'no-cache',
				Expires: '0'
			}
		})
	}
})

console.log(`[vibe-app-sandbox] serving http://localhost:${SANDBOX_PORT}/sandbox.html`)
