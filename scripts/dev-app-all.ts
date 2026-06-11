#!/usr/bin/env bun
/**
 * Tauri desktop dev for the current OS (macOS or Linux). Browser-only: `bun run dev:app`.
 * iOS Simulator: `bun run dev:app:ios` (macOS only).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const scriptByPlatform: Partial<Record<NodeJS.Platform, string>> = {
	darwin: 'dev-app-macos.ts',
	linux: 'dev-app-linux.ts'
}

const platform = process.platform
const script = scriptByPlatform[platform]

if (!script) {
	console.error(
		`dev:app:all: no native Tauri dev script for "${platform}". Use "bun run dev:app" for browser-only Vite.`
	)
	process.exit(1)
}

const result = spawnSync('bun', ['--env-file=.env', `./scripts/${script}`], {
	cwd: repoRoot,
	stdio: 'inherit',
	env: process.env
})

process.exit(result.status ?? 1)
