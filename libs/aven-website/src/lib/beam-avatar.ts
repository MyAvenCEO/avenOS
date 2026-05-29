/**
 * Local “beam” avatar SVG (no network, no React).
 * Algorithm aligned with boring-avatars v2 (MIT): https://github.com/boringdesigners/boring-avatars
 */

const VIEW = 36

function hashCode(name: string): number {
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		const chr = name.charCodeAt(i)
		hash = (hash << 5) - hash + chr
		hash |= 0
	}
	return Math.abs(hash)
}

function getDigit(number: number, ntn: number): number {
	return Math.floor((number / 10 ** ntn) % 10)
}

function getBoolean(number: number, ntn: number): boolean {
	return getDigit(number, ntn) % 2 !== 0
}

function getUnit(number: number, range: number, index?: number): number {
	const value = number % range
	if (index !== undefined && getDigit(number, index) % 2 === 0) {
		return -value
	}
	return value
}

function normalizeHex(raw: string): string {
	const s = raw.startsWith('#') ? raw.slice(1) : raw
	if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#888888'
	return `#${s.toLowerCase()}`
}

/** Picks palette color like boring-avatars `getRandomColor`. */
function pickColor(number: number, colors: string[], len: number): string {
	return normalizeHex(colors[number % len])
}

function getContrast(hexcolor: string): string {
	let l = hexcolor
	if (l.startsWith('#')) l = l.slice(1)
	const r = Number.parseInt(l.slice(0, 2), 16)
	const g = Number.parseInt(l.slice(2, 4), 16)
	const b = Number.parseInt(l.slice(4, 6), 16)
	return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#000000' : '#FFFFFF'
}

function beamData(name: string, colors: string[]) {
	const num = hashCode(name)
	const len = colors.length
	const wrapperColor = pickColor(num, colors, len)
	const faceColor = getContrast(wrapperColor)
	const backgroundColor = pickColor(num + 13, colors, len)
	const n = getUnit(num, 10, 1)
	const wrapperTranslateX = n < 5 ? n + VIEW / 9 : n
	const s = getUnit(num, 10, 2)
	const wrapperTranslateY = s < 5 ? s + VIEW / 9 : s
	return {
		wrapperColor,
		faceColor,
		backgroundColor,
		wrapperTranslateX,
		wrapperTranslateY,
		wrapperRotate: getUnit(num, 360),
		wrapperScale: 1 + getUnit(num, VIEW / 12) / 10,
		isMouthOpen: getBoolean(num, 2),
		isCircle: getBoolean(num, 1),
		eyeSpread: getUnit(num, 5),
		mouthSpread: getUnit(num, 3),
		faceRotate: getUnit(num, 10, 3),
		faceTranslateX: wrapperTranslateX > VIEW / 6 ? wrapperTranslateX / 2 : getUnit(num, 8, 1),
		faceTranslateY: wrapperTranslateY > VIEW / 6 ? wrapperTranslateY / 2 : getUnit(num, 7, 2)
	}
}

const DEFAULT_PALETTE = ['#f7ead9', '#ccc7a8', '#88b499', '#305669', '#222e49']

export function paletteFromCommaString(csv: string): string[] {
	const parts = csv
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => normalizeHex(p))
	return parts.length > 0 ? parts : DEFAULT_PALETTE.map(normalizeHex)
}

/** Stable SVG string for {@html} (fixed mock inputs only). */
export function beamAvatarSvg(
	name: string,
	colors: string[],
	sizePx: number,
	domSafeMaskId: string
): string {
	const palette = colors.length > 0 ? colors : DEFAULT_PALETTE
	const t = beamData(name, palette)
	const mouthPath = t.isMouthOpen
		? `<path d="M15 ${19 + t.mouthSpread}c2 1 4 1 6 0" stroke="${t.faceColor}" fill="none" stroke-linecap="round"/>`
		: `<path d="M13,${19 + t.mouthSpread} a1,0.75 0 0,0 10,0" fill="${t.faceColor}"/>`

	return `<svg viewBox="0 0 ${VIEW} ${VIEW}" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" aria-hidden="true"><mask id="${domSafeMaskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW}" height="${VIEW}"><rect width="${VIEW}" height="${VIEW}" rx="${VIEW * 2}" fill="#FFFFFF"/></mask><g mask="url(#${domSafeMaskId})"><rect width="${VIEW}" height="${VIEW}" fill="${t.backgroundColor}"/><rect x="0" y="0" width="${VIEW}" height="${VIEW}" transform="translate(${t.wrapperTranslateX} ${t.wrapperTranslateY}) rotate(${t.wrapperRotate} ${VIEW / 2} ${VIEW / 2}) scale(${t.wrapperScale})" fill="${t.wrapperColor}" rx="${t.isCircle ? VIEW : VIEW / 6}"/><g transform="translate(${t.faceTranslateX} ${t.faceTranslateY}) rotate(${t.faceRotate} ${VIEW / 2} ${VIEW / 2})">${mouthPath}<rect x="${14 - t.eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${t.faceColor}"/><rect x="${20 + t.eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${t.faceColor}"/></g></g></svg>`
}
