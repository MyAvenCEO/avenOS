#!/usr/bin/env bun
/**
 * TestFlight-only iOS pipeline: builds a signed App Store `.ipa` for Transporter upload.
 * Does not target the iOS Simulator — validate on physical devices via TestFlight only.
 *
 * Loads `<repo-root>/.env.apple.local`, syncs iOS entitlements template, then runs
 * `tauri ios build --export-method app-store-connect --target aarch64` from lib/app.
 *
 * Signing modes (first match wins):
 * 1. **Automatic CI** — `APPLE_API_ISSUER` + `APPLE_API_KEY` + `APPLE_API_KEY_PATH` (+ team).
 * 2. **Manual CI** — `AVEN_IOS_APP_STORE_MOBILEPROVISION`, `AVEN_IOS_CERTIFICATE_P12`, `AVEN_IOS_CERTIFICATE_PASSWORD`.
 *
 * Optional env:
 *   AVEN_IOS_CF_BUNDLE_VERSION — CFBundleVersion for this upload (default "1")
 *   GENESIS_NETWORK_ID — compile-time embed (else from repo `.env`; see resolveGenesisNetworkId)
 *   AVEN_OUTPUT_IPA — output path (default dist/ios-appstore/avenOS-<version>-build<N>.ipa)
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
const genApple = path.join(tauriDir, 'gen/apple')
const entitlementsDest = path.join(genApple, 'aven-os-app_iOS/aven-os-app_iOS.entitlements')
const entitlementsSrc = path.join(tauriDir, 'ios-template/aven-os-app_iOS.entitlements')

const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim()
if (!team) {
	console.error(
		'tauri-ios-asc: set APPLE_DEVELOPMENT_TEAM in .env.apple.local (or shell) — see scripts/apple-env.local.template',
	)
	process.exit(1)
}

if (!existsSync(genApple)) {
	console.error(
		'tauri-ios-asc: missing src-tauri/gen/apple — run from lib/app: CI=true bunx tauri ios init --ci',
	)
	process.exit(1)
}

function readPackageVersion(): string {
	const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { version?: string }
	return (pkg.version ?? '0.0.0').trim()
}

function mustFile(label: string, filePath: string | undefined): string {
	const p = filePath?.trim()
	if (!p) {
		console.error(`tauri-ios-asc: missing ${label}`)
		process.exit(1)
	}
	if (!existsSync(p)) {
		console.error(`tauri-ios-asc: ${label} not found: ${p}`)
		process.exit(1)
	}
	return p
}

function fileToBase64(filePath: string): string {
	return readFileSync(filePath).toString('base64')
}

function hasAutomaticCiSigning(): boolean {
	return Boolean(
		process.env.APPLE_API_ISSUER?.trim() &&
			process.env.APPLE_API_KEY?.trim() &&
			process.env.APPLE_API_KEY_PATH?.trim() &&
			existsSync(process.env.APPLE_API_KEY_PATH.trim()),
	)
}

function syncEntitlements() {
	mkdirSync(path.dirname(entitlementsDest), { recursive: true })
	copyFileSync(entitlementsSrc, entitlementsDest)
	console.log(`[tauri-ios-asc] synced entitlements → ${entitlementsDest}`)
}

/** Fail fast when Xcode has no eligible iphoneos destination (common after fresh Xcode install). */
function ensureIosDevicePlatform(workspace: string, scheme: string) {
	const r = spawnSync(
		'xcodebuild',
		['-showdestinations', '-workspace', workspace, '-scheme', scheme],
		{ encoding: 'utf8' },
	)
	const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
	if (!out.includes('is not installed')) return
	console.error(
		[
			'tauri-ios-asc: Xcode cannot build for physical iOS (iphoneos) yet.',
			'Install the matching iOS platform in Xcode → Settings → Platforms (Components).',
			'Then run: xcodebuild -runFirstLaunch -checkForNewerComponents',
			'Verify: xcodebuild -showdestinations -workspace lib/app/src-tauri/gen/apple/aven-os-app.xcodeproj/project.xcworkspace -scheme aven-os-app_iOS',
		].join('\n'),
	)
	process.exit(1)
}

function patchPodfile() {
	const podfile = path.join(genApple, 'Podfile')
	if (!existsSync(podfile)) return
	const src = readFileSync(podfile, 'utf8')
	if (!src.includes('aven-os-app_macOS')) return
	const next = src.replace(/\ntarget 'aven-os-app_macOS' do[\s\S]*?\nend\n?/, '\n')
	if (next !== src) {
		writeFileSync(podfile, next, 'utf8')
		console.log('[tauri-ios-asc] patched Podfile (removed macOS target)')
	}
	const pod = spawnSync('pod', ['install'], { cwd: genApple, stdio: 'inherit' })
	if (pod.status !== 0) {
		console.warn('[tauri-ios-asc] pod install failed (continuing — Podfile may have no pods)')
	}
}

