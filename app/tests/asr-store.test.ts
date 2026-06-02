import { describe, expect, test } from 'bun:test'
import { formatBytes, formatBytesPair } from '../src/lib/asr/format'
import {
	type AsrState,
	downloadFraction,
	initialAsrState,
	reduceAsrEvent,
	voiceUnavailableReason
} from '../src/lib/asr/model-download-store'

describe('asr readiness reducer', () => {
	test('folds download progress', () => {
		const s = reduceAsrEvent(initialAsrState, {
			status: 'downloading',
			receivedBytes: 100,
			totalBytes: 400,
			model: 'Gemma 4 E4B'
		})
		expect(s.status).toBe('downloading')
		expect(s.receivedBytes).toBe(100)
		expect(downloadFraction(s)).toBe(0.25)
	})

	test('ready fills the bar and clears error', () => {
		let s: AsrState = reduceAsrEvent(initialAsrState, {
			status: 'downloading',
			receivedBytes: 200,
			totalBytes: 400
		})
		s = reduceAsrEvent(s, { status: 'ready' })
		expect(s.status).toBe('ready')
		expect(s.receivedBytes).toBe(s.totalBytes)
		expect(s.error).toBeUndefined()
	})

	test('error keeps a message', () => {
		const s = reduceAsrEvent(initialAsrState, { status: 'error', error: 'disk full' })
		expect(s.status).toBe('error')
		expect(s.error).toBe('disk full')
	})

	test('downloadFraction is null when total unknown', () => {
		expect(downloadFraction(initialAsrState)).toBeNull()
	})
})

describe('voiceUnavailableReason', () => {
	test('null only when ready', () => {
		expect(voiceUnavailableReason({ ...initialAsrState, status: 'ready' })).toBeNull()
		expect(voiceUnavailableReason({ ...initialAsrState, status: 'downloading' })).toMatch(
			/download/i
		)
		expect(voiceUnavailableReason({ ...initialAsrState, status: 'unavailable' })).toMatch(
			/not available/i
		)
		expect(voiceUnavailableReason({ ...initialAsrState, status: 'error', error: 'boom' })).toMatch(
			/boom/
		)
	})
})

describe('byte formatting', () => {
	test('formatBytes', () => {
		expect(formatBytes(0)).toBe('0 MB')
		expect(formatBytes(312 * 1024 * 1024)).toBe('312 MB')
		expect(formatBytes(4.1 * 1024 * 1024 * 1024)).toBe('4.1 GB')
	})

	test('formatBytesPair omits unknown total', () => {
		expect(formatBytesPair(100 * 1024 * 1024, 0)).toBe('100 MB')
		expect(formatBytesPair(100 * 1024 * 1024, 1024 * 1024 * 1024)).toBe('100 MB / 1.0 GB')
	})
})
