#!/usr/bin/env bun
/**
 * Downloads webcm assets (webcm.mjs + webcm.wasm) into lib/app/static/webcm/.
 * Uses GitHub Pages so wasm resolves next to .mjs via import.meta.url.
 *
 * Usage: bun run scripts/fetch-webcm.ts
 *
 * Optional: WEBCM_EXPECT_SHA256_webcm_wasm=<hex> to verify the wasm blob.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outDir = path.join(repoRoot, 'lib/app/static/webcm')

const BASE = 'https://edubart.github.io/webcm'
const FILES = [
	{ name: 'webcm.mjs', url: `${BASE}/webcm.mjs` },
	{ name: 'webcm.wasm', url: `${BASE}/webcm.wasm` }
] as const

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
	const hash = createHash('sha256')
	hash.update(new Uint8Array(buf))
	return hash.digest('hex')
}

async function main() {
	await mkdir(outDir, { recursive: true })

	for (const { name, url } of FILES) {
		process.stdout.write(`fetch-webcm: ${url} … `)
		const res = await fetch(url)
		if (!res.ok) {
			throw new Error(`GET ${url} → ${res.status}`)
		}
		const buf = await res.arrayBuffer()
		if (name === 'webcm.wasm') {
			const expect = process.env.WEBCM_EXPECT_SHA256_webcm_wasm
			if (expect) {
				const got = await sha256Hex(buf)
				if (got !== expect.trim().toLowerCase()) {
					throw new Error(`webcm.wasm sha256 mismatch: want ${expect}, got ${got}`)
				}
			}
		}
		const outPath = path.join(outDir, name)
		await writeFile(outPath, Buffer.from(buf))
		console.log(
			`${(buf.byteLength / (1024 * 1024)).toFixed(2)} MiB → ${path.relative(repoRoot, outPath)}`
		)
	}

	console.log('fetch-webcm: done.')
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
