#!/usr/bin/env bun
/**
 * Tauri desktop dev: SvelteKit on :1420 (`beforeDevCommand`). Views render in-process via aven-ui + sandbox-quickjs.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startSyncRelay } from './aven-server.ts'
import { ensureSidecar } from './ensure-sidecar.ts'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'
import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:macos: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	freeDevServerPort(1420)

	// On-device LLM runtime: ensure the matching onnxruntime dylib is present and
	// point `ort` (load-dynamic) at it. Best-effort — a failure here only disables
	// the LLM path, not the rest of the app.
	let ortDylib: string | undefined
	try {
		ortDylib = ensureOnnxruntimeDylib()
	} catch (e) {
		console.warn(
			`[dev:app:macos] onnxruntime provisioning skipped: ${e instanceof Error ? e.message : e}`
		)
	}

	console.log(
		'[dev:app:macos] AvenOS Tauri (macOS) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in WKWebView)\n'
	)
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync('bun', ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	// Start the local sync relay (aven-node) so the app has a server to dial — the
	// server mints avenCEO and auto-grants the first peer admin, so the invite gate
	// opens. Without it the app is local-only and stays stuck on the gate.
	const { server, wsUrl } = await startSyncRelay()

	const env: Record<string, string> = { ...process.env, AVENOS_SERVER_WS_URL: wsUrl }
	if (ortDylib) env.AVENOS_ORT_DYLIB = ortDylib

	// Build the .NET stdio sidecar and point the Tauri manager at it (M9). Best-effort;
	// opt into it with PUBLIC_AGENT_RUNTIME=dotnet-sidecar (default stays current-cloud).
	ensureSidecar(repoRoot, env)

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
