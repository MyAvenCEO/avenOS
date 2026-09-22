import { realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

/** Serve only a frozen client directory, without loading the worktree's Vite plugins.
 * A later source build must not mix its index.html with the checkpoint's assets. */
export async function serveCheckpoint(directory: string, port: number) {
	const root = await realpath(directory)
	if (!(await stat(resolve(root, 'index.html'))).isFile())
		throw Error('Checkpoint index.html is missing.')
	const headers = {
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff'
	}
	async function file(name: string) {
		const path = await realpath(resolve(root, name)).catch(() => null)
		if (!path || !path.startsWith(root + sep) || !(await stat(path)).isFile()) return null
		return Bun.file(path)
	}
	return Bun.serve({
		hostname: '127.0.0.1',
		port,
		async fetch(request) {
			if (!['GET', 'HEAD'].includes(request.method))
				return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
			let name: string
			try {
				name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
			} catch {
				return new Response(null, { status: 400, headers })
			}
			if (
				name.split('/').some((part) => part === '..' || part.startsWith('.')) ||
				name.includes('\\')
			)
				return new Response(null, { status: 404, headers })
			let asset = await file(name || 'index.html')
			if (!asset && !extname(name) && request.headers.get('accept')?.includes('text/html'))
				asset = await file('index.html')
			if (!asset) return new Response(null, { status: 404, headers })
			return new Response(request.method === 'HEAD' ? null : asset, {
				headers: { ...headers, 'Content-Type': asset.type, 'Content-Length': String(asset.size) }
			})
		}
	})
}

if (import.meta.main) {
	const [directory, portText] = process.argv.slice(2),
		port = Number(portText)
	if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535)
		throw Error('Usage: bun scripts/local-checkpoint-server.ts FROZEN_DIRECTORY PORT')
	const server = await serveCheckpoint(directory, port)
	console.log(`Frozen local client ready at http://127.0.0.1:${server.port}`)
	for (const signal of ['SIGTERM', 'SIGINT'] as const)
		process.once(signal, () => {
			server.stop(true)
			process.exit(0)
		})
}
