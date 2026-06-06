#!/usr/bin/env bun
/**
 * Mac App Store / TestFlight track: Apple Silicon `.app` (Tauri) + signed `.pkg` via `productbuild`.
 *
 * Optional: create **`<repo-root>/.env.apple.local`** from **`scripts/apple-env.local.template`** (quotes for paths with spaces; never commit — covered by `.gitignore` `.env.*`).
 *
 * Required env (after optional local file):
 *   AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS — absolute path to Mac App Store Connect `.provisionprofile`
 *   APPLE_SIGNING_IDENTITY — `codesign` identity (e.g. "Apple Distribution: … (TEAMID)")
 *   AVEN_PKG_INSTALLER_IDENTITY — `productbuild --sign` installer cert (e.g. "3rd Party Mac Developer Installer: …")
 *
 * Optional:
 *   AVEN_MAC_CF_BUNDLE_VERSION — CFBundleVersion for this upload (default "13")
 *   AVEN_OUTPUT_PKG — output path for the pkg (default dist/macos-appstore/avenOS-<version>-b<build>.pkg)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal } from './apple-env'
import { ensureOnnxruntimeDylib } from './fetch-onnxruntime.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'app')
const tauriDir = path.join(appDir, 'src-tauri')
const profileDest = path.join(tauriDir, 'profiles', 'mac-app-store.provisionprofile')

function mustEnv(name: string): string {
	const v = process.env[name]?.trim()
	if (!v) {
		console.error(`build-appstore-macos: missing required env ${name}`)
		process.exit(1)
	}
	return v
}

function readPackageVersion(): string {
	const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { version?: string }
	return (pkg.version ?? '0.0.0').trim()
}

function readCfBundleVersion(appPath: string): string | null {
	const plist = path.join(appPath, 'Contents/Info.plist')
	const r = spawnSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], {
		encoding: 'utf8',
	})
	if (r.status !== 0) return null
	return r.stdout.trim()
}

/** Tauri may bundle outside `src-tauri/target` when the environment redirects `CARGO_TARGET_DIR`. */
function resolveBuiltAppPath(
	buildLog: string,
	cargoTargetDir: string,
	tauriTarget: string,
	bundleVersion: string,
): string {
	const appName = 'avenOS.app'
	const rel = path.join(tauriTarget, 'release', 'bundle', 'macos', appName)
	const candidates = new Set<string>()

	for (const line of buildLog.split('\n')) {
		const finished = line.match(/Finished 1 bundle at:\s*(.+avenOS\.app)\s*$/)
		if (finished) candidates.add(finished[1].trim())
		const bundling = line.match(/Bundling avenOS\.app \((.+avenOS\.app)\)/)
		if (bundling) candidates.add(bundling[1].trim())
	}

	candidates.add(path.join(cargoTargetDir, rel))
	const redirected = process.env.CARGO_TARGET_DIR?.trim()
	if (redirected) candidates.add(path.join(redirected, rel))

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue
		const ver = readCfBundleVersion(candidate)
		if (ver === bundleVersion) {
			console.log(`[build-appstore-macos] packaging ${candidate} (CFBundleVersion=${ver})`)
			return candidate
		}
	}

	console.error(
		`build-appstore-macos: no signed .app with CFBundleVersion=${bundleVersion}. Checked:\n${[...candidates].map((p) => `  ${p}`).join('\n')}`,
	)
	process.exit(1)
}

