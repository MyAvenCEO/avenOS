#!/usr/bin/env bun
/**
 * Dev harness: spawn two AvenOS Tauri instances side by side (local UI testing).
 *
 * Instance A → http://127.0.0.1:1420
 * Instance B → http://127.0.0.1:1421
 *
 * Both use the network layout: <Documents>/.avenOS/ceo.aven/testnet/abagana/identities/<slug>/{db,vault}.
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
 * Reset identities during dev (destructive — removes all saved personas):
 *   rm -rf "<Documents>/.avenOS/ceo.aven/testnet/abagana/identities"  (see identitiesHint printed at startup)
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
import { startAvenAuthServer } from './dev-aven-auth.ts'
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

const identitiesHint = path.join(
	userDocumentsDir(),
	'.avenOS',
	'ceo.aven',
	'testnet',
	'abagana',
	'identities'
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

// Local aven-server "mini" relay: both instances dial it over authenticated TLS
// (server cert pinned + per-client did:key challenge) instead of the old direct
// A↔B TCP. One relay, N clients — the same transport prod uses.
const SERVER_SYNC_PORT = 4290
const SERVER_HEALTH_PORT = 8080
const SERVER_ADDR = `127.0.0.1:${SERVER_SYNC_PORT}`
/** Stable dev identity for the relay (32-byte hex) — keeps the aven's DID constant across runs. */
const DEV_SERVER_SEED = 'a0b1c2d3e4f5060718293a4b5c6d7e8f00112233445566778899aabbccddeeff'

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
	// the local relay is up), so both instances dial the same aven-server and
	// converge a shared spark through it. Single-instance `dev` omits those and
	// stays local-only.
	const instanceEnv: Record<string, string> = {
		...env,
		AVENOS_DEV_INSTANCE: label,
	}
	if (label === 'B') {
		instanceEnv.CARGO_TARGET_DIR = TAURI_B_TARGET_DIR
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
 * Build & run the local `aven-server` mini relay. It self-signs a TLS cert on
 * boot and writes the cert's hex DER pin to `pinFile` (AVEN_SERVER_PIN_FILE) —
 * the harness reads that pin and hands it to both app instances so they pin the
 * relay's cert. Bound to 127.0.0.1 only (no firewall prompt); in-memory + stable
 * dev seed.
 */
function spawnAvenServer(colour: string, env: Record<string, string>, pinFile: string) {
	return spawnLabelled(
		'S',
		colour,
		'cargo',
		['run', '--manifest-path', 'libs/aven-server/Cargo.toml'],
		{
			cwd: repoRoot,
			env: {
				...env,
				AVEN_SERVER_BIND: SERVER_ADDR,
				AVEN_SERVER_HEALTH_BIND: `127.0.0.1:${SERVER_HEALTH_PORT}`,
				AVEN_SERVER_SEED: DEV_SERVER_SEED,
				AVEN_SERVER_PIN_FILE: pinFile,
				RUST_LOG: env.RUST_LOG ?? 'info'
			}
		}
	)
}

/** Poll for the relay's pin file (written once its self-signed cert is generated). */
async function waitForPinFile(pinFile: string, timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const pin = readFileSync(pinFile, 'utf8').trim()
			if (pin.length > 0) return pin
		} catch {
			// not written yet
		}
		await Bun.sleep(500)
	}
	throw new Error(`aven-server pin file not written within ${timeoutMs}ms (build or boot failed?)`)
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
			`  ${GREEN}[S]${RESET}  aven-server relay  tls://${SERVER_ADDR}\n` +
			`  ${CYAN}[A]${RESET}  http://127.0.0.1:1420\n` +
			`  ${MAGENTA}[B]${RESET}  http://127.0.0.1:1421\n\n` +
			`${BOLD}Sync:${RESET} both instances dial the local ${GREEN}[S]${RESET} relay over authenticated TLS\n` +
			`      (server cert pinned + per-client did:key challenge) — A↔B converge through it.\n\n` +
			`Shared identity store: ${identitiesHint}\n` +
			`${BOLD}${MAGENTA}WARNING:${RESET} Unlocking the same identity slug in [A] and [B] at once grabs the same RocksDB files (\`storage.rocksdb\`) — Share/DB can stay on Loading indefinitely. Pick different people on each lock screen.\n\n` +
			`${BOLD}Note:${RESET} AVENOS_DEV_INSTANCE is ${CYAN}A${RESET} / ${MAGENTA}B${RESET} for log prefixes + Vite cache dirs; it does not isolate identity dirs.\n\n` +
			`Reset all dev personas: rm -rf ${identitiesHint}\n` +
			`Press Ctrl-C to stop the relay and both instances.\n`
	)

	freeDevServerPort(1420)
	freeDevServerPort(1421)
	freeDevServerPort(SERVER_SYNC_PORT)
	freeDevServerPort(SERVER_HEALTH_PORT)

	// Boot the invite-only auth backend (http://localhost:3000) once for both instances.
	const auth = startAvenAuthServer()

	const baseEnv = devBaseEnv()

	// Bring up the local relay first: the app instances need its (per-boot) cert
	// pin in their env before they spawn, so this is on the critical path. The
	// first build compiles the RocksDB backend and can take a few minutes; the
	// binary is cached after that and subsequent boots are ~instant.
	const pinFile = path.join(mkdtempSync(path.join(tmpdir(), 'aven-server-mini-')), 'cert.pin')
	try {
		rmSync(pinFile, { force: true })
	} catch {
		// nothing to clear
	}
	console.log(
		`${BOLD}${GREEN}[S]${RESET} Building & starting local aven-server relay ` +
			`(first build compiles RocksDB — may take a few minutes)…`
	)
	const server = spawnAvenServer(GREEN, baseEnv, pinFile)
	let certPin: string
	try {
		certPin = await waitForPinFile(pinFile, 600_000)
		await waitForPort(SERVER_SYNC_PORT, 30_000)
	} catch (e) {
		console.error(`${BOLD}${GREEN}[S]${RESET} ${(e as Error).message}`)
		server.kill('SIGTERM')
		auth.stop()
		process.exit(1)
	}
	console.log(
		`${BOLD}${GREEN}[S]${RESET} relay up on ${SERVER_ADDR} (cert pin ${certPin.slice(0, 16)}…)`
	)

	// Point both instances at the relay (read at runtime by `try_server_transport`).
	baseEnv.AVENOS_SERVER_SYNC = '1'
	baseEnv.AVENOS_SERVER_ADDR = SERVER_ADDR
	baseEnv.AVENOS_SERVER_CERT_PIN = certPin

	// Instance A: Tauri handles the full lifecycle (beforeDevCommand starts Vite on :1420)
	const tauriA = spawnTauri('A', CYAN, baseEnv)

	// Wait until instance A's Vite is up before starting instance B
	console.log(`${BOLD}${CYAN}[A]${RESET} Waiting for Vite on :1420…`)
	try {
		await waitForPort(1420, 90_000)
	} catch {
		console.error(`${BOLD}${CYAN}[A]${RESET} Timed out waiting for :1420 — did instance A start?`)
		tauriA.kill('SIGTERM')
		server.kill('SIGTERM')
		auth.stop()
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
		server.kill('SIGTERM')
		auth.stop()
		process.exit(1)
	}

	console.log(
		`${BOLD}${MAGENTA}[B]${RESET} Starting Tauri (devUrl :1421, target ${TAURI_B_TARGET_DIR})…`
	)
	const tauriB = spawnTauri('B', MAGENTA, baseEnv)

	const allProcs = [server, tauriA, viteB, tauriB]

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.on(sig, () => {
			auth.stop()
			for (const p of allProcs) p.kill(sig)
		})
	}

	await Promise.all(allProcs.map((p) => new Promise((res) => p.on('exit', res))))
	auth.stop()
}

void main()
