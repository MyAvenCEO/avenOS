#!/usr/bin/env bun
/**
 * Run Vite/SvelteKit dev under Node (required for `better-sqlite3`).
 * Env: repo-root `.env` via `bun --env-file=../../.env run scripts/dev-server.ts`.
 */
import { spawnSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '../..')
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const svelteKitBin = path.join(repoRoot, 'node_modules', '@sveltejs', 'kit', 'svelte-kit.js')

spawnSync('node', [svelteKitBin, 'sync'], { cwd: root, stdio: 'inherit', env: process.env })

const child = spawn('node', [viteBin, 'dev', '--port', process.env.AVEN_SELF_DEV_PORT ?? '3000'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env,
})

child.on('exit', (code) => process.exit(code ?? 0))
