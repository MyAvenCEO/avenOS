#!/usr/bin/env bun
/**
 * Shared local sync-relay (`aven-node`) launcher for the dev app scripts.
 *
 * Every dev run needs a server to dial: without one the app runs local-only and
 * the invite gate never opens, because there is no avenCEO **owner** to auto-grant
 * the first connecting peer admin. The server mints avenCEO on startup (server =
 * owner) under `…/.avenOS/<network>/peers/<server>/db`, then grants the first peer
 * that connects. So `dev:app:mac` / `dev:app:linux` (single instance) and
 * `dev:app2x` (two instances) all start this same relay.
 *
 * Set `AVENOS_SERVER_WS_URL=wss://…/sync` to dial a remote Sprite-hosted relay
 * instead (the exact path a device takes) — then no local server is started.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const BOLD = '\x1b[1m'

export const SERVER_HTTP_PORT = 8080
/** Stable dev identity for the relay (32-byte hex) — keeps the aven's DID and the
 *  avenCEO owner constant across runs (so members stay admitted between restarts). */
export const DEV_SERVER_SEED = 'a0b1c2d3e4f5060718293a4b5c6d7e8f00112233445566778899aabbccddeeff'
export const LOCAL_WS = `ws://127.0.0.1:${SERVER_HTTP_PORT}/sync`

/** Wait until a TCP port is accepting connections (or timeout). */
export async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
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

function prefixLines(data: Buffer | string): string {
	const text = typeof data === 'string' ? data : data.toString('utf8')
	const prefix = `${BOLD}${GREEN}[S]${RESET} `
	return text
		.split('\n')
		.map((line) => (line ? prefix + line : ''))
		.join('\n')
}

/**
 * Build & run the local `aven-node` relay (HTTP+WS on :8080, `/health` + `/sync`).
 * Output is line-prefixed `[S]`. Caller owns the lifecycle (kill on exit).
 */
export function spawnAvenServer(env: Record<string, string> = {}): ChildProcess {
	const child = spawn('cargo', ['run', '--manifest-path', 'libs/aven-node/Cargo.toml'], {
		cwd: repoRoot,
		env: {
			...process.env,
			...env,
			AVEN_SERVER_HEALTH_BIND: `127.0.0.1:${SERVER_HTTP_PORT}`,
			AVEN_SERVER_SEED: process.env.AVEN_SERVER_SEED?.trim() || DEV_SERVER_SEED,
			RUST_LOG: env.RUST_LOG ?? process.env.RUST_LOG ?? 'info'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	})
	child.stdout?.on('data', (d: Buffer) => process.stdout.write(`${prefixLines(d)}\n`))
	child.stderr?.on('data', (d: Buffer) => process.stderr.write(`${prefixLines(d)}\n`))
	child.on('exit', (code) =>
		console.log(`${BOLD}${GREEN}[S]${RESET} relay exited (code ${code ?? 'signal'})`)
	)
	return child
}

/**
 * Resolve the sync relay for a dev run and return the ws URL to point the app at.
 * If `AVENOS_SERVER_WS_URL` is set, dial that remote (no local server). Otherwise
 * free :8080, build & run a local `aven-node`, and wait for it to listen. The
 * returned `server` (when local) must be torn down by the caller on exit.
 */
export async function startSyncRelay(
	env: Record<string, string> = {}
): Promise<{ wsUrl: string; server?: ChildProcess }> {
	const external = process.env.AVENOS_SERVER_WS_URL?.trim() || ''
	if (external) {
		console.log(`${BOLD}${GREEN}[S]${RESET} Using remote sync relay: ${external} (no local server)`)
		return { wsUrl: external }
	}
	freeDevServerPort(SERVER_HTTP_PORT)
	console.log(
		`${BOLD}${GREEN}[S]${RESET} Building & starting local aven-node relay ` +
			`(first build compiles RocksDB — may take a few minutes)…`
	)
	const server = spawnAvenServer(env)
	await waitForPort(SERVER_HTTP_PORT, 600_000)
	console.log(`${BOLD}${GREEN}[S]${RESET} local relay up on ${LOCAL_WS}`)
	return { wsUrl: LOCAL_WS, server }
}
