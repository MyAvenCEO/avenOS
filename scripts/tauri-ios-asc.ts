#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
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
 *   AVEN_OUTPUT_IPA — output path (default dist/ios-appstore/avenOS-<version>-build<N>.ipa)
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyAppleEnvLocal } from './apple-env'
import {
	readRustToolchainChannel,
	rustToolchainShellExports,
	rustToolchainShellExportsPbx,
	rustupToolchainEnv
} from './rust-toolchain.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
		'tauri-ios-asc: set APPLE_DEVELOPMENT_TEAM in .env.apple.local (or shell) — see scripts/apple-env.local.template'
	)
	process.exit(1)
}

if (!existsSync(genApple)) {
	console.error(
		'tauri-ios-asc: missing src-tauri/gen/apple — run from app: CI=true bunx tauri ios init --ci'
	)
	process.exit(1)
}

function readPackageVersion(): string {
	const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8')) as {
		version?: string
	}
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
			existsSync(process.env.APPLE_API_KEY_PATH.trim())
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
		'utf8'
	)

	// Apple rejects standalone dylibs in an app bundle (STATE_ERROR.VALIDATION_ERROR:
	// "binary file is not permitted … standalone executables or libraries"). We bundle the
	// on-device AI libs (onnxruntime, sherpa-onnx) as bare `.dylib` for desktop, but they are
	// the macOS binaries — they can't load on iOS anyway (on-device AI on iOS is not yet
	// wired). Strip them from the archived .app BEFORE export so the re-signed .ipa validates.
	const archivedApp = path.join(ARCHIVE_PATH, 'Products', 'Applications', 'avenOS.app')
	if (existsSync(archivedApp)) {
		// onnxruntime is loaded dynamically (`ort` load-dynamic = lazy dlopen) and the bundled
		// copy is the macOS binary — it can't load on iOS, so removing it is safe and the only
		// way past Apple's check.
		rmSync(path.join(archivedApp, 'assets', 'onnxruntime'), { recursive: true, force: true })
		console.log(
			'[tauri-ios-asc] stripped assets/onnxruntime (standalone dylib not permitted on iOS)'
		)
		// Diagnostic only: surface any OTHER stray standalone .dylib (it would also be rejected)
		// WITHOUT deleting — a linked lib must be repackaged as a framework, not silently dropped.
		const left = spawnSync('find', [archivedApp, '-type', 'f', '-name', '*.dylib'], {
			encoding: 'utf8'
		})
		const stray = (left.stdout ?? '').trim()
		if (stray) {
			console.warn(
				`[tauri-ios-asc] WARNING — other standalone .dylib still in bundle (will fail App Store validation):\n${stray}`
			)
		}
	}

	console.log('[tauri-ios-asc] xcodebuild -exportArchive profile=%s', profileName)
	const r = spawnSync(
		'xcodebuild',
		[
			'-exportArchive',
			'-archivePath',
			ARCHIVE_PATH,
			'-exportPath',
			exportDir,
			'-exportOptionsPlist',
			exportOptions
		],
		{ stdio: 'inherit' }
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
			'tauri-ios-asc: missing icons/app-icon-source.png — add a 1024×1024 PNG (see scripts/generate-ios-icons.py)'
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
		{ encoding: 'utf8' }
	)
	const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
	if (!out.includes('is not installed')) return
	console.error(
		[
			'tauri-ios-asc: Xcode cannot build for physical iOS (iphoneos) yet.',
			'Install the matching iOS platform in Xcode → Settings → Platforms (Components).',
			'Then run: xcodebuild -runFirstLaunch -checkForNewerComponents',
			'Verify: xcodebuild -showdestinations -workspace app/src-tauri/gen/apple/aven-os-app.xcodeproj/project.xcworkspace -scheme aven-os-app_iOS'
		].join('\n')
	)
	process.exit(1)
}

