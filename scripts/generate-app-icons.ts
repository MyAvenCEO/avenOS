#!/usr/bin/env bun
/**
 * Regenerate EVERY app icon from one source image.
 *
 *   bun run icons                        # re-render from the current source
 *   bun run icons ~/Downloads/logo.svg   # adopt a new logo
 *   bun run icons logo.jpg --ios-bg=#F8F1E8
 *
 * Accepts svg, png, jpg/jpeg, webp, avif, tiff and gif. Non-square inputs are
 * letterboxed (never cropped); an SVG input is also copied in as the vector SSOT.
 *
 * Outputs (all under app/):
 *   src-tauri/icons/app-icon-source.png       1024² badged source (alpha kept)
 *   src-tauri/icons/app-icon-source-1024.png  duplicate kept for older tooling
 *   src-tauri/icons/app-icon-source-ios.png   1024² opaque, full-bleed (iOS masks itself)
 *   src-tauri/icons/…                         via `tauri icon`: macOS/Windows/Linux/Android
 *   src-tauri/icons/ios/…                     re-done here, flattened (Apple rejects alpha)
 *   static/app-icon.png, static/favicon.png   in-app/browser copies
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp, { type SharpOptions } from 'sharp'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(repoRoot, 'app')
const tauriDir = path.join(appDir, 'src-tauri')
const iconsDir = path.join(tauriDir, 'icons')
const iosDir = path.join(iconsDir, 'ios')
const staticDir = path.join(appDir, 'static')
const xcassetsDir = path.join(tauriDir, 'gen/apple/Assets.xcassets/AppIcon.appiconset')
const androidBgXml = path.join(iconsDir, 'android/values/ic_launcher_background.xml')

const SOURCE_PNG = path.join(iconsDir, 'app-icon-source.png')
const SOURCE_SVG = path.join(iconsDir, 'app-icon-source.svg')
const SOURCE_IOS = path.join(iconsDir, 'app-icon-source-ios.png')

const SUPPORTED = new Set([
	'.svg',
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.avif',
	'.tiff',
	'.tif',
	'.gif'
])

/** Matches app/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json */
export const IOS_ICON_SIZES: Record<string, number> = {
	'AppIcon-20x20@1x.png': 20,
	'AppIcon-20x20@2x-1.png': 40,
	'AppIcon-20x20@2x.png': 40,
	'AppIcon-20x20@3x.png': 60,
	'AppIcon-29x29@1x.png': 29,
	'AppIcon-29x29@2x-1.png': 58,
	'AppIcon-29x29@2x.png': 58,
	'AppIcon-29x29@3x.png': 87,
	'AppIcon-40x40@1x.png': 40,
	'AppIcon-40x40@2x-1.png': 80,
	'AppIcon-40x40@2x.png': 80,
	'AppIcon-40x40@3x.png': 120,
	'AppIcon-60x60@2x.png': 120,
	'AppIcon-60x60@3x.png': 180,
	'AppIcon-76x76@1x.png': 76,
	'AppIcon-76x76@2x.png': 152,
	'AppIcon-83.5x83.5@2x.png': 167,
	'AppIcon-512@2x.png': 1024
}

/**
 * Rasterize any supported input to a square RGBA PNG. SVG is rendered at a density
 * that yields at least `size` px natively, so it is downsampled — never upscaled.
 */
export async function rasterizeSquare(input: string, size: number): Promise<Buffer> {
	const isSvg = path.extname(input).toLowerCase() === '.svg'
	let opts: SharpOptions = {}
	if (isSvg) {
		const intrinsic = await sharp(input).metadata()
		const longest = Math.max(intrinsic.width ?? size, intrinsic.height ?? size)
		opts = { density: Math.min(2400, Math.ceil((72 * size) / longest)) }
	}
	return sharp(input, opts)
		.resize(size, size, {
			fit: 'contain',
			kernel: 'lanczos3',
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		})
		.png()
		.toBuffer()
}

/**
 * The colour to sit behind the icon where it is transparent. Sampled from the top-centre
 * pixel — for a badged icon that is the card itself, so flattening fills the rounded
 * corners seamlessly. Falls back to white when the source has no opaque background.
 */
