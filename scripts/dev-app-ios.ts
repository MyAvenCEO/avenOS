#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
/**
 * Tauri iOS Simulator dev: SvelteKit on :1420 (`beforeDevCommand`), app in Simulator.
 *
 * Tauri v2: `tauri ios dev [DEVICE]` — no `--target` (that flag is for `tauri ios build` only).
 * Set AVEN_IOS_SIM_DEVICE to force a simulator name; otherwise the CLI picks one.
 *
 * iOS Simulator uses the same **dev insecure identity** as Linux (plain root secret on disk).
 * TestFlight / device builds keep Secure Enclave — see docs/deploy/ios-simulator-local.md.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type SimDevice = { name: string; isAvailable: boolean }

function resolveSimulatorDevice(): string | undefined {
	const fromEnv = process.env.AVEN_IOS_SIM_DEVICE?.trim()
	if (fromEnv) return fromEnv

	const list = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
		encoding: 'utf8'
	})
	if (list.status !== 0 || !list.stdout) return undefined

	try {
		const parsed = JSON.parse(list.stdout) as { devices?: Record<string, SimDevice[]> }
		const runtimes = Object.keys(parsed.devices ?? {}).filter((r) =>
			r.toLowerCase().includes('ios')
		)
		runtimes.sort((a, b) => b.localeCompare(a))
		for (const runtime of runtimes) {
			for (const device of parsed.devices?.[runtime] ?? []) {
				if (device.isAvailable && /iPhone/i.test(device.name)) {
					return device.name
				}
			}
		}
	} catch {
		return undefined
	}
	return undefined
}

async function main() {
	if (process.platform !== 'darwin') {
		console.error('dev:app:ios: iOS Simulator dev requires macOS.')
		process.exit(1)
	}

	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app:ios: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	const xcode = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' })
	if (xcode.status !== 0) {
		console.error(
			'dev:app:ios: Xcode not found. Install Xcode and run `xcode-select --install` if needed.'
		)
		process.exit(1)
	}

	const genApple = path.join(repoRoot, 'app/src-tauri/gen/apple')
	if (!existsSync(genApple)) {
		console.error(
			'dev:app:ios: missing app/src-tauri/gen/apple — run once from app:\n  CI=true bunx tauri ios init --ci'
		)
		process.exit(1)
	}

	freeDevServerPort(1420)

	const simDevice = resolveSimulatorDevice()
	console.log(
		'[dev:app:ios] AvenOS Tauri (iOS Simulator) · SvelteKit @ http://127.0.0.1:1420 · `tauri ios dev`'
	)
	if (simDevice) {
		console.log(`[dev:app:ios] Simulator device: ${simDevice}`)
	} else {
		console.log('[dev:app:ios] No simulator name resolved — Tauri will prompt or pick a device.')
	}
	console.log(
		'[dev:app:ios] Identity: dev insecure (same as Linux debug). Override sim: AVEN_IOS_SIM_DEVICE="iPhone 16 Pro".'
	)
	console.log(
		'[dev:app:ios] First build can take 10–20+ min. Leave this terminal open — Xcode installs and **launches** avenOS automatically.'
	)
	console.log(
		'[dev:app:ios] Until launch finishes, Spotlight/home will show no avenOS (that is normal).\n'
	)

	const env = {
		...process.env,
		AVENOS_DEV_INSECURE_IDENTITY: '1'
	} satisfies Record<string, string | undefined>

	// iOS gets STT (default) + the on-device LLM (LFM2.5-1.2B GGUF via llama.cpp/Metal,
	// statically linked). Matches the release build (scripts/tauri-ios-asc.ts); TTS stays
	// desktop-only (onnxruntime dylib can't ship on iOS).
	const tauriArgs = ['bun', '--env-file=.env', 'x', '--bun', 'tauri', 'ios', 'dev']
	// The optional [DEVICE] positional MUST precede `--features` (variadic — it would
	// otherwise swallow the device name as a feature).
	if (simDevice) tauriArgs.push(simDevice)
	tauriArgs.push('--features', 'local-llama')

	const child = Bun.spawn(tauriArgs, {
		cwd: path.join(repoRoot, 'app'),
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env
	})

	const code = await child.exited
	process.exit(typeof code === 'number' ? code : 1)
}

void main()
