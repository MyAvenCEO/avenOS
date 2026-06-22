import { describe, expect, test } from 'bun:test'
import { reduceTranscribeProgress } from '../src/lib/asr/model-download-store'
import { finishLiveTranscription, startLiveTranscription } from '../src/lib/intent-mock/transcribe'

describe('reduceTranscribeProgress', () => {
	test('trims text and computes the decode fraction from done/total', () => {
		expect(reduceTranscribeProgress({ text: '  hello there ', done: 1, total: 4 })).toEqual({
			text: 'hello there',
			fraction: 0.25
		})
	})

	test('fraction is null when total is unknown (live mode reports total 0)', () => {
		expect(reduceTranscribeProgress({ text: 'so far', done: 3, total: 0 })).toEqual({
			text: 'so far',
			fraction: null
		})
	})

	test('clamps fraction into [0, 1] and defaults missing fields', () => {
		expect(reduceTranscribeProgress({ done: 9, total: 4 })).toEqual({ text: '', fraction: 1 })
		expect(reduceTranscribeProgress({})).toEqual({ text: '', fraction: null })
	})
})

describe('live transcription client', () => {
	test('startLiveTranscription is a no-op outside the Tauri runtime (no invoker call)', async () => {
		let called = false
		await startLiveTranscription(async () => {
			called = true
			return undefined
		})
		// Not in Tauri (no __TAURI_INTERNALS__ in the test env) → command is skipped.
		expect(called).toBe(false)
	})

	test('finishLiveTranscription invokes asr_stream_finish and returns trimmed fields', async () => {
		const calls: string[] = []
		const invoker = async (cmd: string) => {
			calls.push(cmd)
			return { transcript: '  done note  ', title: '  Done  ', summary: '' }
		}
		const out = await finishLiveTranscription(invoker)
		expect(out).toEqual({ transcript: 'done note', title: 'Done', summary: '' })
		expect(calls).toEqual(['asr_stream_finish'])
	})
})
