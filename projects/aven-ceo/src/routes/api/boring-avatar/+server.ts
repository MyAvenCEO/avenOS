import type { RequestHandler } from './$types'
import { beamAvatarSvg, paletteFromCommaString } from '$lib/intent-mock/beam-avatar'

function maskId(seed: string, size: number): string {
	let h = 0
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
	return `baa-${size}-${h.toString(36)}`
}

/** Same-origin SVG avatars — local beam algorithm, no upstream fetch (avoids 404 / network). */
export const GET: RequestHandler = async ({ url }) => {
	const name = (url.searchParams.get('name') ?? 'avatar').slice(0, 120)
	const sizeRaw = Number.parseInt(url.searchParams.get('size') ?? '64', 10)
	const size = Number.isFinite(sizeRaw) ? Math.min(256, Math.max(16, sizeRaw)) : 64
	const variant = url.searchParams.get('variant') ?? 'beam'
	const colorsParam = url.searchParams.get('colors')
	const palette = colorsParam
		? paletteFromCommaString(colorsParam)
		: variant === 'marble'
			? paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
			: []

	const svg = beamAvatarSvg(name, palette, size, maskId(`${name}:${variant}`, size))

	return new Response(svg, {
		headers: {
			'content-type': 'image/svg+xml; charset=utf-8',
			'cache-control': 'public, max-age=86400'
		}
	})
}
