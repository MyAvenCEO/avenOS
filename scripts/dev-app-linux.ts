#!/usr/bin/env bun
/**
 * Tauri desktop dev (Linux): SvelteKit on :1420 (`beforeDevCommand`),
 * vibe sandbox in child WebKitGTK webview (`vibe-sandbox://`).
 *
 * Sets a couple of well-known WebKitGTK 2.x env defaults that fix common
 * rendering glitches on modern Linux desktops. Override by exporting them
 * before running this script.
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
		console.error('dev:app:linux: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	freeDevServerPort(1420)

	const env: NodeJS.ProcessEnv = { ...process.env }
	// Fixes blank/flickering WKWebView on Wayland + mesa drivers.
	env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1'
	// Fixes broken compositing on some older Intel GPUs / nouveau.
	env.WEBKIT_DISABLE_COMPOSITING_MODE ??= '1'

	console.log(
		'[dev:app:linux] AvenOS Tauri (Linux) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in WebKitGTK) · Vibe-Sandbox: native Child-WebKitGTK (vibe-sandbox://)\n'
	)

	applyCentralRelayUrlDevDefault('dev-app:linux')
	const p2 = await startP2pSignal(repoRoot)

	const merged = {
		...env,
		...p2.envAugment
	}

	try {
		const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'lib/app', 'tauri:dev'], {
			cwd: repoRoot,
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env: merged
		})

		const code = await child.exited
		process.exit(typeof code === 'number' ? code : 1)
	} finally {
		await p2.dispose()
	}
}

void main()
