#!/usr/bin/env bun
/**
 * Provision the onnxruntime shared library the on-device LLM (`aven-ai/llm` via
 * `ort`) loads at runtime. `ort` 2.0.0-rc.12 targets onnxruntime **1.24.2**
 * (ORT_API_VERSION 24), so we fetch that exact version from Microsoft's official
 * GitHub release (a standard gzip tar) — a mismatched version makes `GetApi(24)`
 * return null and init fails.
 *
 * The shared library is *code*, so on iOS it must ship inside the signed app bundle
 * (never downloaded at runtime — App Store rule); only the model *weights* download
 * at first run. On desktop dev we drop it next to the crate and point the app at it
 * via `AVENOS_ORT_DYLIB` (see `app/src-tauri/src/llm.rs::resolve_dylib`).
 *
 * Usage: `bun ./scripts/fetch-onnxruntime.ts [arch]`   arch ∈ arm64 (default) | x86_64
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ORT_ONNXRUNTIME_VERSION = '1.24.2'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(repoRoot, 'app', 'src-tauri', 'onnxruntime')
// Keep the historic bundled filename stable across desktop targets. On Linux we
// copy the ELF shared object bytes into this path so Tauri resources + existing
// runtime lookup keep working without per-platform config branching.
const BUNDLED_LIB_PATH = path.join(OUT_DIR, 'libonnxruntime.dylib')

type DesktopArch = 'arm64' | 'x86_64'
type DesktopPlatform = 'darwin' | 'linux'

function releaseArch(platform: DesktopPlatform, arch: DesktopArch): string {
	if (platform === 'linux') return arch === 'x86_64' ? 'x64' : 'aarch64'
	return arch
}

function currentDesktopPlatform(): DesktopPlatform {
	if (process.platform === 'darwin' || process.platform === 'linux') return process.platform
	throw new Error(`onnxruntime provisioning unsupported on ${process.platform}`)
}

/** Microsoft GitHub release asset url for a desktop target. */
function distUrl(platform: DesktopPlatform, arch: DesktopArch): string {
	const v = ORT_ONNXRUNTIME_VERSION
	if (platform === 'darwin') {
		return `https://github.com/microsoft/onnxruntime/releases/download/v${v}/onnxruntime-osx-${arch}-${v}.tgz`
	}
	return `https://github.com/microsoft/onnxruntime/releases/download/v${v}/onnxruntime-linux-${releaseArch(platform, arch)}-${v}.tgz`
}

export function onnxruntimeDylibPath(): string {
	return BUNDLED_LIB_PATH
}

/** Ensure the desktop runtime exists; download+extract if missing. Returns its bundled path. */
export function ensureOnnxruntimeDylib(arch: DesktopArch = 'arm64'): string {
	if (fs.existsSync(BUNDLED_LIB_PATH)) return BUNDLED_LIB_PATH

	const platform = currentDesktopPlatform()
	fs.mkdirSync(OUT_DIR, { recursive: true })
	const tmp = path.join(os.tmpdir(), `onnxruntime-${platform}-${ORT_ONNXRUNTIME_VERSION}-${arch}.tgz`)
	const url = distUrl(platform, arch)
	console.log(`[onnxruntime] downloading ${url}`)

	const dl = spawnSync('curl', ['-fsSL', '-o', tmp, url], { stdio: 'inherit' })
	if (dl.status !== 0) throw new Error(`onnxruntime download failed (curl exit ${dl.status})`)

	const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-extract-'))
	const ex = spawnSync('tar', ['-xzf', tmp, '-C', extractDir], { stdio: 'inherit' })
	if (ex.status !== 0) throw new Error(`onnxruntime extract failed (tar exit ${ex.status})`)

	const found = findRuntimeLib(extractDir)
	if (!found) throw new Error(`no onnxruntime shared library found inside ${url}`)
	// copyFileSync dereferences the source symlink (`libonnxruntime.so` / `.dylib`) so
	// the bundled file is always a plain file at a stable path.
	fs.copyFileSync(found, BUNDLED_LIB_PATH)
	fs.rmSync(extractDir, { recursive: true, force: true })
	fs.rmSync(tmp, { force: true })
	console.log(`[onnxruntime] installed → ${BUNDLED_LIB_PATH}`)
	return BUNDLED_LIB_PATH
}

/**
 * Prefer the canonical `lib/libonnxruntime.{dylib,so}`; skip `.dSYM` debug bundles
 * (which contain a same-named non-loadable file on macOS).
 */
function findRuntimeLib(dir: string): string | undefined {
	let fallback: string | undefined
	const walk = (d: string) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			if (entry.name.endsWith('.dSYM')) continue
			const p = path.join(d, entry.name)
			if (entry.isDirectory()) walk(p)
			else if (entry.name === 'libonnxruntime.dylib') fallback ??= p
			else if (entry.name === 'libonnxruntime.so') fallback ??= p
			else if (/^libonnxruntime\.so\./.test(entry.name)) fallback ??= p
			else if (/^libonnxruntime.*\.dylib$/.test(entry.name)) fallback ??= p
		}
	}
	walk(dir)
	return fallback
}

// CLI entry.
if (import.meta.main) {
	const arch = (process.argv[2] as DesktopArch) ?? 'arm64'
	const p = ensureOnnxruntimeDylib(arch)
	console.log(`\nAVENOS_ORT_DYLIB=${p}`)
}
