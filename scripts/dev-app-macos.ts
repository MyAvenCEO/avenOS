#!/usr/bin/env bun
/**
 * Boots vibe-app-sandbox + Tauri dev (SvelteKit/Vite on :1420 via `beforeDevCommand`).
 * Requires Rust: https://rustup.rs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:macos: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}
	// `lib/app/src-tauri/rust-toolchain.toml` pins 1.88+ (required by current Tauri deps).

	console.log(
		'[dev:app:macos] ceo.aven.os · UI http://127.0.0.1:1420 · sandbox http://127.0.0.1:8081/sandbox.html\n'
	)

	const concurrently = path.join(repoRoot, 'node_modules', '.bin', 'concurrently')
	const child = Bun.spawn(
		[
			concurrently,
			'-k',
			'-n',
			'sandbox,tauri',
			'-c',
			'magenta,cyan',
			'bun --env-file=.env run --cwd libs/vibe-app-sandbox dev',
			'bun --env-file=.env run --cwd lib/app tauri:dev'
		],
		{
			cwd: repoRoot,
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env: process.env
		}
	)

	const code = await child.exited
	process.exit(typeof code === 'number' ? code : 1)
}

void main()
