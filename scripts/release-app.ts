#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
/**
 * Build + upload the AvenOS App Store artifacts in one command.
 *
 * The build number is a **positional argument** — Apple rejects duplicate `CFBundleVersion`
 * within a track, so passing it explicitly each time is the safest workflow.
 *
 * Usage:
 *   bun run release:app:all 14      # build + upload macOS .pkg AND iOS .ipa
 *   bun run release:app:mac 14      # macOS only
 *   bun run release:app:ios 14      # iOS only
 *
 * Or call directly:
 *   bun ./scripts/release-app.ts all 14
 *   bun ./scripts/release-app.ts ios 14 --no-upload     # build only, keep dist artifact
 *   bun ./scripts/release-app.ts ios --no-build         # upload latest dist artifact only
 *
 * Build number resolution (first non-empty wins):
 *   1. Positional argument                     (`release:app:mac 14` → "14")
 *   2. AVEN_BUILD_NUMBER env                   (shared)
 *   3. AVEN_MAC_/AVEN_IOS_CF_BUNDLE_VERSION    (per-target override)
 *   4. Built-in defaults inside per-target scripts (currently "13")
 *
 * Opt-out flags / env:
 *   --no-upload   or AVEN_NO_UPLOAD=1   → skip altool upload (build only, for local QA)
 *   --no-build    or AVEN_NO_BUILD=1    → skip build, just upload newest dist artifact
 *
 * Credentials are loaded by sub-scripts from `.env.apple.local` — no extra config here:
 *   build: APPLE_DEVELOPMENT_TEAM, APPLE_SIGNING_IDENTITY, AVEN_PKG_INSTALLER_IDENTITY,
 *          AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS, (iOS p12 or APPLE_API_*)
 *   upload: APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal } from './apple-env'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
applyAppleEnvLocal(repoRoot)

type Target = 'mac' | 'ios'

type TargetSpec = {
	target: Target
	/** `altool -t` value */
	altoolPlatform: 'macos' | 'ios'
	/** Build script under `scripts/` */
	buildScript: string
	/** Build-number env var the build script reads */
	bundleVersionEnv: 'AVEN_MAC_CF_BUNDLE_VERSION' | 'AVEN_IOS_CF_BUNDLE_VERSION'
	distDir: string
	artifactExt: '.pkg' | '.ipa'
}

const SPECS: Record<Target, TargetSpec> = {
	mac: {
		target: 'mac',
		altoolPlatform: 'macos',
		buildScript: 'build-appstore-macos.ts',
		bundleVersionEnv: 'AVEN_MAC_CF_BUNDLE_VERSION',
		distDir: path.join(repoRoot, 'dist', 'macos-appstore'),
		artifactExt: '.pkg'
	},
	ios: {
		target: 'ios',
		altoolPlatform: 'ios',
		buildScript: 'tauri-ios-asc.ts',
		bundleVersionEnv: 'AVEN_IOS_CF_BUNDLE_VERSION',
		distDir: path.join(repoRoot, 'dist', 'ios-appstore'),
		artifactExt: '.ipa'
	}
}

type ParsedArgs = {
	targets: Target[]
	buildNumber?: string
	skipBuild: boolean
	skipUpload: boolean
	/** `all` redeploys the relay (clean-slate sprite) by default; mac/ios never do. */
	deploySprite: boolean
}

