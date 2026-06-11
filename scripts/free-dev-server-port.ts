#!/usr/bin/env bun
/**
 * Frees the Vite dev port (default 1420) if something is still LISTENing.
 * Stale `bun run dev` / Tauri beforeDevCommand often leave this behind.
 *
 * Set `SKIP_FREE_DEV_PORT=1` to skip (e.g. you run another service on 1420).
 */
import { execFileSync } from 'node:child_process'

const DEFAULT_PORT = 1420

function sleepMs(ms: number): void {
	if (typeof Bun !== 'undefined' && typeof Bun.sleepSync === 'function') {
		Bun.sleepSync(ms)
		return
	}
	execFileSync('/bin/sleep', [`${ms / 1000}`], { stdio: 'ignore' })
}

function listenersPid(port: number): string[] {
	try {
		const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim()
		if (!out) return []
		return [...new Set(out.split(/\s+/).filter(Boolean))]
	} catch {
		return []
	}
}

/** Call before `tauri dev` so Vite can bind to the port fixed in `tauri.conf.json` + `vite.config.ts`. */
export function freeDevServerPort(port: number = DEFAULT_PORT): void {
	if (process.env.SKIP_FREE_DEV_PORT === '1') return

	const pids = listenersPid(port)
	if (pids.length === 0) return

	console.warn(
		`[dev] Port ${port} is in use (PID ${pids.join(', ')}); stopping stale listener(s) so Vite can start…`
	)
	for (const pid of pids) {
		try {
			process.kill(Number(pid), 'SIGTERM')
		} catch {
			/* ignore ESRCH */
		}
	}

	for (let i = 0; i < 30; i++) {
		if (listenersPid(port).length === 0) return
		sleepMs(100)
	}

	for (const pid of listenersPid(port)) {
		try {
			process.kill(Number(pid), 'SIGKILL')
		} catch {
			/* ignore */
		}
	}
}

if (import.meta.main) {
	const p = Number(process.argv[2])
	freeDevServerPort(Number.isFinite(p) && p > 0 ? p : DEFAULT_PORT)
}
