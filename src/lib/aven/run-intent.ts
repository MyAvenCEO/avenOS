import { TinfoilAI } from 'tinfoil'
import {
	type ClassifyIntentArgs,
	classifyIntentArgsSchema,
	type InferenceSnapshot
} from './intent-request'

export async function runIntentClassification(
	intent: string,
	snapshot: InferenceSnapshot,
	apiKey: string
): Promise<
	| { ok: true; args: ClassifyIntentArgs; rawToolArguments: string }
	| { ok: false; message: string; status: number }
> {
	let toolsUnknown: unknown
	try {
		toolsUnknown = JSON.parse(snapshot.toolsJson)
	} catch {
		return { ok: false, message: 'Invalid toolsJson in snapshot.', status: 500 }
	}

	const client = new TinfoilAI({ apiKey })
	await client.ready()

	const userContent = snapshot.userIntentTemplate.includes('{{intent}}')
		? snapshot.userIntentTemplate.replaceAll('{{intent}}', intent)
		: `${snapshot.userIntentTemplate}\n\n${intent}`

	let completion: Awaited<ReturnType<TinfoilAI['chat']['completions']['create']>>
	try {
		completion = await client.chat.completions.create({
			model: snapshot.model,
			temperature: snapshot.temperature ?? 0.1,
			messages: [
				{ role: 'system', content: snapshot.systemPrompt },
				{ role: 'user', content: userContent }
			],
			tools: toolsUnknown as never,
			tool_choice: { type: 'function', function: { name: snapshot.forcedToolName } }
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return { ok: false, message, status: 502 }
	}

	const msg = completion.choices[0]?.message
	const tc = msg?.tool_calls?.[0]
	if (!tc || tc.type !== 'function') {
		return {
			ok: false,
			message: snapshot.responsesNoToolCalls ?? 'No tool call.',
			status: 422
		}
	}
	if (tc.function.name !== snapshot.forcedToolName) {
		return {
			ok: false,
			message: snapshot.responsesNoToolCalls ?? 'Unexpected tool name.',
			status: 422
		}
	}

	const raw = tc.function.arguments
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return {
			ok: false,
			message: snapshot.responsesInvalidBody ?? 'Tool arguments were not valid JSON.',
			status: 422
		}
	}

	const args = classifyIntentArgsSchema.safeParse(parsed)
	if (!args.success) {
		const msg = snapshot.responsesInvalidBody ?? args.error.issues.map((i) => i.message).join('; ')
		return { ok: false, message: msg, status: 422 }
	}

	return { ok: true, args: args.data, rawToolArguments: raw }
}
