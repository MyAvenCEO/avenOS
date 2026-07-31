#!/usr/bin/env bun
/**
 * Shared Tauri desktop dev startup for macOS and Linux.
 *
 * Both platforms follow the same sequence: verify Rust, apply platform-native
 * prerequisites, free the Vite port, then run `tauri dev`.
 *
 * Card 0121 removed what used to sit in the middle of that: an auth server, a
 * sync relay, an onnxruntime download and a Polar webhook tunnel all had to come
 * up before the window could open, and any one of them failing took the app down
 * with it. avenCITY needs none of them, so `dev:app:mac` is now just the app.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeDevServerPort } from './free-dev-server-port.ts'
import { ensureLinuxNativeDeps } from './linux-native-deps.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bun = process.execPath
const bunDir = path.dirname(bun)
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

function desktopEnv(platform: DesktopPlatform): Record<string, string> {
	const env = { ...process.env } as Record<string, string>
	env.PATH = env.PATH?.split(path.delimiter).includes(bunDir)
		? env.PATH
		: [bunDir, env.PATH].filter(Boolean).join(path.delimiter)
	if (platform === 'linux') {
		// Fix blank/flickering WebKitGTK on Wayland + mesa drivers.
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

	console.log(
		`[${task}] avenCITY (${label}) · Host-UI: SvelteKit @ http://127.0.0.1:1420 (dev-only, embedded in ${webview})\n`
	)
	if (process.env.AVENOS_DEV_CLEAN_RUST === '1') {
		spawnSync(bun, ['./scripts/clean-app-tauri-target.ts'], { cwd: repoRoot, stdio: 'inherit' })
	}

	const child = Bun.spawn(
		[bun, `--env-file=${selectedEnvFileRelativeTo(appDir, env)}`, '--bun', 'x', 'tauri', 'dev'],
		{
			cwd: appDir,
			stdout: 'inherit',
			stderr: 'inherit',
			stdin: 'inherit',
			env
		}
	)

	const code = await child.exited
	process.exit(typeof code === 'number' ? code : 1)
}

if (import.meta.main) void runDesktopDev()
