#!/usr/bin/env bun
/**
 * Provision the onnxruntime shared library the on-device LLM (`aven-ai/llm` via
 * `ort`) loads at runtime. `ort` 2.0.0-rc.12 targets onnxruntime **1.24.2**
 * (ORT_API_VERSION 24), so we fetch that exact version from Microsoft's official
 * GitHub release (a standard gzip tar) — a mismatched version makes `GetApi(24)`
 * return null and init fails.
 *
 * The dylib is *code*, so on iOS it must ship inside the signed app bundle (never
 * downloaded at runtime — App Store rule); only the model *weights* download at
 * first run. On macOS dev we drop it next to the crate and point the app at it via
 * `AVENOS_ORT_DYLIB` (see `app/src-tauri/src/llm.rs::resolve_dylib`).
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
const DYLIB_PATH = path.join(OUT_DIR, 'libonnxruntime.dylib')

/** Microsoft GitHub release asset url for a macOS arch. */
function distUrl(arch: 'arm64' | 'x86_64'): string {
	const v = ORT_ONNXRUNTIME_VERSION
	return `https://github.com/microsoft/onnxruntime/releases/download/v${v}/onnxruntime-osx-${arch}-${v}.tgz`
}

export function onnxruntimeDylibPath(): string {
	return DYLIB_PATH
}

/** Ensure the macOS dylib exists; download+extract if missing. Returns its path. */
export function ensureOnnxruntimeDylib(arch: 'arm64' | 'x86_64' = 'arm64'): string {
	if (fs.existsSync(DYLIB_PATH)) return DYLIB_PATH

	fs.mkdirSync(OUT_DIR, { recursive: true })
	const tmp = path.join(os.tmpdir(), `onnxruntime-${ORT_ONNXRUNTIME_VERSION}-${arch}.tgz`)
	const url = distUrl(arch)
	console.log(`[onnxruntime] downloading ${url}`)

	const dl = spawnSync('curl', ['-fsSL', '-o', tmp, url], { stdio: 'inherit' })
	if (dl.status !== 0) throw new Error(`onnxruntime download failed (curl exit ${dl.status})`)

	const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-extract-'))
	const ex = spawnSync('tar', ['-xzf', tmp, '-C', extractDir], { stdio: 'inherit' })
	if (ex.status !== 0) throw new Error(`onnxruntime extract failed (tar exit ${ex.status})`)

	const found = findDylib(extractDir)
	if (!found) throw new Error(`no libonnxruntime dylib found inside ${url}`)
	// copyFileSync dereferences the `libonnxruntime.dylib` → versioned symlink.
	fs.copyFileSync(found, DYLIB_PATH)
	fs.rmSync(extractDir, { recursive: true, force: true })
	fs.rmSync(tmp, { force: true })
	console.log(`[onnxruntime] installed → ${DYLIB_PATH}`)
	return DYLIB_PATH
}

/**
 * Prefer the canonical `lib/libonnxruntime.dylib`; skip `.dSYM` debug bundles
 * (which contain a same-named non-loadable file).
 */
function findDylib(dir: string): string | undefined {
	let fallback: string | undefined
	const walk = (d: string) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			if (entry.name.endsWith('.dSYM')) continue
			const p = path.join(d, entry.name)
			if (entry.isDirectory()) walk(p)
			else if (entry.name === 'libonnxruntime.dylib') fallback ??= p
			else if (/^libonnxruntime.*\.dylib$/.test(entry.name)) fallback ??= p
		}
	}
	walk(dir)
	return fallback
}

// CLI entry.
if (import.meta.main) {
	const arch = (process.argv[2] as 'arm64' | 'x86_64') ?? 'arm64'
	const p = ensureOnnxruntimeDylib(arch)
	console.log(`\nAVENOS_ORT_DYLIB=${p}`)
}
