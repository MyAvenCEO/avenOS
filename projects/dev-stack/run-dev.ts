#!/usr/bin/env bun
/**
 * Runs Jaensen web-api, Aven CEO (same env as root `dev:local`), and MCP sandbox.
 *
 * Notes:
 * - Don't shell out via root `bun run dev:jaensen-server` / `dev:aven-ceo` — those use
 *   `bun --filter …`, and the parent process can exit 0 immediately.
 * - Don't shell out via `bun run dev:sandbox` either — that wrapper holds the only PID
 *   we'd kill, while the inner `bun --watch sandbox/serve.ts` survives SIGTERM and
 *   keeps port 8081 occupied. We run the build step ourselves and spawn `serve.ts` directly.
 * - Pre-clear the ports we'll bind to, so a leftover server from a crashed run can't
 *   make `bun dev:stack` fail with EADDRINUSE.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const envFile = path.join(root, '.env')
const webApi = path.join(root, 'projects', 'web-api')
const avenCeo = path.join(root, 'projects', 'aven-ceo')

/** Same OpenAI routing as root `package.json` → `dev:local`. */
const avenEnv = {
	...process.env,
	JAENSEN_OPENAI_API_KEY: 'local',
	JAENSEN_OPENAI_BASE_URL: 'http://box:8000/v1',
	JAENSEN_OPENAI_MODEL: 'minimax-m2.7-nvfp4'
}

/** Inherit stdin only once per process tree; multiple `inherit` readers can confuse TTY/Bun and exit early. */
const io = { stdout: 'inherit' as const, stderr: 'inherit' as const, stdin: 'ignore' as const }

/** macOS-friendly: ask `lsof` for PIDs on a port, then SIGKILL them. No-op if nothing's listening. */
async function freePort(port: number): Promise<void> {
	const lsof = Bun.spawn(['lsof', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
		stdout: 'pipe',
		stderr: 'ignore',
		stdin: 'ignore'
	})
	const out = await new Response(lsof.stdout).text()
	await lsof.exited
	const pids = out
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)
	if (pids.length === 0) return
	console.warn(`[dev-stack] freeing port ${port} (killing pids: ${pids.join(', ')})`)
	const kill = Bun.spawn(['kill', '-9', ...pids], { stdout: 'ignore', stderr: 'ignore' })
	await kill.exited
}

await Promise.all([freePort(7341), freePort(5173), freePort(8081)])

const vibeApps = path.join(root, 'libs', 'vibe-apps')
const vibeSandbox = path.join(root, 'libs', 'vibe-app-sandbox')

{
	const buildApps = Bun.spawn(['bun', 'run', 'build'], { cwd: vibeApps, ...io })
	const codeA = await buildApps.exited
	if (codeA !== 0) {
		console.error(`[dev-stack] @avenos/vibe-apps build failed with code ${codeA}`)
		process.exit(codeA ?? 1)
	}
	const buildSandbox = Bun.spawn(['bun', 'run', 'build'], { cwd: vibeSandbox, ...io })
	const codeS = await buildSandbox.exited
	if (codeS !== 0) {
		console.error(`[dev-stack] @avenos/vibe-app-sandbox build failed with code ${codeS}`)
		process.exit(codeS ?? 1)
	}
}

const children = [
	// `bun --env-file … run dev` is invalid (Bun prints `run` help and exits); use `run --env-file=…`.
	Bun.spawn(['bun', 'run', `--env-file=${envFile}`, 'dev'], {
		cwd: webApi,
		...io
	}),
	Bun.spawn(['bun', 'run', 'dev'], {
		cwd: avenCeo,
		env: avenEnv,
		...io
	}),
	// Spawn the sandbox HTTP server directly (no `bun run dev:sandbox` wrapper) so SIGTERM
	// reaches the actual Bun.serve process and releases :8081 cleanly.
	Bun.spawn(['bun', '--watch', 'sandbox/serve.ts'], {
		cwd: vibeSandbox,
		...io
	})
] as const

const labels = ['@jaensen/web-api', 'aven-ceo (dev:local)', 'mcp-sandbox'] as const

function shutdown() {
	for (const child of children) {
		try {
			child.kill('SIGTERM')
		} catch {
			// ignore
		}
	}
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
	process.on(sig, () => {
		shutdown()
		process.exit(0)
	})
}

const firstExit = await Promise.race(
	children.map(async (child, index) => {
		const exitCode = await child.exited
		return { index, exitCode }
	})
)

shutdown()
await Promise.all(children.map((c) => c.exited))

const label = labels[firstExit.index]
if (firstExit.exitCode !== 0) {
	console.error(
		`[dev-stack] ${label} exited with code ${firstExit.exitCode}; stopped other services.`
	)
} else {
	console.error(`[dev-stack] ${label} exited; stopped other services.`)
}
process.exit(firstExit.exitCode ?? 0)
