#!/usr/bin/env bun
/**
 * One-time (or idempotent) migration: legacy `relay-hyperdht.seed` → repo `.env`.
 *
 *   bun run migrate:relay-env
 *   bun run migrate:relay-env -- --remove-files
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrateRelayEnvFromLegacy } from './relay-env.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const removeLegacyFiles = process.argv.includes('--remove-files')

const result = await migrateRelayEnvFromLegacy(repoRoot, {
	writeDotEnv: true,
	removeLegacyFiles,
})

if (!result) {
	console.error('migrate-relay-env: no legacy relay-hyperdht.seed found and .env vars unset')
	console.error('Set AVENOS_RELAY_SEED_HEX + AVENOS_RELAY_PUBLIC_KEY_HEX manually in repo .env')
	process.exit(1)
}

console.log(`seed:   ${result.seedHex.slice(0, 16)}… (from ${result.seedSource})`)
console.log(`pubkey: ${result.publicKeyHex} (${result.publicKeySource})`)
if (result.wroteDotEnv) console.log(`updated: ${repoRoot}/.env`)
if (result.removedLegacyFiles.length) {
	console.log('removed legacy files:')
	for (const f of result.removedLegacyFiles) console.log(`  ${f}`)
}
