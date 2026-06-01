#!/usr/bin/env bun
/**
 * Apply Better Auth schema migrations for `libs/aven-self`.
 * Uses repo-root `.env` via package script: `bun run migrate`.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

execFileSync('bunx', ['auth', 'migrate', '-y', '--config', 'src/lib/auth.ts'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env,
})

console.log('[aven-self] migrations applied')
