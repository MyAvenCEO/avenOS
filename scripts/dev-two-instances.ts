#!/usr/bin/env bun
/**
 * Dev harness: spawn two AvenOS Tauri instances side by side (local UI testing).
 *
 * Instance A → http://127.0.0.1:1420
 * Instance B → http://127.0.0.1:1421
 *
 * Both use the network layout: <Documents>/.avenOS/ceo.aven/testnet/abagana/peers/<slug>/{db,vault}.
 * **Do not** set AVENOS_DATA_DIR_OVERRIDE here — each window gets its own in-memory active vault via
 * the lock-screen picker, so two personas (e.g. alice + bob vaults) can run concurrently without two
 * separate override trees.
 *
 * After unlock on each window: pick different people at "Who are you?" if testing two-human flows.
 *
 * Prerequisites:
 *   - Run `bun run dev:app:mac` or `bun run dev:app:linux` once first so deps compile.
 *   - Alternatively, pre-build a local unsigned release via `bun run --cwd app tauri:build:macos`
 *     or `tauri:build:linux` (slower first build). NOTE: `bun run release:app:mac` / `bun run release:app:ios`
 *     now produce signed App Store artifacts AND upload them — not what you want for two-instance dev.
 *
 * Reset the network during dev (destructive — removes all saved personas AND the
 * server node, so the next signup is auto-admitted as the first admin again):
 *   rm -rf "<Documents>/.avenOS/ceo.aven/testnet/abagana/peers"  (see peersHint printed at startup)
 *   The on-disk dir is `peers/` — it holds one `<slug>/` per peer: every client
 *   device AND the aven-node server. Deleting only some sub-dirs leaves the server's
 *   avenCEO genesis (which names the old admin), so first-admin never re-arms.
 *
 * For a fully isolated sandbox (single flat vault root, no multi-vault), set per-process
 * AVENOS_DATA_DIR_OVERRIDE yourself — not handled by this script.
 *
 * Usage:
 *   bun run dev:app2x:mac
 *   bun run dev:app2x:linux
 *
 * The script starts two SvelteKit dev servers on :1420 and :1421 simultaneously,
 * then starts both Tauri processes. Stdout/stderr from each instance is prefixed
 * with a colored label [A] or [B] so you can tell them apart.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'app')
/** Instance B — separate target so parallel `tauri dev` does not block on artifact dir lock. */
const TAURI_B_TARGET_DIR = path.join(repoRoot, 'target/rust-dev-b')

function userDocumentsDir(): string {
	const xdg = process.env.XDG_DOCUMENTS_DIR?.trim()
	if (xdg) return xdg
	return path.join(homedir(), 'Documents')
}

const peersHint = path.join(
	userDocumentsDir(),
	'.avenOS',
	'ceo.aven',
	'testnet',
	'abagana',
	'peers'
)

/** Linux WebKitGTK defaults (same as dev-app-linux.ts). */
function devBaseEnv(): Record<string, string> {
	const env = { ...process.env } as Record<string, string>
	if (platform() === 'linux') {
		env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1'
		env.WEBKIT_DISABLE_COMPOSITING_MODE ??= '1'
	}
	return env
}

/**
 * Wait until a TCP port is accepting connections (or timeout).
 */
async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const conn = await Bun.connect({
				hostname: '127.0.0.1',
				port,
				socket: { data() {}, open() {}, close() {}, error() {} }
			})
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
const GREEN = '\x1b[32m'

// Both instances dial an aven-node over a WebSocket (`/sync`, nonce-bound did:key
// challenge) — one relay, N clients, the same transport prod uses.
const SERVER_HTTP_PORT = 8080
/** Stable dev identity for the relay (32-byte hex) — keeps the aven's DID constant across runs. */
const DEV_SERVER_SEED = 'a0b1c2d3e4f5060718293a4b5c6d7e8f00112233445566778899aabbccddeeff'

// ── Sync relay endpoint ───────────────────────────────────────────────────────
// Default: a LOCAL aven-node on ws://127.0.0.1:8080/sync (built & run here). To
// instead test the Sprite-hosted relay over its PUBLIC url — the exact path a
// TestFlight device takes, with NO `sprite proxy` and NO cert pin:
//   AVENOS_SERVER_WS_URL=wss://aven-ceo-bmrha.sprites.app/sync bun run dev:app2x:mac
const LOCAL_WS = `ws://127.0.0.1:${SERVER_HTTP_PORT}/sync`
const EXTERNAL_WS = process.env.AVENOS_SERVER_WS_URL?.trim() || ''

