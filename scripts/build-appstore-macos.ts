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
 *   AVEN_MAC_CF_BUNDLE_VERSION — CFBundleVersion for this upload (default "1")
 *   AVEN_OUTPUT_PKG — output path for the pkg (default dist/macos-appstore/avenOS-<version>-b<build>.pkg)
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal } from './apple-env'

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

function main() {
	const profileSrc = mustEnv('AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS')
	const signId = mustEnv('APPLE_SIGNING_IDENTITY')
	const pkgSignId = mustEnv('AVEN_PKG_INSTALLER_IDENTITY')
	const bundleVersion = process.env.AVEN_MAC_CF_BUNDLE_VERSION?.trim() || '1'
	const version = readPackageVersion()

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
	const tauriEnv = { ...process.env }
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
		stdio: 'inherit',
		env: tauriEnv,
	})
	if (br.status !== 0) {
		console.error('build-appstore-macos: tauri build failed')
		process.exit(br.status ?? 1)
	}

	const appName = 'avenOS.app'
	const appPath = path.join(
		tauriDir,
		'target',
		tauriTarget,
		'release',
		'bundle',
		'macos',
		appName,
	)

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
