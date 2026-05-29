#!/usr/bin/env bun
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * Serves `sandbox/dist/sandbox.html` with CSP from `?csp=` (tamper-proof header).
 * Run `bun run build` from this package first.
 *
 * Port resolution (first match wins):
 * 1. `VIBE_SANDBOX_PORT` — preferred for this package (avoids clashing with generic `PORT`).
 * 2. `PORT` — common hosting convention (e.g. PaaS).
 * 3. Default **8081** if both are unset.
 *
 * Value must be an integer in **1–65535**.
 *
 * Dev-only retry: if `VIBE_SANDBOX_PORT` is **unset**, `PORT` is **unset**, and
 * `NODE_ENV !== 'production'`, bind attempts **8081–8086** until one is free (helps stale
 * processes). With an explicit env port, a conflict exits with a clear hint.
 */
import type { McpUiResourceCsp } from '@modelcontextprotocol/ext-apps'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIRECTORY = join(__dirname, 'dist')
const SANDBOX_FILE = Bun.file(join(DIRECTORY, 'sandbox.html'))
const EXT_APPS_FILE = Bun.file(join(DIRECTORY, 'ext-apps.js'))

function parseListenPort(raw: string): number {
	const n = Number.parseInt(raw.trim(), 10)
	if (!Number.isFinite(n) || n !== Math.floor(n) || n < 1 || n > 65535) {
		throw new Error(
			`Invalid sandbox listen port: ${JSON.stringify(raw)} (expected integer 1–65535)`
		)
	}
	return n
}

function resolvePortCandidates(): number[] {
	const vibeRaw = process.env.VIBE_SANDBOX_PORT
	const portRaw = process.env.PORT
	const vibeSet = vibeRaw != null && vibeRaw !== ''
	const portSet = portRaw != null && portRaw !== ''

	if (vibeSet) return [parseListenPort(vibeRaw)]
	if (portSet) return [parseListenPort(portRaw)]

	const devRetry = process.env.NODE_ENV !== 'production'
	return devRetry ? [8081, 8082, 8083, 8084, 8085, 8086] : [8081]
}

function isAddrInUse(err: unknown): boolean {
	return (
		typeof err === 'object' &&
		err !== null &&
		'code' in err &&
		(err as NodeJS.ErrnoException).code === 'EADDRINUSE'
	)
}

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

async function handleFetch(req: Request): Promise<Response> {
	if (!(await SANDBOX_FILE.exists())) {
		return new Response(
			'Run `bun run build` (in @avenos/vibe-app-sandbox) first — missing sandbox/dist/sandbox.html.',
			{ status: 503 }
		)
	}

	const url = new URL(req.url)

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
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin'
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
			Expires: '0',
			'Cross-Origin-Resource-Policy': 'cross-origin'
		}
	})
}

const candidates = resolvePortCandidates()
let server: ReturnType<typeof Bun.serve> | undefined

for (let i = 0; i < candidates.length; i++) {
	const port = candidates[i]
	try {
		server = Bun.serve({ port, fetch: handleFetch })
		break
	} catch (err) {
		const retrying = i < candidates.length - 1 && isAddrInUse(err)
		if (retrying) {
			console.warn(`[vibe-app-sandbox] Port ${port} in use, trying next…`)
			continue
		}
		if (isAddrInUse(err)) {
			const alt = port >= 65535 ? port - 1 : port + 1
			console.error(
				`[vibe-app-sandbox] Port ${port} in use — set VIBE_SANDBOX_PORT=${alt} in repo root .env and restart; update PUBLIC_VIBE_SANDBOX_URL for app if needed.`
			)
		}
		throw err
	}
}

if (!server) throw new Error('[vibe-app-sandbox] Failed to bind (no server)')

const chosen = server.port
const isNonDefault = chosen !== 8081
if (isNonDefault) {
	console.log(
		`\n[vibe-app-sandbox] LISTENING ON PORT ${chosen} — set PUBLIC_VIBE_SANDBOX_URL=http://localhost:${chosen}/sandbox.html for app if the iframe fails to load.\n`
	)
}
console.log(`[vibe-app-sandbox] serving http://localhost:${chosen}/sandbox.html`)