function prefixLines(label: string, colour: string, data: Buffer | string) {
	const text = typeof data === 'string' ? data : data.toString('utf8')
	const prefix = `${BOLD}${colour}[${label}]${RESET} `
	return text
		.split('\n')
		.map((line) => (line ? prefix + line : ''))
		.join('\n')
}

function spawnLabelled(
	label: string,
	colour: string,
	cmd: string,
	args: string[],
	opts: { cwd: string; env: Record<string, string> }
) {
	const child = spawn(cmd, args, {
		cwd: opts.cwd,
		env: opts.env,
		stdio: ['ignore', 'pipe', 'pipe']
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
	return spawnLabelled(
		'B',
		colour,
		'bun',
		['--env-file=../.env', '--bun', 'x', 'vite', 'dev', '--port', '1421'],
		{
			cwd: appDir,
			env: { ...env, FORCE_COLOR: '1', AVENOS_DEV_INSTANCE: 'B' }
		}
	)
}

// Inline config overlay for instance B passed directly to `tauri dev --config <json>`.
// Using inline JSON avoids Tauri passing the path down to cargo as a TOML --config flag.
const TAURI_B_CONFIG = JSON.stringify({
	productName: 'Aven OS (Dev B)',
	identifier: 'ceo.aven.os.dev-b',
	build: {
		beforeDevCommand: '',
		devUrl: 'http://127.0.0.1:1421',
		beforeBuildCommand: ''
	}
})

function spawnTauri(label: 'A' | 'B', colour: string, env: Record<string, string>) {
	// `env` already carries AVENOS_SERVER_SYNC / _ADDR / _CERT_PIN (set in main once
	// the local relay is up), so both instances dial the same aven-node and
	// converge a shared spark through it. Single-instance `dev` omits those and
	// stays local-only.
	const instanceEnv: Record<string, string> = {
		...env,
		AVENOS_DEV_INSTANCE: label,
	}
	if (label === 'B') {
		instanceEnv.CARGO_TARGET_DIR = TAURI_B_TARGET_DIR
		// Same physical device → same auto peer-name; suffix B so each peer is
		// distinguishable by name at sign-in.
		instanceEnv.AVEN_PEER_SUFFIX = ' (B)'
	}

	// For B: pass the overlay as inline JSON to `tauri dev --config '{...}'`.
	// Do NOT use `--` before --config — that routes it to cargo, not to the Tauri CLI.
	const extraArgs = label === 'B' ? ['--config', TAURI_B_CONFIG] : []

	return spawnLabelled(label, colour, 'bun', ['--bun', 'x', 'tauri', 'dev', ...extraArgs], {
		cwd: appDir,
		env: instanceEnv
	})
}

/**
 * Build & run the local `aven-node` relay — an HTTP+WebSocket server on
 * 127.0.0.1:8080 serving `/health` + `/sync`. Both app instances dial
 * ws://127.0.0.1:8080/sync. No TLS / no cert pin locally (plain ws). Stable dev
 * seed keeps the relay DID constant across runs.
 */
function spawnAvenServer(colour: string, env: Record<string, string>) {
	return spawnLabelled(
		'S',
		colour,
		'cargo',
		['run', '--manifest-path', 'libs/aven-node/Cargo.toml'],
		{
			cwd: repoRoot,
			env: {
				...env,
				AVEN_SERVER_HEALTH_BIND: `127.0.0.1:${SERVER_HTTP_PORT}`,
				AVEN_SERVER_SEED: process.env.AVEN_SERVER_SEED?.trim() || DEV_SERVER_SEED,
				RUST_LOG: env.RUST_LOG ?? 'info'
			}
		}
	)
}

async function main() {
	const plat = platform()
	const platLabel = plat === 'darwin' ? 'macOS' : plat === 'linux' ? 'Linux' : plat

	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error('dev:app2x: `cargo` not found. Install Rust from https://rustup.rs')
		process.exit(1)
	}

	console.log(
		`\n${BOLD}AvenOS — two-instance dev harness (${platLabel})${RESET}\n` +
			`  ${GREEN}[S]${RESET}  aven-node relay  ${EXTERNAL_WS || LOCAL_WS}\n` +
			`  ${CYAN}[A]${RESET}  http://127.0.0.1:1420\n` +
			`  ${MAGENTA}[B]${RESET}  http://127.0.0.1:1421\n\n` +
			`${BOLD}Sync:${RESET} both instances dial the ${GREEN}[S]${RESET} relay over a WebSocket\n` +
			`      (nonce-bound did:key challenge) — A↔B converge through it.\n\n` +
			`Shared peers store: ${peersHint}\n` +
			`${BOLD}${MAGENTA}WARNING:${RESET} Unlocking the same identity slug in [A] and [B] at once grabs the same RocksDB files (\`storage.rocksdb\`) — Share/DB can stay on Loading indefinitely. Pick different people on each lock screen.\n\n` +
			`${BOLD}Note:${RESET} AVENOS_DEV_INSTANCE is ${CYAN}A${RESET} / ${MAGENTA}B${RESET} for log prefixes + Vite cache dirs; it does not isolate peer dirs.\n\n` +
			`Reset the whole network (personas + server → re-arms first-admin): rm -rf ${peersHint}\n` +
			`Press Ctrl-C to stop the relay and both instances.\n`
	)

	freeDevServerPort(1420)
	freeDevServerPort(1421)
	if (!EXTERNAL_WS) freeDevServerPort(SERVER_HTTP_PORT)

	const baseEnv = devBaseEnv()

	// Resolve the sync relay: a remote Sprite-hosted server over its public wss URL
	// (no proxy, no pin — the exact path a device takes), else a LOCAL aven-node we
	// build & run on ws://127.0.0.1:8080/sync.
	let server: ReturnType<typeof spawnLabelled> | undefined
	let wsUrl: string
	if (EXTERNAL_WS) {
		console.log(
			`${BOLD}${GREEN}[S]${RESET} Using remote sync relay: ${EXTERNAL_WS} (no local relay, no proxy)`
		)
		wsUrl = EXTERNAL_WS
	} else {
		console.log(
			`${BOLD}${GREEN}[S]${RESET} Building & starting local aven-node relay ` +
				`(first build compiles RocksDB — may take a few minutes)…`
		)
		server = spawnAvenServer(GREEN, baseEnv)
		try {
			await waitForPort(SERVER_HTTP_PORT, 600_000)
		} catch (e) {
			console.error(`${BOLD}${GREEN}[S]${RESET} ${(e as Error).message}`)
			server?.kill('SIGTERM')
			process.exit(1)
		}
		wsUrl = LOCAL_WS
		console.log(`${BOLD}${GREEN}[S]${RESET} local relay up on ${wsUrl}`)
	}

	// Point both instances at the relay (read at runtime by `try_server_transport`).
	baseEnv.AVENOS_SERVER_WS_URL = wsUrl

	// Instance A: Tauri handles the full lifecycle (beforeDevCommand starts Vite on :1420)
	const tauriA = spawnTauri('A', CYAN, baseEnv)

	// Wait until instance A's Vite is up before starting instance B
	console.log(`${BOLD}${CYAN}[A]${RESET} Waiting for Vite on :1420…`)
	try {
		await waitForPort(1420, 90_000)
	} catch {
		console.error(`${BOLD}${CYAN}[A]${RESET} Timed out waiting for :1420 — did instance A start?`)
		tauriA.kill('SIGTERM')
		server?.kill('SIGTERM')
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
		server?.kill('SIGTERM')
		process.exit(1)
	}

	console.log(
		`${BOLD}${MAGENTA}[B]${RESET} Starting Tauri (devUrl :1421, target ${TAURI_B_TARGET_DIR})…`
	)
	const tauriB = spawnTauri('B', MAGENTA, baseEnv)

	const allProcs = [server, tauriA, viteB, tauriB].filter(Boolean) as ReturnType<typeof spawnLabelled>[]

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.on(sig, () => {
			for (const p of allProcs) p.kill(sig)
		})
	}

	await Promise.all(allProcs.map((p) => new Promise((res) => p.on('exit', res))))
}

void main()
