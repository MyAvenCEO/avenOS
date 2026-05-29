#!/usr/bin/env bun
/**
 * TestFlight-only iOS pipeline: builds a signed App Store `.ipa` for Transporter upload.
 * Does not target the iOS Simulator — validate on physical devices via TestFlight only.
 *
 * Loads `<repo-root>/.env.apple.local`, syncs iOS entitlements template, then runs
 * `tauri ios build --export-method app-store-connect --target aarch64` from app.
 *
 * Signing modes (first match wins):
 * 1. **Manual CI** — `AVEN_IOS_APP_STORE_MOBILEPROVISION`, `AVEN_IOS_CERTIFICATE_P12`, `AVEN_IOS_CERTIFICATE_PASSWORD`.
 *    Uses `--archive-only` then `xcodebuild -exportArchive` (Tauri export re-imports a placeholder cert).
 * 2. **Automatic CI** — `APPLE_API_ISSUER` + `APPLE_API_KEY` + `APPLE_API_KEY_PATH` (+ team).
 *
 * Optional env:
 *   AVEN_IOS_CF_BUNDLE_VERSION — CFBundleVersion for this upload (default "13")
 *   GENESIS_NETWORK_ID — compile-time embed (else from repo `.env`; see resolveGenesisNetworkId)
 *   AVEN_RELAY_URL — optional shell override; default hardcoded `relay.aven.ceo` (compile-time embed for P2P)
 *   AVEN_OUTPUT_IPA — output path (default dist/ios-appstore/avenOS-<version>-build<N>.ipa)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal, resolveGenesisNetworkId } from './apple-env'
import { ensureRelayEnvReady } from './relay-env.ts'
import { resolveAppStoreRelayConfig, type AppStoreRelayConfig } from './relay-bootstrap.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Production Hyperswarm bootstrap host — compile-time embed for App Store sandbox (no .env). */
const IOS_APPSTORE_AVEN_RELAY_URL = 'relay.aven.ceo'
const IOS_APPSTORE_DHT_UDP_PORT = 49737

function hyperswarmRelayCompileEnv(relayCfg: AppStoreRelayConfig): Record<string, string> {
	if (!relayCfg.relayPublicKeyHex || !relayCfg.relayAddr) return {}
	return {
		AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: relayCfg.relayPublicKeyHex,
		AVENOS_HYPERSWARM_RELAY_ADDR: relayCfg.relayAddr,
	}
}

applyAppleEnvLocal(repoRoot)

const appDir = path.join(repoRoot, 'app')
const tauriDir = path.join(appDir, 'src-tauri')
const genApple = path.join(tauriDir, 'gen/apple')
const AVEN_IOS_COMPILE_ENV = path.join(genApple, '.aven-ios-compile.env')
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
		'tauri-ios-asc: missing src-tauri/gen/apple — run from app: CI=true bunx tauri ios init --ci',
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

const BUNDLE_ID = 'ceo.aven.os'
const ARCHIVE_PATH = path.join(genApple, 'build/aven-os-app_iOS.xcarchive')

function readMobileProvisionName(profilePath: string): string {
	const r = spawnSync('security', ['cms', '-D', '-i', profilePath], { encoding: 'utf8' })
	if (r.status !== 0) {
		console.error('tauri-ios-asc: failed to decode mobileprovision')
		process.exit(1)
	}
	const nameMatch = r.stdout.match(/<key>Name<\/key>\s*<string>([^<]+)<\/string>/)
	if (!nameMatch?.[1]) {
		console.error('tauri-ios-asc: could not read profile Name from mobileprovision')
		process.exit(1)
	}
	return nameMatch[1]
}

