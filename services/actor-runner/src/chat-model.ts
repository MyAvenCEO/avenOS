import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import type { HttpLlmGatewayClient } from '@avenos/llm-client/http'

/** Service transport only; native and background Chat share request/framing rules. */
export function createServerChatModel(client: HttpLlmGatewayClient, modelId: string) {
	if (!modelId.trim()) throw Error('Select an installed chat model.')
	return createGatewayModelStream({
		request: (input) => chatGatewayRequest({ ...input, model: input.model ?? modelId }),
		open: async function* (request, signal) {
			const response = await client.openAiChatCompletion(request, { signal })
			if (
				!response.body ||
				!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')
			) {
				await response.body?.cancel()
				throw Error('The chat gateway did not return a model stream.')
			}
			const decoder = new TextDecoder()
			for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
			yield decoder.decode()
		}
	})
}
