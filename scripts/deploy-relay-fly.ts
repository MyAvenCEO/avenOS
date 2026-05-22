#!/usr/bin/env bun
/**
 * Deploy central P2P signal to Fly (`relay-aven-ceo`).
 *
 * Prereqs: `fly` CLI authenticated (`fly auth login`).
 *
 * Org: `FLY_ORG=<slug>` or auto-pick among orgs whose **slug or display name** matches
 * Aven/Maia City hints (`maicity`, `MaiaCity`, `maia-city`, …). Multiple hits:
 * **`SHARED`** type is preferred over **`PERSONAL`**.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIGNAL_PROJECT = path.join(ROOT, 'projects', 'aven-p2p-signal')
const FLY_TOML = path.join(SIGNAL_PROJECT, 'fly.toml')
const FLY_DOCKERFILE = path.join(SIGNAL_PROJECT, 'Dockerfile')
const APP = 'relay-aven-ceo'
const REGION = 'fra'
const VOL_NAME = 'p2p_signal_data'
const DOMAIN = 'relay.aven.ceo'

function flyExe(): string {
	return process.platform === 'win32' ? 'fly.cmd' : 'fly'
}

function run(args: string[], opts: { inherit?: boolean } = {}): string {
	const bin = flyExe()
	if (opts.inherit) {
		execFileSync(bin, args, { cwd: ROOT, stdio: 'inherit' })
		return ''
	}
	return execFileSync(bin, args, {
		cwd: ROOT,
		encoding: 'utf8'
	}).trim()
}

function tryRun(args: string[]): string {
	try {
		return execFileSync(flyExe(), args, {
			cwd: ROOT,
			encoding: 'utf8'
		}).trim()
	} catch {
		return ''
	}
}

/** `fly … --json` often wraps rows in `{ organizations: [...] }` rather than returning a bare array. */
function flyCliJsonRows(parsed: unknown, preferredKeys: string[]): Record<string, unknown>[] {
	if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
	if (parsed !== null && typeof parsed === 'object') {
		const o = parsed as Record<string, unknown>
		for (const k of preferredKeys) {
			const v = o[k]
			if (Array.isArray(v)) return v as Record<string, unknown>[]
		}
		// Fallback: first array-valued property whose elements look like records
		for (const v of Object.values(o)) {
			if (!Array.isArray(v) || v.length === 0) continue
			if (typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0])) {
				return v as Record<string, unknown>[]
			}
		}
	}
	return []
}

function orgSlugFromRow(r: Record<string, unknown>): string | undefined {
	const direct = r.slug ?? r.Slug
	if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
	// Nested `{ organization: { slug } }`
	const inner = r.organization ?? r.org ?? r.Organization
	if (inner !== null && typeof inner === 'object') {
		const s = (inner as Record<string, unknown>).slug ?? (inner as Record<string, unknown>).Slug
		if (typeof s === 'string' && s.trim().length > 0) return s.trim()
	}
	return undefined
}

type FlyOrgCandidate = {
	slug: string
	name: string
	type: string
}

/** Slug/display-name hints — Fly slugs rarely contain the substring "maicity" (often `maia-city` + labels like "Maia City"). */
const AVEN_ORG_HINT = /maicity|maiacity|maia[\s_-]*city|maia-city/i

function orgRowMatchesSlugOrName(slug: string, displayName: string): boolean {
	const blob = `${slug}\u0000${displayName}`
	return AVEN_ORG_HINT.test(blob)
}

function orgCandidatesFromJsonRows(rows: Record<string, unknown>[]): FlyOrgCandidate[] {
	const out: FlyOrgCandidate[] = []
	for (const r of rows) {
		const slug = orgSlugFromRow(r)?.trim()
		if (!slug) continue
		const name = String(r.name ?? r.Name ?? r.organizationName ?? r.Organization ?? '').trim()
		const type = String(r.type ?? r.Type ?? '')
			.trim()
			.toUpperCase()
		out.push({ slug, name, type })
	}
	return out
}

/** Parse plain `fly orgs list` table (columns Name / Slug / Type separated by two+ spaces). */
function orgCandidatesFromTextTable(text: string): FlyOrgCandidate[] {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	const out: FlyOrgCandidate[] = []
	for (const line of lines) {
		if (/^Name\b/i.test(line) || /^-+\s*-+/.test(line)) continue
		const parts = line
			.split(/\s{2,}/)
			.map((p) => p.trim())
			.filter(Boolean)
		if (parts.length < 2) continue
		const name = parts[0]
		const slug = parts[1]
		const type = (parts[2] ?? '').toUpperCase()
		out.push({ slug, name, type })
	}
	return out
}

function pickFlyOrgSlug(candidates: FlyOrgCandidate[], source: string): string {
	const matches = candidates.filter((c) => orgRowMatchesSlugOrName(c.slug, c.name))
	if (matches.length === 0) {
		const slugs = [...new Set(candidates.map((c) => c.slug))].sort().join(', ')
		throw new Error(
			`Could not infer Fly org (${source}). Matching slugs/names showed no Aven/Maia City hints. ` +
				`Run \`fly orgs list\` and export FLY_ORG=<slug>. Available slugs seen: ${slugs || '(none)'}`
		)
	}
	if (matches.length === 1) {
		console.log(`[deploy-relay-fly] org slug (${source} hint match)=${matches[0].slug}`)
		return matches[0].slug
	}

	const shared = matches.filter((c) => c.type === 'SHARED')
	if (shared.length === 1) {
		console.warn(
			`[deploy-relay-fly] Multiple org hints matched (${matches.map((m) => m.slug).join(', ')}); ` +
				`using SHARED workspace: ${shared[0].slug}`
		)
		return shared[0].slug
	}

	throw new Error(
		`Multiple Fly org rows match (${matches.map((m) => `${m.slug} (${m.type})`).join('; ')}). ` +
			`Set \`export FLY_ORG=<exact-slug>\` and re-run deploy.`
	)
}