function exportArchiveManually(profileName: string, exportDir: string): string {
	if (!existsSync(ARCHIVE_PATH)) {
		console.error(`tauri-ios-asc: archive not found: ${ARCHIVE_PATH}`)
		process.exit(1)
	}
	mkdirSync(exportDir, { recursive: true })
	const exportOptions = path.join(exportDir, 'ExportOptions.plist')
	writeFileSync(
		exportOptions,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>${team}</string>
	<key>signingStyle</key>
	<string>manual</string>
	<key>signingCertificate</key>
	<string>Apple Distribution</string>
	<key>provisioningProfiles</key>
	<dict>
		<key>${BUNDLE_ID}</key>
		<string>${profileName}</string>
	</dict>
</dict>
</plist>
`,
		'utf8',
	)
	console.log('[tauri-ios-asc] xcodebuild -exportArchive profile=%s', profileName)
	const r = spawnSync(
		'xcodebuild',
		['-exportArchive', '-archivePath', ARCHIVE_PATH, '-exportPath', exportDir, '-exportOptionsPlist', exportOptions],
		{ stdio: 'inherit' },
	)
	if (r.status !== 0) {
		console.error('tauri-ios-asc: xcodebuild export failed')
		process.exit(r.status ?? 1)
	}
	const ipa = path.join(exportDir, 'avenOS.ipa')
	if (!existsSync(ipa)) {
		console.error('tauri-ios-asc: export finished but avenOS.ipa is missing')
		process.exit(1)
	}
	return ipa
}

function syncEntitlements() {
	mkdirSync(path.dirname(entitlementsDest), { recursive: true })
	copyFileSync(entitlementsSrc, entitlementsDest)
	console.log(`[tauri-ios-asc] synced entitlements → ${entitlementsDest}`)
}

/** Scale `app-icon-source.png` into ios/ sizes (avoids `tauri icon --ios-color` badge transform). */
function generateIosIconsFromSource() {
	const source = path.join(tauriDir, 'icons/app-icon-source.png')
	const iosIconsDir = path.join(tauriDir, 'icons/ios')
	const genScript = path.join(repoRoot, 'scripts/generate-ios-icons.py')
	if (!existsSync(source)) {
		console.error(
			'tauri-ios-asc: missing icons/app-icon-source.png — add a 1024×1024 PNG (see scripts/generate-ios-icons.py)',
		)
		process.exit(1)
	}
	const r = spawnSync('python3', [genScript, source, iosIconsDir], { encoding: 'utf8' })
	if (r.status !== 0) {
		console.error('tauri-ios-asc: generate-ios-icons failed')
		if (r.stderr) console.error(r.stderr)
		process.exit(r.status ?? 1)
	}
	if (r.stdout?.trim()) console.log(r.stdout.trimEnd())
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
			'Verify: xcodebuild -showdestinations -workspace app/src-tauri/gen/apple/aven-os-app.xcodeproj/project.xcworkspace -scheme aven-os-app_iOS',
		].join('\n'),
	)
	process.exit(1)
}

function shellEscapeSingleQuoted(value: string): string {
	return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function writeAvenIosCompileEnv(
	genesisNetworkId: string,
	avenRelayUrl: string,
	dhtBootstrap: string,
	relayCfg: AppStoreRelayConfig,
) {
	mkdirSync(path.dirname(AVEN_IOS_COMPILE_ENV), { recursive: true })
	const lines = [
		`export GENESIS_NETWORK_ID=${shellEscapeSingleQuoted(genesisNetworkId)}`,
		`export AVEN_RELAY_URL=${shellEscapeSingleQuoted(avenRelayUrl)}`,
		`export AVENOS_DHT_BOOTSTRAP=${shellEscapeSingleQuoted(dhtBootstrap)}`,
	]
	if (relayCfg.relayPublicKeyHex && relayCfg.relayAddr) {
		lines.push(
			`export AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX=${shellEscapeSingleQuoted(relayCfg.relayPublicKeyHex)}`,
			`export AVENOS_HYPERSWARM_RELAY_ADDR=${shellEscapeSingleQuoted(relayCfg.relayAddr)}`,
		)
	}
	lines.push('')
	writeFileSync(AVEN_IOS_COMPILE_ENV, lines.join('\n'), 'utf8')
	console.log('[tauri-ios-asc] wrote compile env → %s', AVEN_IOS_COMPILE_ENV)
}

function patchXcodeRustScript() {
	const projectYml = path.join(genApple, 'project.yml')
	const pbxproj = path.join(genApple, 'aven-os-app.xcodeproj/project.pbxproj')
	const badForceColor = '${CONFIGURATION:?} ${FORCE_COLOR} ${ARCHS:?}'
	const goodArchs = '${CONFIGURATION:?} ${ARCHS:?}'
	const compileEnvSource = 'set -a; source "${SRCROOT}/.aven-ios-compile.env"; set +a; '
	const compileEnvSourcePbx = 'set -a; source \\"${SRCROOT}/.aven-ios-compile.env\\"; set +a; '
	const rustToolchain = `${compileEnvSource}export RUSTUP_TOOLCHAIN=1.88; export PATH="\${HOME}/.cargo/bin:\${PATH}"; `

	if (existsSync(projectYml)) {
		let yml = readFileSync(projectYml, 'utf8')
		let ymlChanged = false
		if (yml.includes(badForceColor)) {
			yml = yml.replaceAll(badForceColor, goodArchs)
			ymlChanged = true
		}
		const bareScript = '- script: bun tauri ios xcode-script'
		const patchedScript = `- script: ${rustToolchain}bun tauri ios xcode-script`
		if (yml.includes(bareScript)) {
			yml = yml.replace(bareScript, patchedScript)
			ymlChanged = true
		} else if (yml.includes('bun tauri ios xcode-script') && !yml.includes('.aven-ios-compile.env')) {
			yml = yml.replace(
				'- script: export RUSTUP_TOOLCHAIN=1.88; export PATH="${HOME}/.cargo/bin:${PATH}"; bun tauri ios xcode-script',
				patchedScript,
			)
			ymlChanged = true
		}
		if (ymlChanged) {
			writeFileSync(projectYml, yml, 'utf8')
			console.log('[tauri-ios-asc] patched project.yml (Rust build script env + arch args)')
		}
	}

	if (existsSync(pbxproj)) {
		let pbx = readFileSync(pbxproj, 'utf8')
		let changed = false
		const rustEnv = `${compileEnvSourcePbx}export RUSTUP_TOOLCHAIN=1.88; export PATH=\\"\${HOME}/.cargo/bin:\${PATH}\\"; `
		const brokenPbxCompileEnv = 'source "${SRCROOT}/.aven-ios-compile.env"'
		const fixedPbxCompileEnv = 'source \\"${SRCROOT}/.aven-ios-compile.env\\"'
		if (pbx.includes(brokenPbxCompileEnv)) {
			pbx = pbx.replaceAll(brokenPbxCompileEnv, fixedPbxCompileEnv)
			changed = true
		}
		if (pbx.includes('shellScript = "bun tauri ios xcode-script') && !pbx.includes('.aven-ios-compile.env')) {
			pbx = pbx.replace(
				'shellScript = "bun tauri ios xcode-script',
				`shellScript = "${rustEnv}bun tauri ios xcode-script`,
			)
			changed = true
		} else if (
			pbx.includes('shellScript = "export RUSTUP_TOOLCHAIN=1.88') &&
			!pbx.includes('.aven-ios-compile.env')
		) {
			pbx = pbx.replace(
				'shellScript = "export RUSTUP_TOOLCHAIN=1.88; export PATH=\\"${HOME}/.cargo/bin:${PATH}\\"; bun tauri ios xcode-script',
				`shellScript = "${rustEnv}bun tauri ios xcode-script`,
			)
			changed = true
		}
		if (pbx.includes('--configuration ${CONFIGURATION:?} 0 ${ARCHS:?}')) {
			pbx = pbx.replaceAll(
				'--configuration ${CONFIGURATION:?} 0 ${ARCHS:?}',
				'--configuration ${CONFIGURATION:?} ${ARCHS:?}',
			)
			changed = true
		}
		if (pbx.includes('"\\".\\"",')) {
			pbx = pbx.replaceAll('\t\t\t\t\t"\\".\\"",\n', '')
			changed = true
		}
		if (changed) {
			writeFileSync(pbxproj, pbx, 'utf8')
			console.log('[tauri-ios-asc] patched project.pbxproj (Rust build script + FRAMEWORK_SEARCH_PATHS)')
		}
	}
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
	const hasProfile = Boolean(process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION?.trim())
	const hasP12 = Boolean(
		process.env.AVEN_IOS_CERTIFICATE_P12?.trim() &&
			process.env.AVEN_IOS_CERTIFICATE_PASSWORD?.trim(),
	)

	if (hasProfile && hasP12) {
		const profilePath = mustFile(
			'AVEN_IOS_APP_STORE_MOBILEPROVISION',
			process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION,
		)
		const p12Path = mustFile('AVEN_IOS_CERTIFICATE_P12', process.env.AVEN_IOS_CERTIFICATE_P12)
		const p12Password = process.env.AVEN_IOS_CERTIFICATE_PASSWORD!.trim()
		env.IOS_MOBILE_PROVISION = fileToBase64(profilePath)
		env.IOS_CERTIFICATE = fileToBase64(p12Path)
		env.IOS_CERTIFICATE_PASSWORD = p12Password
		console.log('[tauri-ios-asc] signing=manual (p12 + mobileprovision from paths)')
		return 'manual'
	}

	if (hasAutomaticCiSigning()) {
		console.log('[tauri-ios-asc] signing=automatic (App Store Connect API key)')
		if (hasProfile) {
			console.warn(
				'[tauri-ios-asc] AVEN_IOS_APP_STORE_MOBILEPROVISION is set but manual p12 env is missing — automatic signing may fail if ASC has no cloud profile for ceo.aven.os. Export Apple Distribution .p12 and set AVEN_IOS_CERTIFICATE_P12 + AVEN_IOS_CERTIFICATE_PASSWORD.',
			)
		}
		return 'automatic'
	}

	if (hasProfile) {
		console.error(
			'tauri-ios-asc: AVEN_IOS_APP_STORE_MOBILEPROVISION is set — also set AVEN_IOS_CERTIFICATE_P12 and AVEN_IOS_CERTIFICATE_PASSWORD (Keychain → export Apple Distribution .p12), or configure APPLE_API_* for automatic signing.',
		)
		process.exit(1)
	}

	console.error(
		'tauri-ios-asc: configure manual signing (p12 + mobileprovision) or APPLE_API_* for automatic CI signing',
	)
	process.exit(1)
}

