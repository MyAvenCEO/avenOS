import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Monorepo root — `.env` is loaded via `bun --env-file=../../.env` in package scripts. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function requireEnv(name: string, fallback?: string): string {
	const value = process.env[name] ?? fallback
	if (!value?.trim()) {
		throw new Error(
			`${name} is required. Set it in the repo-root .env (see .env.example) and run via \`bun --env-file=../../.env\`.`,
		)
	}
	return value.trim()
}

/** Resolve DB path relative to `libs/aven-auth/` when not absolute. */
export function resolveDbPath(raw: string): string {
	if (path.isAbsolute(raw)) return raw
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', raw)
}

export function avenAuthEnv() {
	const dbPath = resolveDbPath(process.env.AVEN_AUTH_DB_PATH ?? './data/aven-auth.db')
	fs.mkdirSync(path.dirname(dbPath), { recursive: true })

	return {
		authUrl: requireEnv('BETTER_AUTH_URL', 'http://localhost:3000'),
		secret: requireEnv('BETTER_AUTH_SECRET'),
		dbPath,
		domain: process.env.AVEN_AUTH_DOMAIN?.trim() || new URL(requireEnv('BETTER_AUTH_URL', 'http://localhost:3000')).host,
		networkSeed: process.env.AVEN_AUTH_NETWORK_SEED?.trim() || 'ceo.aven/testnet/abagana',
		defaultInviteExpiresInSeconds: Number(process.env.AVEN_AUTH_INVITE_TTL_SECONDS ?? 86_400),
		inviteDeepLinkScheme: process.env.AVEN_AUTH_INVITE_SCHEME?.trim() || 'avenos',
	}
}

export type AvenAuthEnv = ReturnType<typeof avenAuthEnv>