function shellEscapeSingleQuoted(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`
}

function writeAvenIosCompileEnv() {
	mkdirSync(path.dirname(AVEN_IOS_COMPILE_ENV), { recursive: true })
	const channel = readRustToolchainChannel(repoRoot)
	// The iOS cargo compile (run inside xcodebuild) only sees env from THIS sourced
	// file — not the parent process — so anything `option_env!`-baked must be set
	// here. AVENOS_SERVER_WS_URL is read at compile time by app/src-tauri/src/jazz;
	// without it the iOS binary runs local-only and never dials the relay.
	const wsUrl = process.env.AVENOS_SERVER_WS_URL || 'wss://aven-ceo-bmrha.sprites.app/sync'
	const lines = [
		`export RUSTUP_TOOLCHAIN=${shellEscapeSingleQuoted(channel)}`,
		`export AVENOS_SERVER_WS_URL=${shellEscapeSingleQuoted(wsUrl)}`
	]

	// On-device voice (Parakeet via sherpa-onnx) needs the iOS arm64 static libs.
	// `sherpa-onnx-sys` has no iOS auto-download — point it at the libs staged by
	// scripts/build-sherpa-ios.sh. Without this the `local-voice` build fails with
	// "Unsupported target for sherpa-onnx prebuilt libs". If the dir is missing we
	// warn but still write the env (so the cargo error is the clear next signal).
	const sherpaLibDir = path.join(tauriDir, 'vendor/sherpa-ios/lib')
	if (existsSync(sherpaLibDir)) {
		lines.push(`export SHERPA_ONNX_LIB_DIR=${shellEscapeSingleQuoted(sherpaLibDir)}`)
	} else {
		console.warn(
			'[tauri-ios-asc] sherpa-onnx iOS libs not found at %s — run scripts/build-sherpa-ios.sh first, ' +
				'or build with `--no-default-features` (no on-device voice).',
			sherpaLibDir
		)
	}
	lines.push('')
	writeFileSync(AVEN_IOS_COMPILE_ENV, lines.join('\n'), 'utf8')
	console.log(
		'[tauri-ios-asc] wrote compile env → %s (AVENOS_SERVER_WS_URL=%s)',
		AVEN_IOS_COMPILE_ENV,
		wsUrl
	)
}

/** Legacy Xcode patches pinned Rust 1.88; upgrade whenever rust-toolchain.toml changes. */
const LEGACY_RUST_TOOLCHAIN_EXPORTS = [
	'export RUSTUP_TOOLCHAIN=1.88; export PATH="${HOME}/.cargo/bin:${PATH}"; ',
	'export RUSTUP_TOOLCHAIN=1.88; export PATH=\\"${HOME}/.cargo/bin:${PATH}\\"; '
] as const

function ensureRustToolchainReady(): void {
	const channel = readRustToolchainChannel(repoRoot)
	const list = spawnSync('rustup', ['toolchain', 'list', '-v'], { encoding: 'utf8' })
	const installed = list.stdout ?? ''
	if (!installed.includes(channel)) {
		console.log('[tauri-ios-asc] installing Rust toolchain %s…', channel)
		const inst = spawnSync('rustup', ['toolchain', 'install', channel], { stdio: 'inherit' })
		if (inst.status !== 0) {
			console.error('tauri-ios-asc: rustup toolchain install failed')
			process.exit(inst.status ?? 1)
		}
	}
	for (const target of ['aarch64-apple-ios', 'aarch64-apple-ios-sim']) {
		const add = spawnSync('rustup', ['target', 'add', target, '--toolchain', channel], {
			stdio: 'inherit'
		})
		if (add.status !== 0) {
			console.error('tauri-ios-asc: rustup target add %s failed', target)
			process.exit(add.status ?? 1)
		}
	}
	const v = spawnSync('rustc', ['--version'], {
		env: { ...process.env, RUSTUP_TOOLCHAIN: channel },
		encoding: 'utf8'
	})
	const line = (v.stdout || v.stderr || '').trim()
	const rustcMinor = channel.match(/^(\d+\.\d+)/)?.[1] ?? channel
	if (v.status !== 0 || !line.includes(rustcMinor)) {
		console.error(
			'tauri-ios-asc: rustc not available on toolchain %s — run: rustup toolchain install %s',
			channel,
			channel
		)
		process.exit(1)
	}
	console.log('[tauri-ios-asc] %s (RUSTUP_TOOLCHAIN=%s)', line, channel)
}

function patchXcodeRustScript() {
	const channel = readRustToolchainChannel(repoRoot)
	const projectYml = path.join(genApple, 'project.yml')
	const pbxproj = path.join(genApple, 'aven-os-app.xcodeproj/project.pbxproj')
	const badForceColor = '${CONFIGURATION:?} ${FORCE_COLOR} ${ARCHS:?}'
	const goodArchs = '${CONFIGURATION:?} ${ARCHS:?}'
	const compileEnvSource = 'set -a; source "${SRCROOT}/.aven-ios-compile.env"; set +a; '
	const compileEnvSourcePbx = 'set -a; source \\"${SRCROOT}/.aven-ios-compile.env\\"; set +a; '
	const rustExports = rustToolchainShellExports(repoRoot)
	const rustToolchain = `${compileEnvSource}${rustExports}`

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
		} else {
			for (const legacy of LEGACY_RUST_TOOLCHAIN_EXPORTS) {
				if (yml.includes(legacy)) {
					yml = yml.replaceAll(legacy, rustExports)
					ymlChanged = true
				}
			}
			if (yml.includes('RUSTUP_TOOLCHAIN=1.88')) {
				yml = yml.replaceAll('RUSTUP_TOOLCHAIN=1.88', `RUSTUP_TOOLCHAIN=${channel}`)
				ymlChanged = true
			}
		}
		if (ymlChanged) {
			writeFileSync(projectYml, yml, 'utf8')
			console.log('[tauri-ios-asc] patched project.yml (Rust build script env + arch args)')
		}
	}

	if (existsSync(pbxproj)) {
		let pbx = readFileSync(pbxproj, 'utf8')
		let changed = false
		const rustExportsPbx = rustToolchainShellExportsPbx(repoRoot)
		const rustEnv = `${compileEnvSourcePbx}${rustExportsPbx}`
		const brokenPbxCompileEnv = 'source "${SRCROOT}/.aven-ios-compile.env"'
		const fixedPbxCompileEnv = 'source \\"${SRCROOT}/.aven-ios-compile.env\\"'
		if (pbx.includes(brokenPbxCompileEnv)) {
			pbx = pbx.replaceAll(brokenPbxCompileEnv, fixedPbxCompileEnv)
			changed = true
		}
		if (
			pbx.includes('shellScript = "bun tauri ios xcode-script') &&
			!pbx.includes('.aven-ios-compile.env')
		) {
			pbx = pbx.replace(
				'shellScript = "bun tauri ios xcode-script',
				`shellScript = "${rustEnv}bun tauri ios xcode-script`
			)
			changed = true
		} else if (pbx.includes('RUSTUP_TOOLCHAIN=1.88')) {
			pbx = pbx.replaceAll('RUSTUP_TOOLCHAIN=1.88', `RUSTUP_TOOLCHAIN=${channel}`)
			changed = true
		}
		for (const legacy of LEGACY_RUST_TOOLCHAIN_EXPORTS) {
			const legacyPbx = legacy.replaceAll('"', '\\"')
			if (pbx.includes(legacyPbx)) {
				pbx = pbx.replaceAll(legacyPbx, rustExportsPbx)
				changed = true
			}
		}
		if (pbx.includes('--configuration ${CONFIGURATION:?} 0 ${ARCHS:?}')) {
			pbx = pbx.replaceAll(
				'--configuration ${CONFIGURATION:?} 0 ${ARCHS:?}',
				'--configuration ${CONFIGURATION:?} ${ARCHS:?}'
			)
			changed = true
		}
		if (pbx.includes('"\\".\\"",')) {
			pbx = pbx.replaceAll('\t\t\t\t\t"\\".\\"",\n', '')
			changed = true
		}
		if (changed) {
			writeFileSync(pbxproj, pbx, 'utf8')
			console.log(
				'[tauri-ios-asc] patched project.pbxproj (Rust build script + FRAMEWORK_SEARCH_PATHS)'
			)
		}
	}
}

