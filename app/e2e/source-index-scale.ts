/** Real Chromium/IndexedDB benchmark; builds once, then measures bounded indexed queries. */
import { chromium } from '@playwright/test'

const built = await Bun.build({
	entrypoints: ['app/src/lib/intents/source-index.ts'],
	target: 'browser',
	format: 'esm'
})
if (!built.success) throw Error(String(built.logs))
const code = await built.outputs[0].text()
const server = Bun.serve({
	port: 0,
	hostname: '127.0.0.1',
	fetch: (r) =>
		new URL(r.url).pathname === '/index.js'
			? new Response(code, { headers: { 'content-type': 'text/javascript' } })
			: new Response('<html><body>Source index performance test</body></html>', {
					headers: { 'content-type': 'text/html' }
				})
})
const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage()
	await page.goto(`http://127.0.0.1:${server.port}`)
	const report = await page.evaluate(async () => {
		const modulePath = '/index.js'
		const { DiskSourceIndex } = await import(modulePath)
		const index = new DiskSourceIndex(`scale-${crypto.randomUUID()}`)
		const results = []
		let inserted = 0
		for (const size of [1000, 10000, 100000]) {
			const started = performance.now()
			while (inserted < size) {
				const batch = []
				for (let j = 0; j < 500 && inserted < size; j++, inserted++) {
					batch.push({
						entry: {
							artifactId: String(inserted).padStart(9, '0'),
							intentId: `intent-${inserted % 1000}`,
							title: 'Statement',
							kind: 'text',
							createdAt: '2026-03-01'
						},
						text: {
							content: `Invoice reference REF-${inserted}. Payment pending. ${'Synthetic customer correspondence and financial records. '.repeat(8)}`,
							complete: true
						}
					})
				}
				await index.putBatch(batch)
			}
			const buildMs = performance.now() - started
			const timings = []
			let maxExamined = 0
			for (let run = 0; run < 30; run++) {
				const start = performance.now()
				const hit = await index.search(
					run % 3 === 0
						? { query: `REF-${size - 1}` }
						: run % 3 === 1
							? { query: 'invoice' }
							: { query: 'invoice', intent: `intent-${(size - 1) % 1000}` }
				)
				timings.push(performance.now() - start)
				maxExamined = Math.max(maxExamined, hit.examined)
				if (hit.files.length > 20 || hit.examined > 200)
					throw Error('Search exceeded its fixed bounds')
				if (run % 3 === 0 && hit.files[0]?.artifactId !== String(size - 1).padStart(9, '0'))
					throw Error('Indexed lookup missed the target')
			}
			timings.sort((a, b) => a - b)
			results.push({
				documents: size,
				incrementalBuildMs: buildMs,
				p50Ms: timings[15],
				p95Ms: timings[28],
				maxExamined
			})
		}
		index.close()
		return { engine: navigator.userAgent, results }
	})
	console.log(JSON.stringify(report, null, 2))
	await Bun.write(
		process.env.SOURCE_INDEX_EVIDENCE_PATH ?? '/tmp/source-index-scale.json',
		JSON.stringify(report, null, 2)
	)
	if (report.results.some((r) => r.p95Ms > 250)) throw Error('Indexed query p95 exceeded 250 ms')
} finally {
	await browser.close()
	server.stop()
}
