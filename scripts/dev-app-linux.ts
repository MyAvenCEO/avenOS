#!/usr/bin/env bun
/**
 * Tauri desktop dev (Linux): SvelteKit on :1420 (`beforeDevCommand`).
 * Views render in-process via aven-ui + sandbox-quickjs.
 *
 * Sets a couple of well-known WebKitGTK 2.x env defaults that fix common
 * rendering glitches on modern Linux desktops. Override by exporting them
 * before running this script.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startSyncRelay } from './aven-server.ts'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'
import { freeDevServerPort } from './free-dev-server-port.ts'
import { ensureLinuxNativeDeps } from './linux-native-deps.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:linux: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	ensureLinuxNativeDeps('dev:app:linux')

	let ortDylib: string | undefined
	try {
		ortDylib = ensureOnnxruntimeDylib(process.arch === 'x64' ? 'x86_64' : 'arm64')
	} catch (e) {
		console.warn(
			`[dev:app:linux] onnxruntime provisioning skipped: ${e instanceof Error ? e.message : e}`
		)
	}

	freeDevServerPort(1420)

	const env: NodeJS.ProcessEnv = { ...process.env }
	// Fixes blank/flickering WKWebView on Wayland + mesa drivers.
	env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1'
	// Fixes broken compositing on some older Intel GPUs / nouveau.
	env.WEBKIT_DISABLE_COMPOSITING_MODE ??= '1'

	console.log(
		'[dev:app:linux] AvenOS Tauri (Linux) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in WebKitGTK)\n'
	)
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync('bun', ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	// Start the local sync relay (aven-node) so the app has a server to dial — it
	// mints avenCEO and auto-grants the first peer admin, opening the invite gate.
	const { server, wsUrl } = await startSyncRelay(env as Record<string, string>)
	env.AVENOS_SERVER_WS_URL = wsUrl
	if (ortDylib) env.AVENOS_ORT_DYLIB = ortDylib

	const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'app', 'tauri:dev'], {
		cwd: repoRoot,
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env
	})

	const shutdown = () => server?.kill('SIGTERM')
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)

	const code = await child.exited
	shutdown()
	process.exit(typeof code === 'number' ? code : 1)
}

void main()
