#!/usr/bin/env bun
/**
 * Tauri desktop dev: SvelteKit on :1420 (`beforeDevCommand`), vibe sandbox in child WKWebView (`vibe-sandbox://`).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:macos: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	freeDevServerPort(1420)

	console.log(
		'[dev:app:macos] AvenOS Tauri (macOS) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in WKWebView) · Vibe-Sandbox: native Child-WKWebView (vibe-sandbox://)\n'
	)

	const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'lib/app', 'tauri:dev'], {
		cwd: repoRoot,
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: process.env
	})

	const code = await child.exited
	process.exit(typeof code === 'number' ? code : 1)
}

void main()