function resolveOrgSlug(): string {
	const forced = process.env.FLY_ORG?.trim()
	if (forced) {
		console.log(`[deploy-relay-fly] FLY_ORG=${forced}`)
		return forced
	}
	const jsonAttempt = tryRun(['orgs', 'list', '--json'])
	if (jsonAttempt) {
		try {
			const parsed = JSON.parse(jsonAttempt) as unknown
			const rows = flyCliJsonRows(parsed, ['organizations', 'Organizations', 'orgs', 'Orgs'])
			const candidates = orgCandidatesFromJsonRows(rows)
			if (candidates.length > 0) {
				return pickFlyOrgSlug(candidates, 'JSON')
			}
		} catch (e) {
			if (!(e instanceof SyntaxError)) throw e
		}
	}
	const text = tryRun(['orgs', 'list'])
	if (!text) {
		execFileSync(flyExe(), ['orgs', 'list'], { cwd: ROOT, stdio: 'inherit' })
		throw new Error('Re-run deploy after inspecting fly orgs list; set FLY_ORG=<slug>')
	}
	const candidates = orgCandidatesFromTextTable(text)
	return pickFlyOrgSlug(candidates, 'text')
}

function appExists(): boolean {
	const out = tryRun(['apps', 'list', '--json'])
	if (out) {
		try {
			const apps = flyCliJsonRows(JSON.parse(out) as unknown, ['apps', 'Apps', 'applications'])
			return apps.some((a) => {
				const name = String(a.Name ?? a.name ?? a.appName ?? a.AppName ?? '')
				return name === APP
			})
		} catch {
			/* fall through */
		}
	}
	return tryRun(['apps', 'list']).includes(APP)
}

function ensureApp(org: string): void {
	if (appExists()) {
		console.log(`[deploy-relay-fly] app ${APP} exists`)
		return
	}
	console.log(`[deploy-relay-fly] creating app ${APP} (org=${org})`)
	try {
		run(['apps', 'create', APP, '--org', org], { inherit: true })
	} catch {
		console.log('[deploy-relay-fly] apps create failed (maybe already exists) — continuing')
	}
}

function hasVolumeInRegion(): boolean {
	const out = tryRun(['volumes', 'list', '-a', APP, '--json'])
	if (!out) return false
	try {
		const rows = flyCliJsonRows(JSON.parse(out) as unknown, ['volumes', 'Volumes'])
		return rows.some((v) => v.name === VOL_NAME && v.region === REGION)
	} catch {
		return false
	}
}

function ensureVolume(): void {
	if (hasVolumeInRegion()) {
		console.log(`[deploy-relay-fly] volume ${VOL_NAME}@${REGION} ok`)
		return
	}
	run(['volumes', 'create', VOL_NAME, '--region', REGION, '--size', '1', '-a', APP], {
		inherit: true
	})
}

function hasDedicatedV4(): boolean {
	const out = tryRun(['ips', 'list', '-a', APP, '--json'])
	if (!out) return false
	try {
		const rows = flyCliJsonRows(JSON.parse(out) as unknown, ['ips', 'IPs'])
		return rows.some((r) =>
			String(r.type ?? r.Type ?? r.kind ?? '')
				.toLowerCase()
				.includes('v4')
		)
	} catch {
		return /\d+\.\d+\.\d+\.\d+/.test(out)
	}
}

function ensureIpv4(): void {
	if (hasDedicatedV4()) {
		console.log('[deploy-relay-fly] IPv4 allocated')
		return
	}
	run(['ips', 'allocate-v4', '-a', APP], { inherit: true })
}

async function main() {
	process.chdir(ROOT)

	run(['version'], { inherit: true })
	run(['auth', 'whoami'], { inherit: true })

	const org = resolveOrgSlug()
	ensureApp(org)
	ensureVolume()
	ensureIpv4()

	// First arg = Docker build context (repo root) — Dockerfile COPY infra/ … and projects/.
	// Absolute --config/--dockerfile avoids Fly resolving relative to fly.toml dirname (double path segments).
	run(['deploy', ROOT, '--config', FLY_TOML, '--dockerfile', FLY_DOCKERFILE, '--wait-timeout', '5m'], {
		inherit: true
	})

	run(['scale', 'count', '1', '-a', APP], { inherit: true })
	run(['ips', 'list', '-a', APP], { inherit: true })

	console.log(`\nDNS:  A  relay.aven.ceo  →  <IPv4 from fly ips list>
Optional:  fly certs add ${DOMAIN} -a ${APP}
Verify:     curl -s https://${DOMAIN}/.well-known/aven-relay.json
Dev .env:   AVEN_RELAY=true  AVEN_RELAY_URL=${DOMAIN}\n`)

	try {
		execFileSync(flyExe(), ['certs', 'add', DOMAIN, '-a', APP], {
			cwd: ROOT,
			stdio: 'inherit'
		})
	} catch {
		console.log('[deploy-relay-fly] fly certs add failed — run manually')
	}
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})