/**
 * Link Apple's Accelerate framework into the iOS app. ggml's CPU backend (statically
 * linked via llama-cpp-sys-2 for `local-llama`) is built with GGML_USE_ACCELERATE on
 * Apple, so its ops reference Accelerate's vDSP_* symbols (`_vDSP_vadd`, `_vDSP_vmul`,
 * `_vDSP_maxv`, …). On macOS cargo links the `.a`s directly and honors llama-cpp-sys-2's
 * Accelerate link directive; the iOS path links libapp.a through xcodebuild against the
 * frameworks declared in the generated Xcode project, and `cargo:rustc-link-lib=framework`
 * directives do NOT reach that link. Tauri's default iOS template lists Metal/MetalKit but
 * not Accelerate, so without this the archive fails with
 * "Undefined symbols … _vDSP_* … for architecture arm64".
 *
 * We patch BOTH project.yml (the xcodegen source, in case a regen happens) and the already
 * generated project.pbxproj (which `tauri ios build` consumes as-is, without regenerating).
 * Anchors are section markers / structural lines — xcodegen randomizes the object UUIDs on
 * every regen, so we can't key off existing UUIDs. Idempotent: a no-op once Accelerate is in.
 */
function patchAccelerateFramework() {
	// Fixed UUIDs (24 uppercase hex). The `ACCE…` prefix + zero-fill makes collision with
	// xcodegen's random UUIDs effectively impossible.
	const FRAMEWORK_REF = 'ACCE0000000000000000FEF1'
	const BUILD_FILE = 'ACCE0000000000000000B111'

	const projectYml = path.join(genApple, 'project.yml')
	if (existsSync(projectYml)) {
		let yml = readFileSync(projectYml, 'utf8')
		if (!yml.includes('Accelerate.framework')) {
			// Add alongside the other linked SDK frameworks (mirrors `- sdk: Metal.framework`).
			yml = yml.replace(
				'      - sdk: CoreGraphics.framework\n',
				'      - sdk: Accelerate.framework\n      - sdk: CoreGraphics.framework\n'
			)
			writeFileSync(projectYml, yml, 'utf8')
			console.log('[tauri-ios-asc] patched project.yml (linked Accelerate.framework)')
		}
	}

	const pbxproj = path.join(genApple, 'aven-os-app.xcodeproj/project.pbxproj')
	if (!existsSync(pbxproj)) return
	let pbx = readFileSync(pbxproj, 'utf8')
	if (pbx.includes('Accelerate.framework')) return // already linked (idempotent)

	// 1. PBXBuildFile entry — the membership of the framework in a build phase.
	pbx = pbx.replace(
		'/* Begin PBXBuildFile section */\n',
		`/* Begin PBXBuildFile section */\n\t\t${BUILD_FILE} /* Accelerate.framework in Frameworks */ = {isa = PBXBuildFile; fileRef = ${FRAMEWORK_REF} /* Accelerate.framework */; };\n`
	)
	// 2. PBXFileReference entry — points at the SDK framework.
	pbx = pbx.replace(
		'/* Begin PBXFileReference section */\n',
		`/* Begin PBXFileReference section */\n\t\t${FRAMEWORK_REF} /* Accelerate.framework */ = {isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = Accelerate.framework; path = System/Library/Frameworks/Accelerate.framework; sourceTree = SDKROOT; };\n`
	)
	// 3. Add to the Frameworks build phase's files list (this is what the linker reads).
	pbx = pbx.replace(
		'isa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n',
		`isa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t${BUILD_FILE} /* Accelerate.framework in Frameworks */,\n`
	)
	writeFileSync(pbxproj, pbx, 'utf8')
	console.log(
		'[tauri-ios-asc] patched project.pbxproj (linked Accelerate.framework for ggml/llama.cpp)'
	)
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
		path.join(genApple, 'build/avenOS.ipa')
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
			process.env.AVEN_IOS_CERTIFICATE_PASSWORD?.trim()
	)

	if (hasProfile && hasP12) {
		const profilePath = mustFile(
			'AVEN_IOS_APP_STORE_MOBILEPROVISION',
			process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION
		)
		const p12Path = mustFile('AVEN_IOS_CERTIFICATE_P12', process.env.AVEN_IOS_CERTIFICATE_P12)
		// biome-ignore lint/style/noNonNullAssertion: intentional crash when the secret is unset — same behavior as before, release scripts fail loud.
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
				'[tauri-ios-asc] AVEN_IOS_APP_STORE_MOBILEPROVISION is set but manual p12 env is missing — automatic signing may fail if ASC has no cloud profile for ceo.aven.os. Export Apple Distribution .p12 and set AVEN_IOS_CERTIFICATE_P12 + AVEN_IOS_CERTIFICATE_PASSWORD.'
			)
		}
		return 'automatic'
	}

	if (hasProfile) {
		console.error(
			'tauri-ios-asc: AVEN_IOS_APP_STORE_MOBILEPROVISION is set — also set AVEN_IOS_CERTIFICATE_P12 and AVEN_IOS_CERTIFICATE_PASSWORD (Keychain → export Apple Distribution .p12), or configure APPLE_API_* for automatic signing.'
		)
		process.exit(1)
	}

	console.error(
		'tauri-ios-asc: configure manual signing (p12 + mobileprovision) or APPLE_API_* for automatic CI signing'
	)
	process.exit(1)
}

