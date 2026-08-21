import { fileURLToPath } from 'node:url'
import {
	editableTemplateSummaries,
	loadEditableEmailTemplate,
	previewEmailTemplate,
	saveEditableEmailTemplate
} from './compiler.js'

const studioHtmlPath = fileURLToPath(new URL('./studio.html', import.meta.url))
const sessionToken = crypto.randomUUID()
const requestedPort = Number(
	Bun.argv.find((argument) => argument.startsWith('--port='))?.split('=')[1]
)
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4176
const maximumRequestBytes = 300_000

function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: {
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	})
}

function authorized(request: Request): boolean {
	return request.headers.get('x-email-studio-token') === sessionToken
}

async function requestBody(request: Request): Promise<{
	key: string
	source: string
	metadata: unknown
}> {
	const contentLength = Number(request.headers.get('content-length') ?? 0)
	if (contentLength > maximumRequestBytes) throw new Error('The template is too large.')
	const value = (await request.json()) as Record<string, unknown>
	if (typeof value.key !== 'string' || typeof value.source !== 'string') {
		throw new Error('The editor request is invalid.')
	}
	if (value.source.length > maximumRequestBytes) throw new Error('The template is too large.')
	return { key: value.key, source: value.source, metadata: value.metadata }
}

const server = Bun.serve({
	hostname: '127.0.0.1',
	port,
	async fetch(request) {
		const url = new URL(request.url)
		try {
			if (request.method === 'GET' && url.pathname === '/') {
				const html = (await Bun.file(studioHtmlPath).text()).replace(
					'__EMAIL_STUDIO_TOKEN__',
					JSON.stringify(sessionToken)
				)
				return new Response(html, {
					headers: {
						'cache-control': 'no-store',
						'content-type': 'text/html; charset=utf-8',
						'referrer-policy': 'no-referrer',
						'x-content-type-options': 'nosniff',
						'x-frame-options': 'DENY'
					}
				})
			}
			if (request.method === 'GET' && url.pathname === '/api/templates') {
				return json({ templates: editableTemplateSummaries() })
			}
			if (request.method === 'GET' && url.pathname === '/api/template') {
				return json(await loadEditableEmailTemplate(url.searchParams.get('key') ?? ''))
			}
			if (!authorized(request)) return json({ message: 'Editor session expired.' }, 403)
			if (request.method === 'POST' && url.pathname === '/api/preview') {
				const body = await requestBody(request)
				return json(await previewEmailTemplate(body.key, body.source, body.metadata))
			}
			if (request.method === 'POST' && url.pathname === '/api/save') {
				const body = await requestBody(request)
				await saveEditableEmailTemplate(body.key, body.source, body.metadata)
				return json({ saved: true })
			}
			return json({ message: 'Not found.' }, 404)
		} catch (error) {
			return json(
				{ message: error instanceof Error ? error.message : 'The email studio request failed.' },
				400
			)
		}
	}
})

console.info(`Aven email studio: http://${server.hostname}:${server.port}`)
console.info('Press Ctrl+C to stop.')
