import { Actor, type LlmSettings } from './actor'

/**
 * The model as a service actor (0130, straight from the abject rule: "the
 * LLM is a service abject, summoned when needed, silent otherwise").
 *
 * Every completion in the mesh is a MESSAGE to this actor — ask() answers,
 * llm-actor execution, all of it. The transport it wraps is the single
 * client of the server proxy (/api/chat, the TEE lane), so model ids,
 * temperature clamps and JSON mode have exactly one home. The bus derives
 * its lane from this actor — no ambient model function exists anymore.
 *
 * The mailbox serializes completions like any actor's messages — the
 * actor-model guarantee, accepted deliberately over parallel calls.
 */

export type LlmTransport = (
	system: string,
	question: string,
	settings?: LlmSettings & { json?: boolean }
) => Promise<string>

export class LlmActor extends Actor {
	#transport: LlmTransport

	constructor(transport: LlmTransport) {
		super({
			id: 'llm',
			name: 'LLM',
			description:
				'The model lane as an actor: relays one completion per message to the ' +
				'inference proxy. Internal service — conversation already has its own brain.',
			tags: ['system'],
			methods: [
				{
					name: 'llm_complete',
					description:
						'Internal relay: one whole completion from the model lane. Never needed ' +
						'in conversation — you are already talking to the model.',
					parameters: {
						type: 'object',
						properties: {
							system: { type: 'string' },
							question: { type: 'string' }
						},
						required: ['question']
					}
				}
			]
		})
		this.#transport = transport
		this.bind({
			llm_complete: async (p) => {
				const settings =
					p.settings && typeof p.settings === 'object'
						? (p.settings as LlmSettings & { json?: boolean })
						: undefined
				const text = await this.#transport(
					String(p.system ?? ''),
					String(p.question ?? ''),
					settings
				)
				return { record: JSON.stringify({ ok: true, text }), wire: text }
			}
		})
	}

	protected override situation(): string {
		return 'I relay completions to the inference proxy; the mesh reaches the model only through me.'
	}
}
