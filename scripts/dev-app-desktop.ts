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

function authPort(env: Record<string, string>): number {
	return Number(new URL(env.BETTER_AUTH_URL ?? env.PUBLIC_BETTER_AUTH_URL).port || 8787)
}

async function startAuthService(env: Record<string, string>) {
	const port = authPort(env)
	freeDevServerPort(port)
	console.log(`[auth] Starting Better Auth on ${env.PUBLIC_BETTER_AUTH_URL}`)
	const auth = Bun.spawn([bun, '--env-file=../../.env', 'src/server.ts'], {
		cwd: authDir,
		stdout: 'inherit',
		stderr: 'inherit',
		env
	})
	await waitForPort(port, 60_000)
	console.log(`[auth] Better Auth ready on ${env.PUBLIC_BETTER_AUTH_URL}`)
	return auth
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

	// Start/resolve the sync relay so the invite gate opens consistently on every
	// desktop target. If AVENOS_SERVER_WS_URL is exported, this dials that remote
	// relay instead of spawning a local one.
	const auth = await startAuthService(env)
	const { server, wsUrl } = await startSyncRelay(env)
	env.AVENOS_SERVER_WS_URL = wsUrl

	const child = Bun.spawn(
		[bun, '--env-file=../.env', '--bun', 'x', 'tauri', 'dev', '--features', 'desktop-ai'],
		{
			cwd: path.join(repoRoot, 'app'),
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env
		}
	)

	const shutdown = () => {
		auth.kill('SIGTERM')
		server?.kill('SIGTERM')
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)

	const code = await child.exited
	shutdown()
	process.exit(typeof code === 'number' ? code : 1)
}

if (import.meta.main) void runDesktopDev()
