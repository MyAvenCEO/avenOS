#!/usr/bin/env bun
/**
 * Print AVENOS_RELAY_PUBLIC_KEY_HEX for a seed in repo `.env` or argv.
 *
 *   bun ./scripts/derive-relay-pubkey.ts
 *   bun ./scripts/derive-relay-pubkey.ts <64-hex-seed>
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RELAY_PUBLIC_KEY_ENV, RELAY_SEED_ENV, resolveRelaySeedHex } from './relay-env.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = path.join(repoRoot, 'projects', 'aven-p2p-signal', 'Cargo.toml')

const seedArg = process.argv[2]?.trim()
const seed = seedArg ?? resolveRelaySeedHex(repoRoot)
if (!seed) {
	console.error(
		`derive-relay-pubkey: pass 64-hex seed or set ${RELAY_SEED_ENV} in repo .env`,
	)
	process.exit(1)
}

const pk = execFileSync(
	'cargo',
	['run', '-q', `--manifest-path=${manifest}`, '--', '--derive-relay-public-key'],
	{
		cwd: repoRoot,
		env: { ...process.env, [RELAY_SEED_ENV]: seed },
		encoding: 'utf8',
	},
).trim()

console.log(pk)
console.error(`\nAdd to repo .env:\n${RELAY_PUBLIC_KEY_ENV}=${pk}`)
