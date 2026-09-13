// Disposable memory fixture: production ingress, a stalled model transport, no customer services.
import { readFile } from 'node:fs/promises'
import { testConfig } from '../helpers'

const root = process.env.FACADE_SOURCE_ROOT
if (!root) throw new Error('FACADE_SOURCE_ROOT is required')
const { createFacadeHandler } = await import(`${root}/services/aven-api/src/facade.ts`)
const token = 'disposable-memory-proof'.padEnd(32, '-')
const release = Promise.withResolvers<void>()
let active = 0
const handler = createFacadeHandler(
	testConfig({ LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN: token }),
	{
		verify: async () => {
			throw new Error('The fixture uses internal service authentication')
		}
	},
	undefined,
	undefined,
	undefined,
	undefined,
	{
		complete: async (value: { messages: Array<{ content: Array<{ base64: string }> }> }) => {
			active++
			try {
				await release.promise
				return {
					retainedBytes: value.messages[0]!.content.reduce(
						(sum, image) => sum + image.base64.length,
						0
					)
				}
			} finally {
				active--
			}
		}
	}
)
Bun.serve({
	port: 9093,
	maxRequestBodySize: 160 * 1024 * 1024,
	async fetch(request) {
		const path = new URL(request.url).pathname
		if (path === '/release') {
			release.resolve()
			return Response.json({ released: true })
		}
		if (path === '/stats')
			return Response.json({
				active,
				rss: process.memoryUsage().rss,
				peak: Number(await readFile('/sys/fs/cgroup/memory.peak', 'utf8'))
			})
		return handler(request)
	}
})
