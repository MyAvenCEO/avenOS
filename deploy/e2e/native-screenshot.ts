import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import type { TauriSession } from './tauri-driver'

/** Capture the real native view, never a browser reconstruction. */
export async function nativeScreenshot(session: TauriSession): Promise<Buffer> {
	const capture = process.env.E2E_NATIVE_CAPTURE ?? 'webdriver'
	assert(['webdriver', 'xvfb'].includes(capture))
	if (capture === 'webdriver') return Buffer.from(await session.screenshot(), 'base64')
	// The framebuffer alternative is restricted to an owned xvfb-run display.
	// Never capture the customer's interactive desktop through this path.
	assert(
		/^:[1-9][0-9]+$/.test(process.env.DISPLAY ?? '') &&
			/^\/tmp\/xvfb-run\.[^/]+\/Xauthority$/.test(process.env.XAUTHORITY ?? '')
	)
	const bytes = execFileSync('xwd', ['-root', '-silent'], {
		timeout: 10_000,
		maxBuffer: 32 * 1024 * 1024
	})
	assert(bytes.length >= 100)
	const h = Array.from({ length: 25 }, (_, i) => bytes.readUInt32BE(i * 4))
	// XWD v7 header is big-endian; accept only the tested Xvfb visual format.
	assert(
		h[1] === 7 && h[2] === 2 && h[3] === 24 && h[6] === 0 && h[7] === 0 && [24, 32].includes(h[11]!)
	)
	assert([4, 5].includes(h[13]!) && h[14] === 0xff0000 && h[15] === 0xff00 && h[16] === 0xff)
	const width = h[4]!,
		height = h[5]!,
		stride = h[12]!,
		offset = h[0]! + h[19]! * 12
	const pixelBytes = h[11]! / 8
	assert(width > 0 && height > 0 && width * height <= 8_000_000 && stride >= width * pixelBytes)
	assert(offset >= 100 && offset + stride * height <= bytes.length)
	if (h[13] === 5) {
		for (let i = 0; i < h[19]!; i++) {
			const entry = h[0]! + i * 12,
				pixel = bytes.readUInt32BE(entry)
			assert(
				bytes.readUInt16BE(entry + 4) === ((pixel >>> 16) & 255) * 257 &&
					bytes.readUInt16BE(entry + 6) === ((pixel >>> 8) & 255) * 257 &&
					bytes.readUInt16BE(entry + 8) === (pixel & 255) * 257
			)
		}
	}
	const rgb = Buffer.alloc(width * height * 3)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const source = offset + y * stride + x * pixelBytes,
				target = (y * width + x) * 3
			rgb[target] = bytes[source + 2]!
			rgb[target + 1] = bytes[source + 1]!
			rgb[target + 2] = bytes[source]!
		}
	}
	return sharp(rgb, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer()
}
