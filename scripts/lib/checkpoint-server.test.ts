import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { serveCheckpoint } from '../local-checkpoint-server'

test('checkpoint HTML and assets stay together across later builds; routes work but files never escape', async () => {
	const directory = await mkdtemp('/tmp/aven-checkpoint-server-test-')
	let server: Awaited<ReturnType<typeof serveCheckpoint>> | undefined
	try {
		await mkdir(`${directory}/frozen`)
		await mkdir(`${directory}/later`)
		await writeFile(`${directory}/frozen/index.html`, '<script src="/frozen.js"></script>')
		await writeFile(`${directory}/frozen/frozen.js`, 'globalThis.frozen = true')
		await writeFile(`${directory}/later/index.html`, 'changed build')
		await symlink(`${directory}/later/index.html`, `${directory}/frozen/outside.html`)
		server = await serveCheckpoint(`${directory}/frozen`, 0)
		const origin = `http://127.0.0.1:${server.port}`
		const index = await fetch(origin),
			route = await fetch(`${origin}/dashboard`, { headers: { accept: 'text/html' } })
		expect(await index.text()).toContain('frozen.js')
		expect(await route.text()).toContain('frozen.js')
		expect(route.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
		await writeFile(`${directory}/later/index.html`, 'another changed build')
		expect(await (await fetch(origin)).text()).toContain('frozen.js')
		expect(await (await fetch(`${origin}/frozen.js`)).text()).toContain('frozen = true')
		for (const path of ['/missing.js', '/outside.html', '/.env', '/%2e%2e%2flater/index.html'])
			expect((await fetch(origin + path, { headers: { accept: 'text/html' } })).status).toBe(404)
		expect((await fetch(origin, { method: 'POST' })).status).toBe(405)
		const head = await fetch(`${origin}/frozen.js`, { method: 'HEAD' })
		expect(head.ok).toBe(true)
		expect(await head.text()).toBe('')
	} finally {
		server?.stop(true)
		await rm(directory, { recursive: true, force: true })
	}
})
