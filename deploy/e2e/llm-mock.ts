const encoder = new TextEncoder()

Bun.serve({
	port: 8090,
	fetch: async (request) => {
		const url = new URL(request.url)
		if (url.pathname === '/health') return Response.json({ status: 'ok' })
		if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions')
			return Response.json({ error: { message: 'not found' } }, { status: 404 })
		const body = (await request.json()) as { stream?: boolean; model?: string }
		if (body.stream) {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ id: 'chat-e2e', model: body.model, choices: [{ delta: { content: 'E2E chat reply.' }, finish_reason: null }] })}\n\n`
						)
					)
					controller.enqueue(encoder.encode('data: [DONE]\n\n'))
					controller.close()
				}
			})
			return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
		}
		return Response.json({
			id: 'completion-e2e',
			model: body.model,
			choices: [
				{ message: { role: 'assistant', content: 'E2E chat reply.' }, finish_reason: 'stop' }
			],
			usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 }
		})
	}
})
