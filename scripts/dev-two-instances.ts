#!/usr/bin/env bun
/**
 * P2P dev harness: spawn two AvenOS Tauri instances side by side.
 *
 * Instance A → http://127.0.0.1:1420
 * Instance B → http://127.0.0.1:1421
 *
 * Both use the normal user data layout: ~/Documents/.avenOS/vaults/<slug>/{db,self}.
 * **Do not** set AVENOS_DATA_DIR_OVERRIDE here — each window gets its own in-memory active vault via
 * the lock-screen picker, so two personas (e.g. alice + bob vaults) can run concurrently without two
 * separate override trees.
 *
 * After unlock on each window: pick different people at "Who are you?" if testing two-human flows.
 *
 * Prerequisites:
 *   - Run `bun run dev:app:macos` once first so the binary and front-end are compiled.
 *   - Alternatively, pre-build: `bun run build:app:macos` (slower first build).
 *
 * Reset vaults during dev (destructive — removes all saved personas):
 *   rm -rf ~/Documents/.avenOS/vaults
 *
 * For a fully isolated sandbox (single flat vault root, no multi-vault), set per-process
 * AVENOS_DATA_DIR_OVERRIDE yourself — not handled by this script.
 *
 * Usage:
 *   bun run dev:two-instances
 *
 * The script starts two SvelteKit dev servers on :1420 and :1421 simultaneously,
 * then starts both Tauri processes. Stdout/stderr from each instance is prefixed
 * with a colored label [A] or [B] so you can tell them apart.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'lib/app')
const vaultsHint = path.join(homedir(), 'Documents', '.avenOS', 'vaults')

/**
 * Wait until a TCP port is accepting connections (or timeout).
 */
async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const conn = await Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {}, open() {}, close() {}, error() {} } })
			conn.end()
			return
		} catch {
			await Bun.sleep(500)
		}
	}
	throw new Error(`Port ${port} did not become available within ${timeoutMs}ms`)
}

// Colour codes (ansi)
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'

function prefixLines(label: string, colour: string, data: Buffer | string) {
	const text = typeof data === 'string' ? data : data.toString('utf8')
	const prefix = `${BOLD}${colour}[${label}]${RESET} `
	return text
		.split('\n')
		.map((line) => (line ? prefix + line : ''))
		.join('\n')
}

function spawnLabelled(
	label: 'A' | 'B',
	colour: string,
	cmd: string,
	args: string[],
	opts: { cwd: string; env: Record<string, string> },
) {
	const child = spawn(cmd, args, {
		cwd: opts.cwd,
		env: opts.env,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	child.stdout.on('data', (d: Buffer) => process.stdout.write(prefixLines(label, colour, d) + '\n'))
	child.stderr.on('data', (d: Buffer) => process.stderr.write(prefixLines(label, colour, d) + '\n'))
	child.on('exit', (code) => {
		console.log(`${BOLD}${colour}[${label}]${RESET} process exited (code ${code ?? 'signal'})`)
	})
	return child
}

/**
 * Start Vite dev server for instance B on port 1421.
 * Instance A's Vite is started by Tauri's beforeDevCommand as usual.
 */
function spawnViteB(colour: string, env: Record<string, string>) {
	return spawnLabelled('B', colour, 'bun', ['--bun', 'x', 'vite', 'dev', '--port', '1421'], {
		cwd: appDir,
		env: { ...env, FORCE_COLOR: '1' },
	})
}

// Inline config overlay for instance B passed directly to `tauri dev --config <json>`.
// Using inline JSON avoids Tauri passing the path down to cargo as a TOML --config flag.
const TAURI_B_CONFIG = JSON.stringify({
	productName: 'Aven OS (Dev B)',
	identifier: 'ceo.aven.os.dev-b',
	build: {
		beforeDevCommand: '',
		devUrl: 'http://127.0.0.1:1421',
		beforeBuildCommand: '',
	},
})

function spawnTauri(label: 'A' | 'B', colour: string, env: Record<string, string>) {
	const instanceEnv = { ...env, AVENOS_DEV_INSTANCE: label }

	// For B: pass the overlay as inline JSON to `tauri dev --config '{...}'`.
	// Do NOT use `--` before --config — that routes it to cargo, not to the Tauri CLI.
	const extraArgs = label === 'B' ? ['--config', TAURI_B_CONFIG] : []

	return spawnLabelled(label, colour, 'bunx', ['--bun', 'tauri', 'dev', ...extraArgs], {
		cwd: appDir,
		env: instanceEnv,
	})
}

async function main() {
	console.log(
		`\n${BOLD}AvenOS — P2P dev harness${RESET}\n` +
			`  ${CYAN}[A]${RESET}  http://127.0.0.1:1420\n` +
			`  ${MAGENTA}[B]${RESET}  http://127.0.0.1:1421\n\n` +
			`Shared vault store: ${vaultsHint}\n` +
			`Pick a different persona in each window to exercise two-human P2P (or reuse one vault — avoid opening the same slug in both).\n\n` +
			`Reset all dev personas: rm -rf ${vaultsHint}\n` +
			`Press Ctrl-C to stop both.\n`,
	)

	freeDevServerPort(1420)
	freeDevServerPort(1421)

	// Load .env so child processes inherit the same variables
	const baseEnv = process.env as Record<string, string>

	// Instance A: Tauri handles the full lifecycle (beforeDevCommand starts Vite on :1420)
	const tauriA = spawnTauri('A', CYAN, baseEnv)

	// Wait until instance A's Vite is up before starting instance B
	console.log(`${BOLD}${CYAN}[A]${RESET} Waiting for Vite on :1420…`)
	try {
		await waitForPort(1420, 90_000)
	} catch {
		console.error(`${BOLD}${CYAN}[A]${RESET} Timed out waiting for :1420 — did instance A start?`)
		tauriA.kill('SIGTERM')
		process.exit(1)
	}

	// Instance B: Vite on :1421 (no beforeDevCommand in tauri.conf.b.json)
	const viteB = spawnViteB(MAGENTA, baseEnv)

	console.log(`${BOLD}${MAGENTA}[B]${RESET} Waiting for Vite on :1421…`)
	try {
		await waitForPort(1421, 60_000)
	} catch {
		console.error(`${BOLD}${MAGENTA}[B]${RESET} Timed out waiting for :1421`)
		tauriA.kill('SIGTERM')
		viteB.kill('SIGTERM')
		process.exit(1)
	}

	// Now launch instance B's Tauri (devUrl :1421 is ready)
	const tauriB = spawnTauri('B', MAGENTA, baseEnv)

	const allProcs = [tauriA, viteB, tauriB]

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.on(sig, () => {
			for (const p of allProcs) p.kill(sig)
		})
	}

	await Promise.all(allProcs.map((p) => new Promise((res) => p.on('exit', res))))
}

void main()
