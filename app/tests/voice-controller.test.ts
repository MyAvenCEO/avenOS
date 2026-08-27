import { beforeAll, describe, expect, test } from 'bun:test'
import { FakeVoiceBackend } from '../src/lib/voice/fake'

let VoiceController: typeof import('../src/lib/voice/controller.svelte').VoiceController

beforeAll(async () => {
	;(globalThis as any).$state = <T>(value: T) => value
	VoiceController = (await import('../src/lib/voice/controller.svelte')).VoiceController
})

describe('VoiceController', () => {
	test('candidate UI never confirms until the ordered semantic confirmation', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		await controller.start()
		let candidates = 0
		let confirmations = 0
		let finals: string[] = []
		controller.onInput({
			onCandidate: () => candidates++,
			onConfirmed: () => confirmations++,
			onFinal: (text) => finals.push(text)
		})

		backend.emit({
			type: 'input.candidate_started',
			candidate_id: 'candidate-1',
			far_end_active: true
		})
		backend.emit({ type: 'input.partial', candidate_id: 'candidate-1', text: 'Hallo' })
		expect({ candidates, confirmations, hearing: controller.hearing }).toEqual({
			candidates: 1,
			confirmations: 0,
			hearing: true
		})

		backend.emit({
			type: 'input.confirmed',
			candidate_id: 'candidate-1',
			barge_in_started: true
		})
		backend.emit({
			type: 'input.confirmed',
			candidate_id: 'candidate-1',
			barge_in_started: true
		})
		backend.emit({ type: 'input.final', candidate_id: 'candidate-1', text: 'Hallo Welt' })
		expect(confirmations).toBe(1)
		expect(finals).toEqual(['Hallo Welt'])
		expect(controller.hearing).toBe(false)
		controller.dispose()
	})

	test('rejects stale session, route, and sequence envelopes', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		await controller.start()
		backend.emit(
			{ type: 'input.partial', candidate_id: 'candidate-stale', text: 'wrong session' },
			{ session_id: 'another-session' }
		)
		backend.emit(
			{ type: 'input.partial', candidate_id: 'candidate-stale', text: 'wrong route' },
			{ route_generation: '999' }
		)
		backend.emit(
			{ type: 'input.partial', candidate_id: 'candidate-current', text: 'fresh' },
			{ sequence: 10 }
		)
		backend.emit(
			{ type: 'input.partial', candidate_id: 'candidate-stale', text: 'old sequence' },
			{ sequence: 9 }
		)
		expect(controller.partial).toBe('fresh')
		controller.dispose()
	})

	test('replaces a suspended session instead of treating it as started', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		await controller.start()
		const oldSession = controller.sessionId!
		backend.emit({ type: 'status.session', status: 'suspended' })
		await controller.start()
		expect(controller.sessionId).not.toBe(oldSession)
		expect(backend.stoppedSessions).toContain(oldSession)
		controller.dispose()
	})

	test('one-off preview completes through semantic playback events', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		await controller.previewSpeech('Eine Vorschau.', 'M1')
		expect(backend.segments.map((segment) => segment.text)).toEqual(['Eine Vorschau.'])
		expect(controller.speaking).toBe(false)
		controller.dispose()
	})

	test('tracks download and load progress independently for both models', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		const starting = controller.start()
		backend.emitModelStatus({ feature: 'asr', stage: 'download', progress: 0.4 })
		backend.emitModelStatus({ feature: 'tts', stage: 'load', progress: 0 })
		expect(controller.inputModelStage).toBe('download')
		expect(controller.inputModelProgress).toBe(0.4)
		expect(controller.outputModelStage).toBe('load')
		await starting
		expect(controller.inputModelStage).toBe('ready')
		expect(controller.outputModelStage).toBe('ready')
		controller.dispose()
	})

	test('enables live diagnostics and releases every subscription on dispose', async () => {
		const backend = new FakeVoiceBackend()
		const controller = new VoiceController(backend)
		await controller.start()
		expect(backend.subscriberCount).toBe(2)
		expect(backend.diagnostics.at(-1)).toEqual({
			sessionId: controller.sessionId,
			enabled: true
		})
		controller.dispose()
		expect(backend.subscriberCount).toBe(0)
		await Promise.resolve()
		expect(backend.diagnostics.at(-1)?.enabled).toBe(false)
	})
})