async function main() {
	const bundleVersion = process.env.AVEN_IOS_CF_BUNDLE_VERSION?.trim() || '13'
	const version = readPackageVersion()

	syncEntitlements()
	generateIosIconsFromSource()
	writeAvenIosCompileEnv()
	patchPodfile()
	ensureRustToolchainReady()
	patchXcodeRustScript()
	patchAccelerateFramework()

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
				bundle: { iOS: { bundleVersion } }
			},
			null,
			2
		),
		'utf8'
	)

	const tauriEnv = {
		...process.env,
		APPLE_DEVELOPMENT_TEAM: team,
		CI: 'true',
		// Bake the sync relay URL into the release binary (read at compile time via
		// `option_env!("AVENOS_SERVER_WS_URL")` in app/src-tauri/src/jazz). Override
		// by exporting AVENOS_SERVER_WS_URL; defaults to the hosted aven-ceo relay.
		AVENOS_SERVER_WS_URL:
			process.env.AVENOS_SERVER_WS_URL || 'wss://aven-ceo-bmrha.sprites.app/sync',
		...rustupToolchainEnv(repoRoot)
	}
	const signingMode = configureSigning(tauriEnv)

	console.log(
		'[tauri-ios-asc] team=%s build=%s mode=%s target=arm64-device',
		team,
		bundleVersion,
		signingMode
	)

	const frontendBuild = spawnSync('bun', ['run', 'build'], {
		cwd: appDir,
		stdio: 'inherit',
		env: tauriEnv
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
		// iOS ships STT (default) + the on-device LLM (LFM2.5-1.2B GGUF via llama.cpp/Metal,
		// statically linked — no dylib). TTS stays desktop-only (its onnxruntime dylib can't
		// ship on iOS), so we opt into `local-llama` directly rather than the `desktop-ai`
		// bundle the macOS build uses.
		'--features',
		'local-llama',
		'--export-method',
		'app-store-connect',
		'--target',
		'aarch64',
		'--ci',
		'--config',
		mergePath
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
			process.env.AVEN_IOS_APP_STORE_MOBILEPROVISION
		)
		const profileName = readMobileProvisionName(profilePath)
		const exportDir = path.join(genApple, 'build/export-manual')
		ipaSrc = exportArchiveManually(profileName, exportDir)
	} else {
		ipaSrc = findIpa()
	}
	if (!ipaSrc) {
		console.error(
			'tauri-ios-asc: could not find avenOS.ipa under gen/apple/build/ — check CLI output for the export path'
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
		'[tauri-ios-asc] Upload preferred: bun run release:app:ios <N> — uses altool/App Store Connect API. Use Apple Transporter only as a GUI fallback if CLI upload fails.'
	)
}

void main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
