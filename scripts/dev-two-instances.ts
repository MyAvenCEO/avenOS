#!/usr/bin/env bun
/**
 * P2P dev harness: spawn two AvenOS Tauri instances side by side.
 *
 * Instance A (avenAlice)  →  http://127.0.0.1:1420  data dir: ~/Documents/.avenOS/avenAlice
 * Instance B (avenBob)    →  http://127.0.0.1:1421  data dir: ~/Documents/.avenOS/avenBob
 *
 * Both instances use the SAME compiled binary (already-built dev binary from the
 * first `cargo tauri dev` run) but point to different data directories via
 * AVENOS_DATA_DIR_OVERRIDE, so they maintain independent identities and Jazz stores.
 * Each scoped root contains the normal `<root>/db/` (SurrealKV) and `<root>/self/`
 * (Secure Enclave blobs) folders the production path creates — they just live next
 * to each other under `.avenOS/` instead of in `$HOME`.
 *
 * After unlock on each machine: use **Self → Peers & anchor** for invite + accept, then **Self → Sharing**
 * → grant admin so encrypted rows sync. Per-pair Hyperswarm topics are derived from your DIDs.
 *
 * Usage:
 *   bun run dev:two-instances
 *
 * Prerequisites:
 *   - Run `bun run dev:app:macos` once first so the binary and front-end are compiled.
 *   - Alternatively, pre-build: `bun run build:app:macos` (slower first build).
 *
 * Reset both identities:
 *   rm -rf ~/Documents/.avenOS/avenAlice ~/Documents/.avenOS/avenBob
 *
 * The script starts two SvelteKit dev servers on :1420 and :1421 simultaneously,
 * then starts both Tauri processes. Stdout/stderr from each instance is prefixed
 * with a colored label [A] (avenAlice) or [B] (avenBob) so you can tell them apart.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'lib/app')

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

function spawnTauri(
	label: 'A' | 'B',
	colour: string,
	dataDir: string,
	env: Record<string, string>,
) {
	const instanceEnv = { ...env, AVENOS_DATA_DIR_OVERRIDE: dataDir, AVENOS_DEV_INSTANCE: label }

	// For B: pass the overlay as inline JSON to `tauri dev --config '{...}'`.
	// Do NOT use `--` before --config — that routes it to cargo, not to the Tauri CLI.
	const extraArgs = label === 'B' ? ['--config', TAURI_B_CONFIG] : []

	return spawnLabelled(label, colour, 'bunx', ['--bun', 'tauri', 'dev', ...extraArgs], {
		cwd: appDir,
		env: instanceEnv,
	})
}

async function main() {
	const avenOsRoot = path.join(homedir(), 'Documents', '.avenOS')
	const dataDirA = path.join(avenOsRoot, 'avenAlice')
	const dataDirB = path.join(avenOsRoot, 'avenBob')

	console.log(
		`\n${BOLD}AvenOS — P2P dev harness${RESET}\n` +
		`  ${CYAN}[A] avenAlice${RESET}  data: ${dataDirA}   port: 1420\n` +
		`  ${MAGENTA}[B] avenBob${RESET}    data: ${dataDirB}   port: 1421\n\n` +
		`Both instances will join the same Hyperswarm topic once unlocked.\n` +
		`Reset both identities: rm -rf ${dataDirA} ${dataDirB}\n` +
		`Press Ctrl-C to stop both.\n`,
	)

	freeDevServerPort(1420)
	freeDevServerPort(1421)

	// Load .env so child processes inherit the same variables
	const baseEnv = process.env as Record<string, string>

	// Instance A: Tauri handles the full lifecycle (beforeDevCommand starts Vite on :1420)
	const tauriA = spawnTauri('A', CYAN, dataDirA, baseEnv)

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
	const tauriB = spawnTauri('B', MAGENTA, dataDirB, baseEnv)

	const allProcs = [tauriA, viteB, tauriB]

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.on(sig, () => {
			for (const p of allProcs) p.kill(sig)
		})
	}

	await Promise.all(allProcs.map((p) => new Promise((res) => p.on('exit', res))))
}

void main()
