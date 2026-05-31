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

function hasCommand(command: string) {
	const result = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' })
	return result.status === 0
}

function findLibclangDir() {
	const probes = [
		'ldconfig -p | awk \'/libclang([-.].*)?\\.so/{print $NF}\' | head -n 1',
		'find /usr/lib /lib -type f \\( -name "libclang.so" -o -name "libclang.so.*" -o -name "libclang-*.so" -o -name "libclang-*.so.*" \\) 2>/dev/null | head -n 1'
	]

	for (const probe of probes) {
		const result = spawnSync('bash', ['-lc', probe], { encoding: 'utf8' })
		const match = result.stdout.trim()
		if (result.status === 0 && match) {
			return path.dirname(match)
		}
	}

	const llvmLibDir = spawnSync('bash', ['-lc', 'llvm-config --libdir 2>/dev/null || true'], {
		encoding: 'utf8'
	})
	const dir = llvmLibDir.stdout.trim()
	return dir || null
}

function ensureLinuxNativeBuildDeps() {
	if (process.platform !== 'linux') return
	const libclangDir = findLibclangDir()
	if (libclangDir) {
		process.env.LIBCLANG_PATH ??= libclangDir
		return
	}

	const missing = [!hasCommand('clang') && 'clang', !hasCommand('llvm-config') && 'llvm'].filter(Boolean)
	const extra = missing.length ? ` Missing tools: ${missing.join(', ')}.` : ''

	console.error(
		[
			'dev:app:linux: missing libclang for Rust native dependencies (zstd-sys/rust-rocksdb via aven-db).',
			'Install the LLVM/Clang development packages, then rerun:',
			'  sudo apt update && sudo apt install -y libclang-dev clang llvm',
			'If already installed, export LIBCLANG_PATH to the directory containing your libclang shared library.',
			extra
		].join('\n')
	)
	process.exit(1)
}

async function main() {
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:linux: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	ensureLinuxNativeBuildDeps()

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
		const child = Bun.spawn(['bun', '--env-file=.env', 'run', '--cwd', 'app', 'tauri:dev'], {
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
