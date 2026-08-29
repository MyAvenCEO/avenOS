const encoder = new TextEncoder()

Bun.serve({
	port: 8090,
	fetch: async (request) => {
		const url = new URL(request.url)
		if (url.pathname === '/health') return Response.json({ status: 'ok' })
		if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions')
			return Response.json({ error: { message: 'not found' } }, { status: 404 })
		const body = (await request.json()) as {
			stream?: boolean
			model?: string
			messages?: Array<{ role?: string; content?: string }>
		}
		if (body.stream) {
			const lastUser = body.messages?.findLast((message) => message.role === 'user')?.content
			if (lastUser === 'Start E2E narrated answer') {
				let tail: ReturnType<typeof setTimeout> | undefined
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({ id: 'chat-e2e-slow', model: body.model, choices: [{ delta: { content: 'E2E narration begins. ' }, finish_reason: null }] })}\n\n`
							)
						)
						tail = setTimeout(() => {
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({ id: 'chat-e2e-slow', model: body.model, choices: [{ delta: { content: 'E2E narration tail must be cancelled.' }, finish_reason: null }] })}\n\n`
								)
							)
							controller.enqueue(encoder.encode('data: [DONE]\n\n'))
							controller.close()
						}, 2_000)
					},
					cancel() {
						if (tail) clearTimeout(tail)
					}
				})
				return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
			}
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