function parseTarget(raw: string): Target[] {
	switch (raw.toLowerCase()) {
		case 'all':
			return ['mac', 'ios']
		case 'mac':
		case 'macos':
		case 'darwin':
			return ['mac']
		case 'ios':
		case 'iphone':
			return ['ios']
		default:
			console.error(`release-app: unknown target "${raw}". Use 'all', 'mac', or 'ios'.`)
			process.exit(1)
	}
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2)
	if (args.length === 0) {
		console.error(
			'release-app: missing target. Examples:\n  bun run release:app:all 14\n  bun run release:app:mac 14\n  bun run release:app:ios 14'
		)
		process.exit(1)
	}
	const positional: string[] = []
	let skipBuild = false
	let skipUpload = false
	let noSprite = false
	for (const a of args) {
		if (a === '--no-upload') skipUpload = true
		else if (a === '--no-build') skipBuild = true
		else if (a === '--no-sprite') noSprite = true
		else positional.push(a)
	}
	const isAll = positional[0]?.toLowerCase() === 'all'
	const targets = parseTarget(positional[0])
	const buildNumber = positional[1]?.trim() || undefined
	if (buildNumber && !/^\d+$/.test(buildNumber)) {
		console.error(
			`release-app: build number must be an integer (got "${buildNumber}"). Examples: 14, 27.`
		)
		process.exit(1)
	}
	if (process.env.AVEN_NO_UPLOAD?.trim()) skipUpload = true
	if (process.env.AVEN_NO_BUILD?.trim()) skipBuild = true
	if (process.env.AVEN_NO_SPRITE?.trim()) noSprite = true
	if (skipBuild && skipUpload) {
		console.error('release-app: --no-build and --no-upload together leave nothing to do.')
		process.exit(1)
	}
	return { targets, buildNumber, skipBuild, skipUpload, deploySprite: isAll && !noSprite }
}

function resolveBundleVersion(target: Target, positional?: string): string | undefined {
	if (positional) return positional
	const shared = process.env.AVEN_BUILD_NUMBER?.trim()
	const per =
		target === 'mac'
			? process.env.AVEN_MAC_CF_BUNDLE_VERSION?.trim()
			: process.env.AVEN_IOS_CF_BUNDLE_VERSION?.trim()
	return per || shared || undefined
}

function runScript(script: string, env: Record<string, string>): number {
	const r = spawnSync('bun', [path.join(repoRoot, 'scripts', script)], {
		cwd: repoRoot,
		stdio: 'inherit',
		env: { ...process.env, ...env }
	})
	return r.status ?? 1
}

