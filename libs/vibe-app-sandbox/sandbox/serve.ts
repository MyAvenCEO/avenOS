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
		baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'"
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
		if (url.pathname !== '/' && url.pathname !== '/sandbox.html') {
			return new Response('Only sandbox.html is served on this port.', { status: 404 })
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
