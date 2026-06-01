#!/usr/bin/env bun
/**
 * Single source of truth for booting the **aven-auth** server alongside the app in dev.
 *
 * Used by `dev-app-macos.ts`, `dev-app-linux.ts` and `dev-two-instances.ts` so the
 * invite-only auth backend (`http://localhost:3000`) is always running for the Tauri
 * `/invite` flow. Migrates the SQLite DB (idempotent) then starts the dev server.
 *
 * Skip it with `SKIP_AVEN_AUTH=1` (e.g. you run the server yourself via `bun run dev:aven-auth`).
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { freeDevServerPort } from './free-dev-server-port.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libDir = path.join(repoRoot, 'libs/aven-auth')
const envFile = path.join(repoRoot, '.env')

export const AVEN_AUTH_PORT = 3000

const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

function prefixLines(data: Buffer | string): string {
	const text = typeof data === 'string' ? data : data.toString('utf8')
	const prefix = `${BOLD}${GREEN}[auth]${RESET} `
	return text
		.split('\n')
		.map((line) => (line ? prefix + line : ''))
		.join('\n')
}

async function waitForHealth(port: number, timeoutMs = 60_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://localhost:${port}/health`)
			if (res.ok) return true
		} catch {
			/* server not up yet — retry */
		}
		await Bun.sleep(400)
	}
	return false
}

export type AuthServerHandle = {
	child: ChildProcess | null
	ready: Promise<boolean>
	stop: () => void
}

/**
 * Migrate (idempotent) and start the aven-auth dev server on :3000.
 * Output is prefixed with a green `[auth]` label. Returns a handle whose `stop()`
 * terminates the server; callers should invoke it when the app process exits.
 */
export function startAvenAuthServer(): AuthServerHandle {
	if (process.env.SKIP_AVEN_AUTH === '1') {
		console.log(prefixLines('SKIP_AVEN_AUTH=1 — not starting the auth server'))
		return { child: null, ready: Promise.resolve(false), stop: () => {} }
	}

	freeDevServerPort(AVEN_AUTH_PORT)

	// Better Auth's migrate CLI reads the SvelteKit-generated tsconfig, so sync first.
	spawnSync('bun', ['--bun', 'x', 'svelte-kit', 'sync'], { cwd: libDir, stdio: 'ignore' })
	const migrate = spawnSync('bun', [`--env-file=${envFile}`, 'run', 'migrate'], {
		cwd: libDir,
		stdio: 'inherit'
	})
	if (migrate.status !== 0) {
		console.error(
			prefixLines('migration failed — is BETTER_AUTH_SECRET set in .env? continuing anyway')
		)
	}

	console.log(prefixLines(`starting aven-auth server → http://localhost:${AVEN_AUTH_PORT}`))
	// `detached` puts the server in its own process group so stop() can reap the whole
	// tree — `bun run dev` spawns a vite grandchild that otherwise outlives a plain kill.
	const child = spawn('bun', [`--env-file=${envFile}`, 'run', 'dev'], {
		cwd: libDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
		env: process.env
	})
	child.stdout?.on('data', (d: Buffer) => process.stdout.write(prefixLines(d) + '\n'))
	child.stderr?.on('data', (d: Buffer) => process.stderr.write(prefixLines(d) + '\n'))
	child.on('exit', (code) => console.log(prefixLines(`server exited (code ${code ?? 'signal'})`)))

	const ready = waitForHealth(AVEN_AUTH_PORT).then((ok) => {
		console.log(
			prefixLines(
				ok ? `ready ✓ http://localhost:${AVEN_AUTH_PORT}` : 'did not become healthy in time'
			)
		)
		return ok
	})

	const stop = () => {
		try {
			// Negative PID → signal the whole process group (bun + vite grandchild).
			if (child.pid) process.kill(-child.pid, 'SIGTERM')
		} catch {
			/* group already gone */
		}
		// Fallback: ensure nothing is left holding the port.
		freeDevServerPort(AVEN_AUTH_PORT)
	}
	return { child, ready, stop }
}
