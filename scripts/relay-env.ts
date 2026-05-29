/**
 * AvenOS central blind-relay identity — repo-root env (mirrors genesis workflow).
 *
 * - `AVENOS_RELAY_SEED_HEX` — 32-byte Ed25519 seed (64 hex). Server + Fly secret. Never commit.
 * - `AVENOS_RELAY_PUBLIC_KEY_HEX` — blind-relay public key (64 hex). App Store compile embed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { readEnvFileValue } from './apple-env.ts'

export const RELAY_SEED_ENV = 'AVENOS_RELAY_SEED_HEX'
export const RELAY_PUBLIC_KEY_ENV = 'AVENOS_RELAY_PUBLIC_KEY_HEX'
export const PRODUCTION_RELAY_HOST = 'relay.aven.ceo'

const LEGACY_RELAY_SEED_NAME = 'relay-hyperdht.seed'

export function normalizeHex64(raw: string, label: string): string {
	const t = raw.trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(t)) {
		throw new Error(`${label}: expected 64 hex chars, got ${raw.trim().length}`)
	}
	return t
}

function resolveEnvValue(repoRoot: string, key: string): string | undefined {
	const fromShell = process.env[key]?.trim()
	if (fromShell) return fromShell

	const appleLocal = path.join(repoRoot, '.env.apple.local')
	const repoEnv = path.join(repoRoot, '.env')
	return readEnvFileValue(appleLocal, key) ?? readEnvFileValue(repoEnv, key)
}

export function resolveRelayPublicKeyHex(repoRoot: string): string | undefined {
	const v = resolveEnvValue(repoRoot, RELAY_PUBLIC_KEY_ENV)
	if (!v) return undefined
	return normalizeHex64(v, RELAY_PUBLIC_KEY_ENV)
}

export function resolveRelaySeedHex(repoRoot: string): string | undefined {
	const v = resolveEnvValue(repoRoot, RELAY_SEED_ENV)
	if (!v) return undefined
	return normalizeHex64(v, RELAY_SEED_ENV)
}

export function requireRelayPublicKeyHex(repoRoot: string, label: string): string {
	const v = resolveRelayPublicKeyHex(repoRoot)
	if (!v) {
		console.error(
			`${label}: missing ${RELAY_PUBLIC_KEY_ENV} — run \`bun run migrate:relay-env\` or set in repo .env`,
		)
		process.exit(1)
	}
	return v
}

export function requireRelaySeedHex(repoRoot: string, label: string): string {
	const v = resolveRelaySeedHex(repoRoot)
	if (!v) {
		console.error(
			`${label}: missing ${RELAY_SEED_ENV} — run \`bun run migrate:relay-env\` or set in repo .env`,
		)
		process.exit(1)
	}
	return v
}

/** Legacy on-disk seed paths (repo dev + infra relay subtree). */
export function findLegacyRelaySeedFiles(repoRoot: string): string[] {
	const candidates = [path.join(repoRoot, '.avenOS', 'dev', 'p2p-signal', LEGACY_RELAY_SEED_NAME)]
	const keysDir = process.env.AVENOS_P2P_SIGNAL_KEYS_DIR?.trim()
	if (keysDir) {
		candidates.unshift(path.join(keysDir, LEGACY_RELAY_SEED_NAME))
	}
	return candidates.filter((p) => existsSync(p))
}

export function readLegacyRelaySeedHex(filePath: string): string {
	const bytes = readFileSync(filePath)
	if (bytes.length !== 32) {
		throw new Error(`${filePath}: expected 32-byte seed, got ${bytes.length} bytes`)
	}
	return normalizeHex64(bytes.toString('hex'), LEGACY_RELAY_SEED_NAME)
}

export function deriveRelayPublicKeyHexFromSeed(repoRoot: string, seedHex: string): string {
	const manifest = path.join(repoRoot, 'libs', 'aven-relay', 'Cargo.toml')
	const pk = execFileSync(
		'cargo',
		['run', '-q', `--manifest-path=${manifest}`, '--', '--derive-relay-public-key'],
		{
			cwd: repoRoot,
			env: { ...process.env, [RELAY_SEED_ENV]: seedHex },
			encoding: 'utf8',
		},
	).trim()
	return normalizeHex64(pk, RELAY_PUBLIC_KEY_ENV)
}

export async function fetchProductionRelayPublicKeyHex(
	host = PRODUCTION_RELAY_HOST,
): Promise<string | undefined> {
	try {
		const res = await fetch(`https://${host}/.well-known/aven-relay.json`)
		if (!res.ok) return undefined
		const j = (await res.json()) as { relayPublicKeyHex?: string }
		if (typeof j.relayPublicKeyHex !== 'string' || j.relayPublicKeyHex.trim().length !== 64) {
			return undefined
		}
		return normalizeHex64(j.relayPublicKeyHex, 'relay manifest')
	} catch {
		return undefined
	}
}