function findIpa(): string | null {
	const candidates = [
		path.join(genApple, 'build/arm64/avenOS.ipa'),
		path.join(genApple, 'build/universal/avenOS.ipa'),
		path.join(genApple, 'build/avenOS.ipa'),
	]
	for (const p of candidates) {
		if (existsSync(p)) return p
	}
	return null
}

function configureSigning(env: NodeJS.ProcessEnv): 'automatic' | 'manual' {
	if (hasAutomaticCiSigning()) {
		console.log('[tauri-ios-asc] signing=automatic (App Store Connect API key)')
		return 'automatic'
	}

	const profilePath = mustFile(
		'AVEN_IOS_APP_STORE_MOBILEPROVISION',
		process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION,
	)
	const p12Path = mustFile('AVEN_IOS_CERTIFICATE_P12', process.env.AVEN_IOS_CERTIFICATE_P12)
	const p12Password = process.env.AVEN_IOS_CERTIFICATE_PASSWORD?.trim()
	if (!p12Password) {
		console.error(
			'tauri-ios-asc: set AVEN_IOS_CERTIFICATE_PASSWORD for manual signing, or configure APPLE_API_* for automatic CI signing',
		)
		process.exit(1)
	}

	env.IOS_MOBILE_PROVISION = fileToBase64(profilePath)
	env.IOS_CERTIFICATE = fileToBase64(p12Path)
	env.IOS_CERTIFICATE_PASSWORD = p12Password
	console.log('[tauri-ios-asc] signing=manual (base64 p12 + mobileprovision from paths)')
	return 'manual'
}

function main() {
	const bundleVersion = process.env.AVEN_IOS_CF_BUNDLE_VERSION?.trim() || '1'
	const version = readPackageVersion()

	const genesisNetworkId = resolveGenesisNetworkId(repoRoot)
	if (!genesisNetworkId) {
		console.error(
			'tauri-ios-asc: missing GENESIS_NETWORK_ID — set in shell, .env.apple.local, or repo .env (GENESIS_NETWORK_ID or DEV_GENESIS_NETWORK_ID)',
		)
		process.exit(1)
	}

	syncEntitlements()
	patchPodfile()

	const workspace = path.join(genApple, 'aven-os-app.xcodeproj/project.xcworkspace')
	ensureIosDevicePlatform(workspace, 'aven-os-app_iOS')

	mkdirSync(path.join(repoRoot, 'dist'), { recursive: true })
	const mergeDir = mkdtempSync(path.join(repoRoot, 'dist', 'ios-appstore-tmp-'))
	const mergePath = path.join(mergeDir, 'tauri.ios.merge.json')
	writeFileSync(
		mergePath,
		JSON.stringify({ bundle: { iOS: { bundleVersion } } }, null, 2),
		'utf8',
	)

	const tauriEnv = {
		...process.env,
		APPLE_DEVELOPMENT_TEAM: team,
		CI: 'true',
		GENESIS_NETWORK_ID: genesisNetworkId,
	}
	console.log('[tauri-ios-asc] embedding GENESIS_NETWORK_ID at compile time')
	const signingMode = configureSigning(tauriEnv)

	console.log('[tauri-ios-asc] team=%s build=%s mode=%s target=arm64-device', team, bundleVersion, signingMode)

	const r = spawnSync(
		'bunx',
		[
			'--bun',
			'tauri',
			'ios',
			'build',
			'--export-method',
			'app-store-connect',
			'--target',
			'aarch64',
			'--ci',
			'--config',
			mergePath,
		],
		{ cwd: appDir, stdio: 'inherit', env: tauriEnv },
	)
	if (r.status !== 0) {
		console.error('tauri-ios-asc: tauri ios build failed')
		process.exit(r.status ?? 1)
	}

	const ipaSrc = findIpa()
	if (!ipaSrc) {
		console.error(
			'tauri-ios-asc: could not find avenOS.ipa under gen/apple/build/ — check CLI output for the export path',
		)
		process.exit(1)
	}

	const distDir = path.join(repoRoot, 'dist', 'ios-appstore')
	mkdirSync(distDir, { recursive: true })
	const ipaOut =
		process.env.AVEN_OUTPUT_IPA?.trim() ||
		path.join(distDir, `avenOS-${version}-build${bundleVersion}.ipa`)
	copyFileSync(ipaSrc, ipaOut)

	try {
		rmSync(mergeDir, { recursive: true, force: true })
	} catch {
		// ignore cleanup errors (tmp lives under ignored dist area)
	}

	console.log(`[tauri-ios-asc] done → ${ipaOut}`)
	console.log('[tauri-ios-asc] Deliver this .ipa via Transporter to iOS App Store Connect / TestFlight.')
}

main()