export async function pickBackground(png: Buffer): Promise<string> {
	const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
	const x = Math.floor(info.width / 2)
	const i = x * info.channels // top row, centre column
	const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
	if (a === undefined || a < 250 || r === undefined || g === undefined || b === undefined) {
		return '#FFFFFF'
	}
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** iOS applies its own mask and rejects alpha → flatten to a full-bleed opaque square. */
export async function generateIosIcons(source: string, outDir: string, bg?: string): Promise<void> {
	const background = bg ?? (await pickBackground(readFileSync(source)))
	mkdirSync(outDir, { recursive: true })
	for (const [name, px] of Object.entries(IOS_ICON_SIZES)) {
		await sharp(source)
			.resize(px, px, { kernel: 'lanczos3' })
			.flatten({ background })
			.removeAlpha()
			.png()
			.toFile(path.join(outDir, name))
	}
	console.log(`[icons] ios → ${Object.keys(IOS_ICON_SIZES).length} sizes in ${outDir}`)
}

/** Xcode reads the generated project's asset catalogue, not icons/ios — keep them in step. */
export function syncIosXcassets(fromDir: string): void {
	if (!existsSync(xcassetsDir)) return
	for (const name of Object.keys(IOS_ICON_SIZES)) {
		const src = path.join(fromDir, name)
		if (existsSync(src)) copyFileSync(src, path.join(xcassetsDir, name))
	}
	console.log(`[icons] synced xcassets → ${xcassetsDir}`)
}

function runTauriIcon(source: string): void {
	const r = spawnSync('bun', ['--bun', 'x', 'tauri', 'icon', source, '-o', iconsDir], {
		cwd: appDir,
		stdio: 'inherit'
	})
	if (r.status !== 0) {
		console.error('[icons] `tauri icon` failed')
		process.exit(r.status ?? 1)
	}
}

/** `tauri icon` guesses the adaptive-icon backdrop; use the icon's own background instead. */
function writeAndroidBackground(bg: string): void {
	if (!existsSync(androidBgXml)) return
	const xml = readFileSync(androidBgXml, 'utf8').replace(
		/(<color name="ic_launcher_background">)[^<]*(<\/color>)/,
		`$1${bg}$2`
	)
	writeFileSync(androidBgXml, xml, 'utf8')
	console.log(`[icons] android adaptive background → ${bg}`)
}

function resolveInput(arg: string | undefined): string {
	if (arg) {
		const input = path.resolve(arg)
		if (!existsSync(input)) {
			console.error(`[icons] input not found: ${input}`)
			process.exit(1)
		}
		const ext = path.extname(input).toLowerCase()
		if (!SUPPORTED.has(ext)) {
			console.error(`[icons] unsupported input "${ext}" — use one of ${[...SUPPORTED].join(', ')}`)
			process.exit(1)
		}
		return input
	}
	// No argument: re-render from whatever source the repo already holds, vector first.
	if (existsSync(SOURCE_SVG)) return SOURCE_SVG
	if (existsSync(SOURCE_PNG)) return SOURCE_PNG
	console.error(`[icons] no source found — pass an image: bun run icons <file.svg|png|jpg>`)
	return process.exit(1)
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	if (args.includes('--help') || args.includes('-h')) {
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
		return
	}
	const bgFlag = args.find((a) => a.startsWith('--ios-bg='))?.slice('--ios-bg='.length)
	const input = resolveInput(args.find((a) => !a.startsWith('-')))
	console.log(`[icons] source: ${input}`)

	// An SVG input becomes the checked-in vector SSOT; raster inputs live on as the PNG.
	if (path.extname(input).toLowerCase() === '.svg' && path.resolve(input) !== SOURCE_SVG) {
		copyFileSync(input, SOURCE_SVG)
		console.log(`[icons] adopted vector source → ${SOURCE_SVG}`)
	}

	const badged = await rasterizeSquare(input, 1024)
	writeFileSync(SOURCE_PNG, badged)
	writeFileSync(path.join(iconsDir, 'app-icon-source-1024.png'), badged)

	const bg = bgFlag ?? (await pickBackground(badged))
	console.log(`[icons] background: ${bg}${bgFlag ? ' (--ios-bg)' : ' (sampled)'}`)
	writeFileSync(
		SOURCE_IOS,
		await sharp(badged).flatten({ background: bg }).removeAlpha().png().toBuffer()
	)

	// Desktop, Windows and Android in one pass; this also writes icons/ios, which we redo below.
	runTauriIcon(SOURCE_PNG)
	writeAndroidBackground(bg)

	await generateIosIcons(SOURCE_IOS, iosDir, bg)
	syncIosXcassets(iosDir)

	writeFileSync(path.join(staticDir, 'app-icon.png'), badged)
	writeFileSync(path.join(staticDir, 'favicon.png'), await sharp(badged).resize(32, 32).toBuffer())
	console.log('[icons] static/app-icon.png + static/favicon.png')
	console.log('[icons] done')
}

if (import.meta.main) await main()