function upsertEnvLines(raw: string, entries: Record<string, string>): string {
	const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
	const seen = new Set<string>()

	const out = lines.map((line) => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return line
		const eq = trimmed.indexOf('=')
		if (eq < 1) return line
		const key = trimmed.slice(0, eq).trim()
		if (!(key in entries)) return line
		seen.add(key)
		return `${key}="${entries[key]}"`
	})

	for (const [key, value] of Object.entries(entries)) {
		if (!seen.has(key)) out.push(`${key}="${value}"`)
	}

	return out.join('\n').replace(/\n?$/, '\n')
}

export function writeRelayEnvToDotEnv(
	repoRoot: string,
	seedHex: string,
	publicKeyHex: string,
): void {
	const envPath = path.join(repoRoot, '.env')
	const prev = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
	const next = upsertEnvLines(prev, {
		[RELAY_SEED_ENV]: seedHex,
		[RELAY_PUBLIC_KEY_ENV]: publicKeyHex,
	})
	writeFileSync(envPath, next, 'utf8')
	process.env[RELAY_SEED_ENV] = seedHex
	process.env[RELAY_PUBLIC_KEY_ENV] = publicKeyHex
}

export type MigrateRelayEnvResult = {
	seedHex: string
	publicKeyHex: string
	seedSource: string
	publicKeySource: 'manifest' | 'derived'
	wroteDotEnv: boolean
	removedLegacyFiles: string[]
}

/** Migrate legacy `relay-hyperdht.seed` → repo `.env`; App Store pubkey prefers live production manifest. */
export async function migrateRelayEnvFromLegacy(
	repoRoot: string,
	opts: { writeDotEnv?: boolean; removeLegacyFiles?: boolean } = {},
): Promise<MigrateRelayEnvResult | undefined> {
	const writeDotEnv = opts.writeDotEnv !== false
	const removeLegacyFiles = opts.removeLegacyFiles === true

	const existingSeed = resolveRelaySeedHex(repoRoot)
	const existingPub = resolveRelayPublicKeyHex(repoRoot)
	if (existingSeed && existingPub) {
		return {
			seedHex: existingSeed,
			publicKeyHex: existingPub,
			seedSource: 'env',
			publicKeySource: 'derived',
			wroteDotEnv: false,
			removedLegacyFiles: [],
		}
	}

	const legacyFiles = findLegacyRelaySeedFiles(repoRoot)
	if (legacyFiles.length === 0 && !existingSeed) {
		return undefined
	}

	const seedSource = legacyFiles[0] ?? 'env'
	const seedHex = existingSeed ?? readLegacyRelaySeedHex(seedSource)
	const derivedPub = deriveRelayPublicKeyHexFromSeed(repoRoot, seedHex)
	const manifestPub = await fetchProductionRelayPublicKeyHex()

	let publicKeyHex = existingPub ?? derivedPub
	let publicKeySource: 'manifest' | 'derived' = 'derived'

	if (manifestPub) {
		publicKeyHex = manifestPub
		publicKeySource = 'manifest'
		if (derivedPub !== manifestPub) {
			console.warn(
				`[relay-env] local seed pubkey ${derivedPub.slice(0, 16)}… ≠ production ${manifestPub.slice(0, 16)}…`,
			)
			console.warn(
				'[relay-env] writing production pubkey for App Store embed; Fly deploy needs the matching seed from volume',
			)
		}
	}

	if (writeDotEnv) {
		writeRelayEnvToDotEnv(repoRoot, seedHex, publicKeyHex)
	}

	const removedLegacyFiles: string[] = []
	if (removeLegacyFiles) {
		for (const file of legacyFiles) {
			try {
				unlinkSync(file)
				removedLegacyFiles.push(file)
			} catch {
				/* ignore */
			}
		}
	}

	return {
		seedHex,
		publicKeyHex,
		seedSource,
		publicKeySource,
		wroteDotEnv: writeDotEnv,
		removedLegacyFiles,
	}
}

/** Ensure relay env vars exist in repo `.env` / shell (no legacy file fallback). */
export function ensureRelayEnvReady(repoRoot: string): void {
	if (resolveRelayPublicKeyHex(repoRoot) && resolveRelaySeedHex(repoRoot)) return
	console.error(
		`Missing ${RELAY_SEED_ENV} / ${RELAY_PUBLIC_KEY_ENV}. Run: bun run migrate:relay-env`,
	)
	process.exit(1)
}
