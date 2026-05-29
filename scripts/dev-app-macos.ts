#!/usr/bin/env bun
/**
 * Tauri desktop dev: SvelteKit on :1420 (`beforeDevCommand`), vibe sandbox in child WKWebView (`vibe-sandbox://`).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { freeDevServerPort } from './free-dev-server-port.ts'
import { applyCentralRelayUrlDevDefault, startP2pSignal } from './p2p-signal.ts'

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
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync('bun', ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	applyCentralRelayUrlDevDefault('dev-app:macos')
	const p2 = await startP2pSignal(repoRoot)
	const env = {
		...process.env,
		...p2.envAugment,
	}

	try {
		const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'app', 'tauri:dev'], {
			cwd: repoRoot,
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env
		})

		const code = await child.exited
		process.exit(typeof code === 'number' ? code : 1)
	} finally {
		await p2.dispose()
	}
}

void main()