async function main() {
	applyAppleEnvLocal(repoRoot)

	const profileSrc = mustEnv('AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS')
	const signId = mustEnv('APPLE_SIGNING_IDENTITY')
	const pkgSignId = mustEnv('AVEN_PKG_INSTALLER_IDENTITY')
	const bundleVersion = process.env.AVEN_MAC_CF_BUNDLE_VERSION?.trim() || '13'
	const version = readPackageVersion()
	console.log(
		'[build-appstore-macos] CFBundleVersion=%s (AVEN_MAC_CF_BUNDLE_VERSION or default 13)',
		bundleVersion,
	)

	mkdirSync(path.dirname(profileDest), { recursive: true })
	copyFileSync(profileSrc, profileDest)
	console.log(`[build-appstore-macos] copied provisioning profile → ${profileDest}`)

	// On-device LLM runtime: the onnxruntime dylib is bundled as a Tauri resource
	// (see tauri.conf.json `resources`). Ensure it's present before `tauri build`, else
	// generate_context! fails on the missing resource.
	const onnxDylib = ensureOnnxruntimeDylib('arm64')
	console.log('[build-appstore-macos] onnxruntime dylib provisioned')
	// Re-sign it with OUR distribution identity. It ships signed by Microsoft, and Tauri's
	// macOS signing is SHALLOW (it signs the main executable + the .app bundle, NOT nested
	// dylibs), so without this the dylib keeps Microsoft's signature and App Store Connect
	// rejects the build: "90238 Invalid signature … libonnxruntime.dylib: code failed to
	// satisfy specified code requirement(s)". Sign the SOURCE binary with hardened runtime
	// (to match the app) so Tauri copies the correctly-signed dylib into the bundle BEFORE it
	// seals the .app (which then hashes this signed dylib into a valid seal).
	const onnxSign = spawnSync(
		'codesign',
		['--force', '--options', 'runtime', '--timestamp', '--sign', signId, onnxDylib],
		{ stdio: 'inherit' },
	)
	if (onnxSign.status !== 0) {
		console.error('[build-appstore-macos] failed to codesign onnxruntime dylib')
		process.exit(onnxSign.status ?? 1)
	}
	console.log('[build-appstore-macos] re-signed onnxruntime dylib → distribution identity')

	mkdirSync(path.join(repoRoot, 'dist'), { recursive: true })
	const mergeDir = mkdtempSync(path.join(repoRoot, 'dist', 'macos-appstore-tmp-'))
	const mergePath = path.join(mergeDir, 'tauri.appstore.merge.json')
	const merge = {
		// Run `bun run build` once below — Tauri can invoke beforeBuildCommand more than once
		// during a single `tauri build`, which races hashed SvelteKit chunks vs generate_context!.
		build: {
			beforeBuildCommand: '',
		},
		bundle: {
			targets: ['app'],
			category: 'Productivity',
			macOS: {
				minimumSystemVersion: '12.0',
				bundleVersion,
				entitlements: 'Entitlements-appstore.plist',
				hardenedRuntime: true,
				signingIdentity: signId,
				infoPlist: 'Info.plist',
				files: {
					'embedded.provisionprofile': 'profiles/mac-app-store.provisionprofile',
				},
			},
		},
	}
	writeFileSync(mergePath, JSON.stringify(merge, null, 2), 'utf8')

	const tauriTarget = 'aarch64-apple-darwin'

	const tauriArgs = [
		'tauri',
		'build',
		'--ci',
		'-t',
		tauriTarget,
		'--bundles',
		'app',
		'--config',
		mergePath,
	]

	// App Store `.app` is signed with Apple Distribution — notarization needs Developer ID and
	// must not run here (Apple re-processes after Transporter upload). Strip API creds so Tauri skips it.
	const cargoTargetDir = path.join(repoRoot, 'target/rust')
	const tauriEnv = { ...process.env }
	delete tauriEnv.CARGO_TARGET_DIR
	for (const key of [
		'APPLE_API_ISSUER',
		'APPLE_API_KEY',
		'APPLE_API_KEY_PATH',
		'APPLE_ID',
		'APPLE_PASSWORD',
		'APPLE_TEAM_ID',
	]) {
		delete tauriEnv[key]
	}

	// Bake the sync relay URL into the release binary (read at compile time via
	// `option_env!("AVENOS_SERVER_WS_URL")` in app/src-tauri/src/jazz). Override by
	// exporting AVENOS_SERVER_WS_URL; defaults to the hosted aven-ceo relay.
	tauriEnv.AVENOS_SERVER_WS_URL =
		process.env.AVENOS_SERVER_WS_URL || 'wss://aven-ceo-bmrha.sprites.app/sync'

	const frontendBuild = spawnSync('bun', ['run', 'build'], {
		cwd: appDir,
		stdio: 'inherit',
		env: tauriEnv,
	})
	if (frontendBuild.status !== 0) {
		console.error('build-appstore-macos: frontend build failed')
		process.exit(frontendBuild.status ?? 1)
	}

	const br = spawnSync('bunx', ['--bun', ...tauriArgs], {
		cwd: appDir,
		stdio: 'inherit',
		env: tauriEnv,
	})
	if (br.status !== 0) {
		console.error('build-appstore-macos: tauri build failed')
		process.exit(br.status ?? 1)
	}

	// Live stdio — artifact path comes from CARGO_TARGET_DIR + known bundle layout (see resolveBuiltAppPath).
	const appPath = resolveBuiltAppPath('', cargoTargetDir, tauriTarget, bundleVersion)

	const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
		stdio: 'inherit',
	})
	if (verify.status !== 0) {
		console.warn(
			'[build-appstore-macos] codesign --verify failed (re-sign with entitlements if your pipeline requires it).',
		)
	}

	const distDir = path.join(repoRoot, 'dist', 'macos-appstore')
	mkdirSync(distDir, { recursive: true })
	const pkgOut =
		process.env.AVEN_OUTPUT_PKG?.trim() ||
		path.join(distDir, `avenOS-${version}-build${bundleVersion}.pkg`)

	const pb = spawnSync(
		'xcrun',
		[
			'productbuild',
			'--sign',
			pkgSignId,
			'--component',
			appPath,
			'/Applications',
			pkgOut,
		],
		{ stdio: 'inherit' },
	)
	if (pb.status !== 0) {
		console.error('build-appstore-macos: productbuild failed')
		process.exit(pb.status ?? 1)
	}

	try {
		rmSync(mergeDir, { recursive: true, force: true })
	} catch {
		// ignore cleanup errors (tmp lives under ignored dist area)
	}

	console.log(`[build-appstore-macos] done → ${pkgOut}`)
	console.log(
		'[build-appstore-macos] Upload preferred: bun run release:app:mac <N> — uses altool/App Store Connect API. Use Apple Transporter only as a GUI fallback if CLI upload fails.',
	)
}

void main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
