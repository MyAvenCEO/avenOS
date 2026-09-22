import { expect, test } from 'bun:test'
import { formatDuration, type ToolCall, toolPurpose } from '@avenos/chat-engine/tool-call'
import { readToolPreview, toolPreview, toolPreviews } from '@avenos/chat-engine/tool-preview'
import {
	callsFromPayload,
	responseDurationFromPayload,
	turnPayload
} from '@avenos/chat-engine/turn-payload'

test('timing never rounds real work to zero and does not fabricate missing measurements', () => {
	expect([0, 0.03, 1, 24, 999, 1400, 62345].map(formatDuration)).toEqual([
		'< 1 ms',
		'< 1 ms',
		'1 ms',
		'24 ms',
		'999 ms',
		'1.4 s',
		'1 min 2 s'
	])
	expect(formatDuration(undefined)).toBe('nicht erfasst')
	expect(formatDuration(-1)).toBe('nicht erfasst')
	expect(responseDurationFromPayload({ responseDurationMs: 63214 })).toBe(63214)
	expect(responseDurationFromPayload({ responseDurationMs: -1 })).toBeUndefined()
})

test('task cards require complete observed receipts, survive history bounds, and distinguish trials', () => {
	const receipt = {
		ok: true,
		mode: 'production',
		operation: 'create',
		operationId: crypto.randomUUID(),
		completedAt: new Date().toISOString(),
		tasks: Array.from({ length: 12 }, (_, i) => ({
			id: crypto.randomUUID(),
			revision: 1,
			title: `Inspect invented workshop station ${i + 1}`,
			tags: [],
			due: null,
			responsible: null,
			group: 'team',
			status: 'open',
			archived: false,
			ownerSubjectId: crypto.randomUUID(),
			intentId: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}))
	}
	const call: ToolCall = {
		id: 'task-proof',
		name: 'todo_create',
		arguments: '{}',
		status: 'completed',
		result: JSON.stringify(receipt)
	}
	const preview = toolPreview(call)
	expect(preview).toMatchObject({ kind: 'tasks', mode: 'production', count: 12 })
	expect(preview?.kind === 'tasks' && preview.tasks.length).toBe(5)
	expect(JSON.stringify(preview)).not.toContain(receipt.tasks[0]!.ownerSubjectId)
	expect(JSON.stringify(preview)).not.toContain(receipt.operationId)
	const saved = callsFromPayload(
		turnPayload({ id: 'turn', role: 'assistant', content: '', calls: [call] })
	)[0]!
	expect(toolPreview({ ...saved, result: '… Saved detail truncated' })).toEqual(preview)
	expect(
		toolPreview({ ...call, result: JSON.stringify({ ...receipt, mode: 'trial' }) })
	).toMatchObject({ mode: 'trial' })
	expect(toolPreview({ ...call, status: 'running' })).toBeNull()
	expect(toolPreview({ ...call, result: JSON.stringify({ ...receipt, ok: false }) })).toBeNull()
	expect(
		toolPreview({
			...call,
			result: JSON.stringify({ ...receipt, tasks: [{ title: 'Not a receipt' }] })
		})
	).toBeNull()
	expect(toolPreview({ ...call, name: 'todo_archive' })).toBeNull()
	expect(readToolPreview({ ...preview, count: 2 })).toBeNull()
	expect(readToolPreview({ ...preview, mode: 'maybe' })).toBeNull()
})
test('connection intent is readable without claiming the requested action succeeded', () => {
	const call: ToolCall = {
		id: 'synthetic',
		name: 'studio_control',
		arguments: '{}',
		status: 'running',
		result: ''
	}
	expect(toolPurpose({ ...call, arguments: '{"enabled":false}' })).toBe(
		'Automatische Verarbeitung pausieren'
	)
	expect(toolPurpose({ ...call, arguments: '{"enabled":true}', status: 'failed' })).toBe(
		'Automatische Verarbeitung fortsetzen'
	)
	expect(toolPurpose({ ...call, name: 'studio_state' })).toBe(
		'Skills, Verbindungen und Ausführungen prüfen'
	)
	expect(toolPurpose({ ...call, name: 'studio_connect', arguments: '{"enabled":false}' })).toBe(
		'Eine automatische Verbindung vorbereiten'
	)
})
test('preview cards preserve purpose, distinguish acceptance from success, and omit failed outcomes', () => {
	const call: ToolCall = {
		id: 'x',
		name: 'calculate',
		status: 'completed',
		arguments: JSON.stringify({
			purpose: 'Synthetische Materialkosten mit Verpackung'
		}),
		result: JSON.stringify({
			outputs: {
				calculation: {
					purpose: 'Synthetische Materialkosten mit Verpackung',
					operands: [
						{ value: '42.70', unit: 'currency:EUR' },
						{ value: '1.35', unit: 'currency:EUR' }
					],
					result: { value: '44.05', unit: 'currency:EUR' },
					text: '42.70 + 1.35 = 44.05',
					exact: true
				}
			}
		})
	}
	expect(toolPurpose(call)).toBe('Synthetische Materialkosten mit Verpackung')
	expect(toolPreview(call)?.kind).toBe('calculation')
	expect(toolPreview({ ...call, status: 'failed' })).toBeNull()
	expect(toolPurpose({ ...call, arguments: 'null' })).toBe('Mit den angegebenen Werten rechnen')
	expect(
		toolPreview({
			...call,
			name: 'studio_start',
			result: JSON.stringify({ runId: 'r', state: 'accepted' })
		})
	).toMatchObject({ status: 'Angefordert · noch nicht abgeschlossen' })
	expect(
		toolPreview({
			...call,
			name: 'studio_run_status',
			result: JSON.stringify({ runId: 'r', state: 'failed' })
		})
	).toMatchObject({ status: 'Fehlgeschlagen' })
	expect(toolPreview({ ...call, result: '{"ok":false}' })).toBeNull()
	const runCalls = ['accepted', 'succeeded'].map(
		(state, i): ToolCall => ({
			id: `synthetic-run-call-${i}`,
			name: i ? 'studio_run_status' : 'studio_start',
			arguments: '{}',
			status: 'completed',
			result: JSON.stringify({ runId: 'synthetic-run', state })
		})
	)
	const restored = callsFromPayload(
		turnPayload({
			id: 'synthetic-turn',
			role: 'assistant',
			content: '',
			calls: runCalls
		})
	).map((c) => ({ ...c, result: '… Saved detail truncated' }))
	expect(toolPreviews(restored)).toMatchObject([
		{ preview: { kind: 'receipt', runId: 'synthetic-run', status: 'Abgeschlossen' } }
	])
	const payload = turnPayload({
		id: 'a',
		role: 'assistant',
		content: 'Ergebnis',
		calls: [call],
		durationMs: 60001
	})
	expect(responseDurationFromPayload(payload)).toBe(60001)
	expect(
		toolPreview({
			...callsFromPayload(payload)[0]!,
			result: '… Saved detail truncated'
		})
	).toMatchObject({
		kind: 'calculation',
		value: { purpose: 'Synthetische Materialkosten mit Verpackung' }
	})
})