async function main() {
	ensureRelayEnvReady(repoRoot)

	const bundleVersion = process.env.AVEN_IOS_CF_BUNDLE_VERSION?.trim() || '13'
	const version = readPackageVersion()

	const genesisNetworkId = resolveGenesisNetworkId(repoRoot)
	if (!genesisNetworkId) {
		console.error(
			'tauri-ios-asc: missing GENESIS_NETWORK_ID — set in shell, .env.apple.local, or repo .env (GENESIS_NETWORK_ID or DEV_GENESIS_NETWORK_ID)',
		)
		process.exit(1)
	}
	const avenRelayUrl = process.env.AVEN_RELAY_URL?.trim() || IOS_APPSTORE_AVEN_RELAY_URL
	const relayCfg = await resolveAppStoreRelayConfig(
		IOS_APPSTORE_AVEN_RELAY_URL,
		IOS_APPSTORE_DHT_UDP_PORT,
		{ warnLabel: 'tauri-ios-asc', repoRoot, requireEnvPubkey: true },
	)
	const dhtBootstrap = relayCfg.dhtBootstrap

	syncEntitlements()
	generateIosIconsFromSource()
	writeAvenIosCompileEnv(genesisNetworkId, avenRelayUrl, dhtBootstrap, relayCfg)
	patchPodfile()
	patchXcodeRustScript()

	const workspace = path.join(genApple, 'aven-os-app.xcodeproj/project.xcworkspace')
	ensureIosDevicePlatform(workspace, 'aven-os-app_iOS')

	mkdirSync(path.join(repoRoot, 'dist'), { recursive: true })
	const mergeDir = mkdtempSync(path.join(repoRoot, 'dist', 'ios-appstore-tmp-'))
	const mergePath = path.join(mergeDir, 'tauri.ios.merge.json')
	writeFileSync(
		mergePath,
		JSON.stringify(
			{
				build: { beforeBuildCommand: '' },
				bundle: { iOS: { bundleVersion } },
			},
			null,
			2,
		),
		'utf8',
	)

	const tauriEnv = {
		...process.env,
		APPLE_DEVELOPMENT_TEAM: team,
		CI: 'true',
		GENESIS_NETWORK_ID: genesisNetworkId,
		AVEN_RELAY_URL: avenRelayUrl,
		AVENOS_DHT_BOOTSTRAP: dhtBootstrap,
		...hyperswarmRelayCompileEnv(relayCfg),
		RUSTUP_TOOLCHAIN: '1.88',
	}
	console.log('[tauri-ios-asc] embedding GENESIS_NETWORK_ID at compile time')
	console.log('[tauri-ios-asc] embedding AVEN_RELAY_URL=%s at compile time', avenRelayUrl)
	console.log('[tauri-ios-asc] embedding AVENOS_DHT_BOOTSTRAP=%s at compile time', dhtBootstrap)
	const signingMode = configureSigning(tauriEnv)

	console.log('[tauri-ios-asc] team=%s build=%s mode=%s target=arm64-device', team, bundleVersion, signingMode)

	const frontendBuild = spawnSync('bun', ['run', 'build'], {
		cwd: appDir,
		stdio: 'inherit',
		env: tauriEnv,
	})
	if (frontendBuild.status !== 0) {
		console.error('tauri-ios-asc: frontend build failed')
		process.exit(frontendBuild.status ?? 1)
	}

	const tauriArgs = [
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
	]
	if (signingMode === 'manual') {
		tauriArgs.push('--archive-only')
	}

	const r = spawnSync('bunx', tauriArgs, { cwd: appDir, stdio: 'inherit', env: tauriEnv })
	if (r.status !== 0) {
		console.error('tauri-ios-asc: tauri ios build failed')
		process.exit(r.status ?? 1)
	}

	let ipaSrc: string | null
	if (signingMode === 'manual') {
		const profilePath = mustFile(
			'AVEN_IOS_APP_STORE_MOBILEPROVISION',
			process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION,
		)
		const profileName = readMobileProvisionName(profilePath)
		const exportDir = path.join(genApple, 'build/export-manual')
		ipaSrc = exportArchiveManually(profileName, exportDir)
	} else {
		ipaSrc = findIpa()
	}
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
	console.log(
		'[tauri-ios-asc] Upload preferred: bun run release:app:ios <N> — uses altool/App Store Connect API. Use Apple Transporter only as a GUI fallback if CLI upload fails.',
	)
}

void main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
