#!/usr/bin/env bun
/**
 * Shared Tauri desktop dev startup for macOS and Linux.
 *
 * Both platforms follow the same sequence: verify Rust, apply platform-native
 * prerequisites/defaults, free the Vite port, provision onnxruntime, optionally
 * clean Rust artifacts, start/resolve the sync relay, then run `tauri dev`.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startSyncRelay, waitForPort } from './aven-server.ts'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'
import { freeDevServerPort } from './free-dev-server-port.ts'
import { ensureLinuxNativeDeps } from './linux-native-deps.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bun = process.execPath
const bunDir = path.dirname(bun)
const authDir = path.join(repoRoot, 'libs', 'betterauth')
const appDir = path.join(repoRoot, 'app')

type DesktopPlatform = 'darwin' | 'linux'

const PLATFORM: Record<DesktopPlatform, { task: string; label: string; webview: string }> = {
	darwin: { task: 'dev:app:macos', label: 'macOS', webview: 'WKWebView' },
	linux: { task: 'dev:app:linux', label: 'Linux', webview: 'WebKitGTK' }
}

function currentDesktopPlatform(): DesktopPlatform {
	if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
	throw new Error(`desktop Tauri dev startup is unsupported on ${process.platform}`)
}

function currentDesktopArch(): 'arm64' | 'x86_64' {
	return process.arch === 'x64' ? 'x86_64' : 'arm64'
}

function desktopEnv(platform: DesktopPlatform): Record<string, string> {
	const env = { ...process.env } as Record<string, string>
	env.PATH = env.PATH?.split(path.delimiter).includes(bunDir)
		? env.PATH
		: [bunDir, env.PATH].filter(Boolean).join(path.delimiter)
	env.PUBLIC_BETTER_AUTH_URL ??= env.BETTER_AUTH_URL ?? 'http://localhost:8787'
	if (platform === 'linux') {
		// Fix blank/flickering WKWebView on Wayland + mesa drivers.
		env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1'
		// Fix broken compositing on some older Intel GPUs / nouveau.
		env.WEBKIT_DISABLE_COMPOSITING_MODE ??= '1'
	}
	return env
}

function selectedEnvFileRelativeTo(cwd: string, env: Record<string, string>): string {
	const selected = env.AVENOS_ENV_FILE?.trim() || '.env'
	const absolute = path.isAbsolute(selected) ? selected : path.join(repoRoot, selected)
	return path.relative(cwd, absolute)
}

function authPort(env: Record<string, string>): number {
	return Number(new URL(env.BETTER_AUTH_URL ?? env.PUBLIC_BETTER_AUTH_URL).port || 8787)
}

async function startAuthService(env: Record<string, string>) {
	const port = authPort(env)
	freeDevServerPort(port)
	console.log(`[auth] Starting Better Auth on ${env.PUBLIC_BETTER_AUTH_URL}`)
	// `--watch` so edits to the auth server (routes, context providers, etc.) hot-reload in dev instead of
	// serving stale boot-time code until a full app restart. board 0110.
	const auth = Bun.spawn(
		[bun, `--env-file=${selectedEnvFileRelativeTo(authDir, env)}`, '--watch', 'src/server.ts'],
		{
			cwd: authDir,
			stdout: 'inherit',
			stderr: 'inherit',
			env
		}
	)
	await waitForPort(port, 60_000)
	console.log(`[auth] Better Auth ready on ${env.PUBLIC_BETTER_AUTH_URL}`)
	return auth
}

/**
 * Auto-start the Polar webhook tunnel for SANDBOX dev so subscription changes sync
 * server-side (frontend-independent), exactly like production. `polar listen` relays the
 * org's webhooks to our local `/api/billing/webhook` and prints a per-session secret, which
 * we capture and inject as `POLAR_WEBHOOK_SECRET` into `env` BEFORE the auth server boots.
 *
 * Best-effort + non-blocking — it skips (with a hint) and dev continues normally when:
 *   - the `polar` CLI isn't installed or you haven't run `polar login`,
 *   - Polar isn't configured (no POLAR_API_KEY),
 *   - we're not in sandbox (we never tunnel a production org from a dev box),
 *   - a POLAR_WEBHOOK_SECRET is already set (an explicit tunnel/endpoint wins),
 *   - or `AVENOS_POLAR_LISTEN=0` is set (opt-out).
 * Without the tunnel the app still reconciles on checkout return via `/api/billing/sync`.
 */