function git(args: string[]): { status: number; out: string } {
	const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
	return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

/**
 * Push-from-main preflight for the clean-slate relay deploy. The Sprite rebuilds
 * aven-node from its own git checkout, so its SchemaHash matches the devices ONLY if
 * the exact commit we build the apps from is already on the remote it pulls. We
 * therefore require a clean tree (the apps build the working tree — uncommitted code
 * the Sprite can't reproduce would re-introduce the skew), then push HEAD and pin the
 * Sprite to that SHA. Returns the release commit to build everywhere.
 */
function gitPushPreflight(): string {
	const dirty = git(['status', '--porcelain'])
	if (dirty.out) {
		console.error(
			'[release-app] working tree is dirty — commit or stash first.\n' +
				'  The apps build the working tree; the Sprite rebuilds from a pushed commit. They must match.\n' +
				`  Uncommitted changes:\n${dirty.out}`
		)
		process.exit(1)
	}
	const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out
	const sha = git(['rev-parse', 'HEAD']).out
	if (!sha) {
		console.error('[release-app] could not resolve HEAD commit.')
		process.exit(1)
	}
	if (branch !== 'main') {
		console.warn(
			`[release-app] ⚠ releasing from "${branch}", not main. The Sprite will be pinned to ${sha.slice(0, 12)} regardless,\n` +
				'  but double-check this is the commit you mean to ship. (--no-sprite skips the relay + this push.)'
		)
	}
	console.log(
		`[release-app] pushing ${branch}@${sha.slice(0, 12)} so the Sprite can rebuild the same commit…`
	)
	const push = git(['push', 'origin', 'HEAD'])
	if (push.status !== 0) {
		console.error(
			`[release-app] git push failed — the Sprite would build a stale commit. Aborting.\n${push.out}`
		)
		process.exit(1)
	}
	// Confirm the remote actually has this commit before we rely on it.
	const onRemote = git(['branch', '-r', '--contains', sha])
	if (onRemote.status !== 0 || !onRemote.out) {
		console.error(
			`[release-app] ${sha.slice(0, 12)} is not on any remote branch after push. Aborting.`
		)
		process.exit(1)
	}
	console.log(`[release-app] ✓ ${sha.slice(0, 12)} is on the remote.`)
	return sha
}

/** Clean-slate relay: rebuild aven-node @ releaseSha on the Sprite, wipe its store, restart. */
function deploySpriteCleanSlate(releaseSha: string): number {
	console.log('\n[release-app] ─── SPRITE (clean slate) ───')
	const r = spawnSync(
		'bun',
		['--env-file=.env', path.join(repoRoot, 'scripts', 'deploy-aven-node-sprite.ts')],
		{
			cwd: repoRoot,
			stdio: 'inherit',
			env: { ...process.env, WIPE: '1', AVEN_SERVER_BUILD_REF: releaseSha }
		}
	)
	return r.status ?? 1
}

function newestArtifact(spec: TargetSpec): string | undefined {
	if (!existsSync(spec.distDir)) return undefined
	const candidates = readdirSync(spec.distDir)
		.filter((f) => f.endsWith(spec.artifactExt))
		.map((f) => {
			const full = path.join(spec.distDir, f)
			return { full, mtime: statSync(full).mtimeMs }
		})
		.sort((a, b) => b.mtime - a.mtime)
	return candidates[0]?.full
}

function mustEnv(name: string): string {
	const v = process.env[name]?.trim()
	if (!v) {
		console.error(
			`release-app: missing ${name} — set in shell or .env.apple.local (see scripts/apple-env.local.template).`
		)
		process.exit(1)
	}
	return v
}

function uploadOne(spec: TargetSpec, file: string): number {
	const apiKey = mustEnv('APPLE_API_KEY')
	const apiIssuer = mustEnv('APPLE_API_ISSUER')
	const apiKeyPath = mustEnv('APPLE_API_KEY_PATH')
	if (!existsSync(apiKeyPath)) {
		console.error(`release-app: APPLE_API_KEY_PATH does not exist: ${apiKeyPath}`)
		return 1
	}
	const expectedBasename = `AuthKey_${apiKey}.p8`
	const actualBasename = path.basename(apiKeyPath)
	if (actualBasename !== expectedBasename) {
		console.warn(
			`release-app: APPLE_API_KEY_PATH basename "${actualBasename}" does not match expected "${expectedBasename}" — altool may not find the key.`
		)
	}

	console.log(
		`[release-app] ${spec.target} → App Store Connect (${path.basename(file)}, ${(statSync(file).size / 1_000_000).toFixed(1)} MB)`
	)

	const r = spawnSync(
		'xcrun',
		[
			'altool',
			'--upload-app',
			'--file',
			file,
			'--type',
			spec.altoolPlatform,
			'--apiKey',
			apiKey,
			'--apiIssuer',
			apiIssuer,
			'--output-format',
			'normal'
		],
		{
			cwd: repoRoot,
			stdio: 'inherit',
			env: {
				...process.env,
				// altool searches `./private_keys`, `~/private_keys`, `~/.private_keys`,
				// `~/.appstoreconnect/private_keys`; override so the .p8 can live anywhere.
				API_PRIVATE_KEYS_DIR: path.dirname(apiKeyPath)
			}
		}
	)
	return r.status ?? 1
}

function fmtSecs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`
}

type StepResult = {
	target: Target
	build: string | 'default' | 'skipped'
	buildSecs?: string
	uploadSecs?: string
	uploaded: boolean
	ok: boolean
}

function main(): void {
	const { targets, buildNumber, skipBuild, skipUpload, deploySprite } = parseArgs()

	// Push-from-main BEFORE any long build so a dirty tree / failed push aborts fast and
	// the relay is guaranteed to rebuild the exact commit the apps build.
	let releaseSha: string | undefined
	if (deploySprite) {
		releaseSha = gitPushPreflight()
		console.log(
			'[release-app] relay clean-slate ON → after apps upload, the Sprite rebuilds @ this commit, wipes its store, restarts.'
		)
	} else {
		console.log('[release-app] --no-sprite (or non-all target) → relay untouched, no git push.')
	}

	if (buildNumber) {
		console.log(
			`[release-app] build number = ${buildNumber} (positional arg, applied to all selected targets)`
		)
	} else if (process.env.AVEN_BUILD_NUMBER?.trim()) {
		console.log(
			`[release-app] build number = ${process.env.AVEN_BUILD_NUMBER.trim()} (AVEN_BUILD_NUMBER)`
		)
	} else if (!skipBuild) {
		console.warn(
			'[release-app] no build number passed (positional arg or AVEN_BUILD_NUMBER) — falling back to per-script defaults. Apple will reject duplicate CFBundleVersion.'
		)
	}
	if (skipBuild)
		console.log('[release-app] --no-build → skipping build, uploading newest dist artifact')
	if (skipUpload) console.log('[release-app] --no-upload → skipping App Store Connect upload')

	const started = Date.now()
	const results: StepResult[] = []

	for (const target of targets) {
		const spec = SPECS[target]
		console.log(`\n[release-app] ─── ${target.toUpperCase()} ───`)

		let artifactPath: string | undefined
		let buildSecs: string | undefined
		let buildLabel: string | 'default' | 'skipped' = 'default'

		if (skipBuild) {
			buildLabel = 'skipped'
			artifactPath = newestArtifact(spec)
			if (!artifactPath) {
				console.error(
					`[release-app] --no-build set but no ${spec.artifactExt} in ${spec.distDir}. Build first or drop --no-build.`
				)
				process.exit(1)
			}
			console.log(`[release-app] using existing artifact: ${artifactPath}`)
		} else {
			const resolved = resolveBundleVersion(target, buildNumber)
			buildLabel = resolved ?? 'default'
			const env: Record<string, string> = {}
			if (resolved) env[spec.bundleVersionEnv] = resolved
			const tBuild = Date.now()
			const buildStatus = runScript(spec.buildScript, env)
			buildSecs = fmtSecs(Date.now() - tBuild)
			if (buildStatus !== 0) {
				results.push({ target, build: buildLabel, buildSecs, uploaded: false, ok: false })
				console.error(
					`[release-app] ${target} build failed after ${buildSecs} (exit ${buildStatus})`
				)
				process.exit(buildStatus)
			}
			console.log(`[release-app] ${target} build done in ${buildSecs}`)
			artifactPath = newestArtifact(spec)
			if (!artifactPath) {
				console.error(
					`[release-app] build succeeded but no ${spec.artifactExt} found in ${spec.distDir}`
				)
				process.exit(1)
			}
		}

		let uploadSecs: string | undefined
		let uploaded = false
		if (!skipUpload) {
			const tUpload = Date.now()
			const status = uploadOne(spec, artifactPath)
			uploadSecs = fmtSecs(Date.now() - tUpload)
			if (status !== 0) {
				results.push({
					target,
					build: buildLabel,
					buildSecs,
					uploadSecs,
					uploaded: false,
					ok: false
				})
				console.error(`[release-app] ${target} upload failed after ${uploadSecs} (exit ${status})`)
				process.exit(status)
			}
			uploaded = true
			console.log(`[release-app] ${target} upload accepted in ${uploadSecs}`)
		}

		results.push({ target, build: buildLabel, buildSecs, uploadSecs, uploaded, ok: true })
	}

	// Relay last: the apps are uploaded, so a relay failure here doesn't strand a
	// half-done release — and we never wipe the prod Sprite before the apps are in.
	if (deploySprite && releaseSha) {
		const status = deploySpriteCleanSlate(releaseSha)
		if (status !== 0) {
			console.error(
				`[release-app] ✗ sprite clean-slate deploy failed (exit ${status}).\n` +
					'  Apps are uploaded but the relay was NOT redeployed — it may still hold the old schema.\n' +
					`  Re-run just the relay:  WIPE=1 AVEN_SERVER_BUILD_REF=${releaseSha} bun run deploy:server:sprite`
			)
			process.exit(status)
		}
		console.log('[release-app] ✓ sprite redeployed clean @ release commit.')
	}

	console.log(`\n[release-app] all targets done in ${fmtSecs(Date.now() - started)}`)
	for (const r of results) {
		const parts: string[] = []
		if (r.buildSecs) parts.push(`build ${r.buildSecs}`)
		if (r.uploadSecs) parts.push(`upload ${r.uploadSecs}`)
		const flag = r.uploaded ? '↑ uploaded' : skipUpload ? '  built only' : '  built'
		console.log(
			`  ${r.ok ? '✓' : '✗'} ${r.target.padEnd(4)} build=${String(r.build).padEnd(7)} ${flag.padEnd(13)} ${parts.join(' + ') || '—'}`
		)
	}
	if (results.some((r) => r.uploaded)) {
		console.log(
			'\nTestFlight processing typically takes 5–30 min. Check status:\n  · https://appstoreconnect.apple.com/apps  →  TestFlight tab'
		)
	}
}

main()
