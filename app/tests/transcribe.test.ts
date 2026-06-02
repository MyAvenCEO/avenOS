import { describe, expect, test } from 'bun:test'
import { transcribeAudio } from '../src/lib/intent-mock/transcribe'

describe('transcribeAudio', () => {
	test('invokes transcribe_audio with a plain number array + sampleRate, returns trimmed fields', async () => {
		const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
		const invoker = async (cmd: string, args: Record<string, unknown>) => {
			calls.push({ cmd, args })
			return { transcript: '  hello world  ', title: '  Hi  ', summary: '  A greeting  ' }
		}
		const out = await transcribeAudio(
			{ pcm: new Float32Array([0.1, -0.2, 0.3]), sampleRate: 16_000 },
			invoker
		)
		expect(out).toEqual({ transcript: 'hello world', title: 'Hi', summary: 'A greeting' }) // trimmed
		expect(calls).toHaveLength(1)
		expect(calls[0].cmd).toBe('transcribe_audio')
		expect(Array.isArray(calls[0].args.pcm)).toBe(true)
		expect((calls[0].args.pcm as number[]).length).toBe(3)
		expect(calls[0].args.sampleRate).toBe(16_000)
	})

	test('propagates backend errors so the caller can surface them', async () => {
		const invoker = async () => {
			throw new Error('model downloading')
		}
		await expect(
			transcribeAudio({ pcm: new Float32Array([0]), sampleRate: 16_000 }, invoker)
		).rejects.toThrow('model downloading')
	})

	test('tolerates missing fields in the reply', async () => {
		const invoker = async () => ({ transcript: 'just text' }) as unknown
		const out = await transcribeAudio({ pcm: new Float32Array([0]), sampleRate: 16_000 }, invoker)
		expect(out).toEqual({ transcript: 'just text', title: '', summary: '' })
	})
})
