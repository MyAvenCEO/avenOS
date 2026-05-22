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
 *   AVEN_MAC_CF_BUNDLE_VERSION — CFBundleVersion for this upload (default "4")
 *   GENESIS_NETWORK_ID — optional override; else read from repo `.env` (see resolveGenesisNetworkId)
 *   AVEN_OUTPUT_PKG — output path for the pkg (default dist/macos-appstore/avenOS-<version>-b<build>.pkg)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal, resolveGenesisNetworkId } from './apple-env'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

applyAppleEnvLocal(repoRoot)
const appDir = path.join(repoRoot, 'lib/app')
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

function main() {
	const profileSrc = mustEnv('AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS')
	const signId = mustEnv('APPLE_SIGNING_IDENTITY')
	const pkgSignId = mustEnv('AVEN_PKG_INSTALLER_IDENTITY')
	const bundleVersion = process.env.AVEN_MAC_CF_BUNDLE_VERSION?.trim() || '4'
	const version = readPackageVersion()

	const genesisNetworkId = resolveGenesisNetworkId(repoRoot)
	if (!genesisNetworkId) {
		console.error(
			'build-appstore-macos: missing GENESIS_NETWORK_ID — set in shell, .env.apple.local, or repo .env (GENESIS_NETWORK_ID or DEV_GENESIS_NETWORK_ID)',
		)
		process.exit(1)
	}

	mkdirSync(path.dirname(profileDest), { recursive: true })
	copyFileSync(profileSrc, profileDest)
	console.log(`[build-appstore-macos] copied provisioning profile → ${profileDest}`)

	mkdirSync(path.join(repoRoot, 'dist'), { recursive: true })
	const mergeDir = mkdtempSync(path.join(repoRoot, 'dist', 'macos-appstore-tmp-'))
	const mergePath = path.join(mergeDir, 'tauri.appstore.merge.json')
	const merge = {
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
	const cargoTargetDir = path.join(tauriDir, 'target')
	const tauriEnv = { ...process.env, GENESIS_NETWORK_ID: genesisNetworkId }
	delete tauriEnv.CARGO_TARGET_DIR
	tauriEnv.CARGO_TARGET_DIR = cargoTargetDir
	console.log('[build-appstore-macos] embedding GENESIS_NETWORK_ID at compile time')
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

	const br = spawnSync('bunx', ['--bun', ...tauriArgs], {
		cwd: appDir,
		encoding: 'utf8',
		env: tauriEnv,
	})
	if (br.stdout) process.stdout.write(br.stdout)
	if (br.stderr) process.stderr.write(br.stderr)
	if (br.status !== 0) {
		console.error('build-appstore-macos: tauri build failed')
		process.exit(br.status ?? 1)
	}

	const buildLog = `${br.stdout ?? ''}\n${br.stderr ?? ''}`
	const appPath = resolveBuiltAppPath(buildLog, cargoTargetDir, tauriTarget, bundleVersion)

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
	console.log('[build-appstore-macos] Deliver this .pkg via Transporter to macOS App Store Connect / TestFlight.')
}

main()
