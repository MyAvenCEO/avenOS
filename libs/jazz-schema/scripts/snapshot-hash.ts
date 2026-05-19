#!/usr/bin/env bun
/**
 * Print Groove SchemaHash (32-byte hex) for a manifest snapshot.
 * Used to fill `migrations/registry.json` after `migrations create`-style edits.
 *
 * Usage:
 *   bun run snapshot:hash
 *   bun run snapshot:hash migrations/snapshots/pre-messages.manifest.json
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestRel =
	process.argv[2]?.trim() || 'schema.manifest.json'

const toolDir = path.resolve(root, '../../tools/avenos-schema-hash')
const r = spawnSync(
	'cargo',
	['run', '--quiet', '--manifest-path', path.join(toolDir, 'Cargo.toml'), '--', path.join(root, manifestRel)],
	{ encoding: 'utf8' },
)

if (r.status !== 0) {
	console.error(r.stderr || r.stdout)
	process.exit(r.status ?? 1)
}
process.stdout.write(r.stdout.trim() + '\n')
