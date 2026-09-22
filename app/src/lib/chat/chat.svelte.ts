import { ChatCore } from '@avenos/chat-engine/chat'
import { streamChat } from './redpill'

export * from '@avenos/chat-engine/chat'
export class Chat extends ChatCore {
	constructor(...args: ConstructorParameters<typeof ChatCore>) {
		super(
			args[0],
			args[1],
			args[2] ?? streamChat,
			args[3] ?? args[2] ?? streamChat,
			args[4],
			(value) => {
				const state = $state(value)
				return state
			},
			args[6]
		)
	}
}
