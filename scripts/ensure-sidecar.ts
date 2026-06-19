#!/usr/bin/env bun
/**
 * Build the .NET stdio sidecar (`Aven.Sidecar`) for desktop DEV and return the env the
 * Tauri Rust manager uses to locate it (milestone plan M9 — packaging decision: dev runs
 * the framework-dependent dll via `dotnet`; release publishes a self-contained binary).
 *
 * Best-effort: if `dotnet` is missing or the build fails, the app still runs in
 * `current-cloud` mode — the sidecar is simply unavailable (its commands return a clear
 * `runtime_not_ready`/`startup_failed`).
 *
 * Sets:
 *   AVEN_SIDECAR_DLL         → absolute path to the built Aven.Sidecar.dll (dev path)
 *   AVEN_SIDECAR_CONFIG_DIR  → the .NET solution dir (so appsettings.* + LLM config load)
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function ensureSidecar(repoRoot: string, env: Record<string, string>): void {
	const solutionDir = path.join(repoRoot, 'sidecars', 'AkkaAgent2')
	const csproj = path.join(solutionDir, 'Aven', 'src', 'Aven.Sidecar', 'Aven.Sidecar.csproj')

	// Config dir is useful even if the build is skipped (env-only provider config still works).
	env.AVEN_SIDECAR_CONFIG_DIR ??= solutionDir

	if (!fs.existsSync(csproj)) {
		console.warn(
			`[sidecar] ${csproj} not found; .NET sidecar unavailable (app runs in current-cloud mode)`
		)
		return
	}

	const dotnet = spawnSync('dotnet', ['--version'], { encoding: 'utf8' })
	if (dotnet.status !== 0) {
		console.warn(
			'[sidecar] `dotnet` not found; .NET sidecar unavailable (app runs in current-cloud mode)'
		)
		return
	}

	const outDir = path.join(repoRoot, 'target', 'sidecar', 'debug')
	console.log('[sidecar] building Aven.Sidecar (dev)…')
	const build = spawnSync(
		'dotnet',
		['build', csproj, '-c', 'Debug', '-o', outDir, '--nologo', '-v', 'quiet'],
		{ cwd: repoRoot, stdio: 'inherit' }
	)
	if (build.status !== 0) {
		console.warn(
			'[sidecar] build failed; .NET sidecar unavailable (app runs in current-cloud mode)'
		)
		return
	}

	const dll = path.join(outDir, 'Aven.Sidecar.dll')
	if (!fs.existsSync(dll)) {
		console.warn(`[sidecar] build succeeded but ${dll} not found; sidecar unavailable`)
		return
	}

	env.AVEN_SIDECAR_DLL = dll
	console.log(`[sidecar] ready: AVEN_SIDECAR_DLL=${dll}`)
}