async function startPolarWebhookTunnel(
	env: Record<string, string>
): Promise<ReturnType<typeof Bun.spawn> | null> {
	if (env.AVENOS_POLAR_LISTEN === '0') return null
	if (!env.POLAR_API_KEY) return null
	if (env.POLAR_SERVER !== 'sandbox') return null
	if (env.POLAR_WEBHOOK_SECRET) return null
	if (spawnSync('polar', ['--version'], { encoding: 'utf8' }).status !== 0) {
		console.warn(
			'[polar] `polar` CLI not found — webhook tunnel skipped. Install once with ' +
				'`bun run setup:polar` (or `curl -fsSL https://polar.sh/install.sh | bash`), then ' +
				'`polar login` and choose Sandbox. ' +
				'(Subscriptions still reconcile via /api/billing/sync on checkout return.)'
		)
		return null
	}

	const webhookUrl = `${env.BETTER_AUTH_URL ?? 'http://localhost:8787'}/api/billing/webhook`
	console.log(`[polar] Starting webhook tunnel → ${webhookUrl}`)
	const child = Bun.spawn(['polar', 'listen', webhookUrl], {
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'pipe', // we drive the interactive pickers below; stdin stays OPEN afterwards
		env
	})

	const reader = (child.stdout as ReadableStream<Uint8Array>).getReader()
	const decoder = new TextDecoder()
	// Strip ANSI/CSI control sequences so the colorized "Secret <token>" line matches.
	const ansiRe = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g')
	const stripAnsi = (s: string): string => s.replace(ansiRe, '')
	// Bound the wait: if no secret arrives (e.g. not logged in), kill the tunnel so the
	// stdout stream ends, the read loop breaks, and dev proceeds without it.
	const timeout = setTimeout(() => child.kill(), 20_000)
	let buf = ''
	let secret: string | null = null

	// `polar listen` shows two interactive pickers — Environment (→ Sandbox) then Organization
	// (→ the first/only org) — before printing the secret. Drive them by pressing Enter a few
	// times; both default to the right choice for a sandbox login with a single org. stdin
	// stays OPEN (never .end()) so the tunnel keeps running. Multi-org users can instead run
	// `polar listen …/api/billing/webhook` themselves and set POLAR_WEBHOOK_SECRET by hand.
	void (async () => {
		for (let i = 0; i < 6; i++) {
			if (secret) break
			try {
				child.stdin.write('\n')
				child.stdin.flush()
			} catch {
				break
			}
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	})()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) continue
			process.stdout.write(value) // mirror tunnel output to the console
			buf += decoder.decode(value, { stream: true })
			const match = stripAnsi(buf).match(/Secret\s+(\S+)/)
			if (match) {
				secret = match[1]
				break
			}
		}
	} catch {
		/* stream closed */
	}
	clearTimeout(timeout)

	if (!secret) {
		console.warn('[polar] webhook tunnel produced no secret (run `polar login`?) — skipping.')
		child.kill()
		return null
	}
	env.POLAR_WEBHOOK_SECRET = secret
	console.log('[polar] webhook tunnel ready — POLAR_WEBHOOK_SECRET captured for this session.')
	// Keep draining stdout for the tunnel's lifetime so the pipe never fills and blocks it.
	void (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				if (value) process.stdout.write(value)
			}
		} catch {
			/* closed on shutdown */
		}
	})()
	return child
}

export async function runDesktopDev(requestedPlatform = currentDesktopPlatform()) {
	const platform = requestedPlatform
	const { task, label, webview } = PLATFORM[platform]
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
	if (cargo.status !== 0) {
		console.error(`${task}: \`cargo\` not found. Install Rust from https://rustup.rs`)
		process.exit(1)
	}

	if (platform === 'linux') ensureLinuxNativeDeps(task)

	freeDevServerPort(1420)

	const env = desktopEnv(platform)
	try {
		env.AVENOS_ORT_DYLIB = ensureOnnxruntimeDylib(currentDesktopArch())
	} catch (e) {
		console.warn(
			`[${task}] onnxruntime provisioning skipped: ${e instanceof Error ? e.message : e}`
		)
	}

	console.log(
		`[${task}] AvenOS Tauri (${label}) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in ${webview})\n`
	)
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync(bun, ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	// Auto-start the Polar webhook tunnel (sandbox only) and inject the per-session secret
	// into `env` BEFORE the auth server boots, so subscription changes sync server-side just
	// like production. No-op + hint when the CLI/login/sandbox prerequisites aren't met.
	const polarTunnel = await startPolarWebhookTunnel(env)

	// Start/resolve the sync relay so the invite gate opens consistently on every
	// desktop target. If AVENOS_SERVER_WS_URL is exported, this dials that remote
	// relay instead of spawning a local one.
	const auth = await startAuthService(env)
	const { server, wsUrl } = await startSyncRelay(env)
	env.AVENOS_SERVER_WS_URL = wsUrl

	const child = Bun.spawn(
		[
			bun,
			`--env-file=${selectedEnvFileRelativeTo(appDir, env)}`,
			'--bun',
			'x',
			'tauri',
			'dev',
			'--features',
			'desktop-ai'
		],
		{
			cwd: appDir,
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env
		}
	)

	const shutdown = () => {
		auth.kill('SIGTERM')
		server?.kill('SIGTERM')
		polarTunnel?.kill()
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)

	const code = await child.exited
	shutdown()
	process.exit(typeof code === 'number' ? code : 1)
}

if (import.meta.main) void runDesktopDev()
