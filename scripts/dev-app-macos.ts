#!/usr/bin/env bun
/**
 * Tauri desktop dev: SvelteKit on :1420 (`beforeDevCommand`). Views render in-process via aven-ui + sandbox-quickjs.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeDevServerPort } from './free-dev-server-port.ts'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'

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
		console.warn(`[dev:app:macos] onnxruntime provisioning skipped: ${e instanceof Error ? e.message : e}`)
	}

	console.log(
		'[dev:app:macos] AvenOS Tauri (macOS) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in WKWebView)\n'
	)
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync('bun', ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'app', 'tauri:dev'], {
		cwd: repoRoot,
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: ortDylib ? { ...process.env, AVENOS_ORT_DYLIB: ortDylib } : process.env
	})

	const code = await child.exited
	process.exit(typeof code === 'number' ? code : 1)
}

void main()
