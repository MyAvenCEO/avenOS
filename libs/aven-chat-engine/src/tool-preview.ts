import type { ToolCall } from '@avenos/chat-engine/tool-call'
import { toolPurpose, toolResultFailed } from '@avenos/chat-engine/tool-call'
import { taskReceiptSchema, taskSchema } from '@avenos/productivity/tasks'

const objectValue = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}

import type { ToolPreview } from '@avenos/chat-engine/tool-call'

export type { ToolPreview } from '@avenos/chat-engine/tool-call'

const text = (value: unknown) =>
	typeof value === 'string' ? (value.length > 240 ? `${value.slice(0, 239)}…` : value) : ''
const missing = (count: number) => `${count} fehlende${count === 1 ? 'r Baustein' : ' Bausteine'}`
const taskRowSchema = taskSchema.pick({
	title: true,
	status: true,
	archived: true,
	group: true,
	due: true,
	responsible: true
})

export function readToolPreview(value: unknown): ToolPreview | null {
	const p = objectValue(value)
	if (
		p.kind === 'tasks' &&
		['create', 'update', 'archive'].includes(String(p.operation)) &&
		['production', 'trial'].includes(String(p.mode)) &&
		Number.isInteger(p.count) &&
		Number(p.count) >= 1 &&
		Number(p.count) <= 50 &&
		Array.isArray(p.tasks) &&
		p.tasks.length === Math.min(Number(p.count), 5)
	) {
		const rows = p.tasks.map((row) => taskRowSchema.safeParse(row))
		if (rows.every((row) => row.success))
			return {
				kind: 'tasks',
				operation: p.operation as 'create' | 'update' | 'archive',
				mode: p.mode as 'production' | 'trial',
				count: Number(p.count),
				tasks: rows.map((row) => row.data!)
			}
	}
	if (
		p.kind === 'receipt' &&
		typeof p.title === 'string' &&
		typeof p.status === 'string' &&
		Array.isArray(p.details) &&
		p.details.every((d) => typeof d === 'string')
	)
		return {
			kind: 'receipt',
			title: text(p.title),
			status: text(p.status),
			...(typeof p.runId === 'string' ? { runId: text(p.runId) } : {}),
			details: p.details.slice(0, 16).map(text)
		}
	if (
		p.kind === 'calculation' &&
		Array.isArray(objectValue(p.value).operands) &&
		objectValue(p.value).result
	)
		return { kind: 'calculation', value: objectValue(p.value) }
	if (
		p.kind === 'knowledge' &&
		['rows', 'summary'].includes(String(objectValue(objectValue(p.value).query).view))
	)
		return { kind: 'knowledge', value: objectValue(p.value) }
	return null
}

export function toolPreviews(calls: ToolCall[]) {
	const found = new Map<string, { id: string; preview: ToolPreview }>()
	for (const call of calls) {
		const preview = toolPreview(call)
		if (!preview) continue
		let key = call.id
		if (['studio_start', 'studio_run_status'].includes(call.name)) {
			if (preview.kind === 'receipt' && preview.runId) key = `run:${preview.runId}`
		}
		// Keep one latest observation per durable run, not a pile of polling receipts.
		found.delete(key)
		found.set(key, { id: call.id, preview })
	}
	return [...found.values()]
}

/** Only observed structured outcomes become cards. Never turn a tool name into a success claim. */
export function toolPreview(call: ToolCall): ToolPreview | null {
	if (call.status !== 'completed' || toolResultFailed(call.result)) return null
	if (call.preview) return readToolPreview(call.preview)
	let result: Record<string, unknown>
	try {
		result = objectValue(JSON.parse(call.result))
	} catch {
		return null
	}
	const outputs = objectValue(result.outputs)
	if (
		['todo_create', 'todo_update', 'todo_archive'].includes(call.name) &&
		result.ok === true &&
		['production', 'trial'].includes(String(result.mode))
	) {
		const { ok: _ok, mode, ...value } = result
		const receipt = taskReceiptSchema.safeParse(value)
		if (!receipt.success || call.name !== `todo_${receipt.data.operation}`) return null
		return {
			kind: 'tasks',
			operation: receipt.data.operation,
			mode: mode as 'production' | 'trial',
			count: receipt.data.tasks.length,
			tasks: receipt.data.tasks.slice(0, 5).map((task) =>
				taskRowSchema.parse({
					title: task.title,
					status: task.status,
					archived: task.archived,
					group: task.group,
					due: task.due,
					responsible: task.responsible
				})
			)
		}
	}
	if (['studio_case_propose', 'studio_case_revise'].includes(call.name) && result.artifactId) {
		const plan = objectValue(objectValue(result.payload).case)
		if (typeof plan.title === 'string' && Array.isArray(plan.steps)) {
			const gaps = plan.steps.filter((step) => objectValue(step).kind === 'ideal').length
			return {
				kind: 'receipt',
				title: text(plan.title),
				status: gaps
					? `Plan gespeichert · ${missing(gaps)}`
					: 'Fall gespeichert · Bestätigung ausstehend',
				details: [
					text(plan.outcome),
					`${plan.steps.length} Schritte · nicht ausgeführt`,
					`Fall ${text(result.artifactId)}`
				]
			}
		}
	}
	if (call.name === 'studio_case_what_if' && result.mode === 'structural-what-if')
		return {
			kind: 'receipt',
			title: 'Was wäre möglich?',
			status: 'Hypothetischer Ablauf · nicht ausgeführt',
			details: [
				missing(Number(result.gaps) || 0),
				...(Array.isArray(result.steps)
					? result.steps.slice(0, 6).map((step) => {
							const s = objectValue(step)
							return `${text(s.title ?? s.label ?? s.needs) || 'Schritt'} · ${s.status === 'needs-implementation' ? 'Umsetzung fehlt' : s.status === 'depends-on-ideal' ? 'hängt von fehlendem Baustein ab' : 'nicht ausgeführt'}`
						})
					: [])
			]
		}
	if (call.name === 'calculate') {
		const value = objectValue(outputs.calculation)
		return Array.isArray(value.operands) && value.result ? { kind: 'calculation', value } : null
	}
	if (call.name === 'knowledge_query') {
		const value = objectValue(outputs.result)
		return ['rows', 'summary'].includes(String(objectValue(value.query).view)) && value.data
			? { kind: 'knowledge', value }
			: null
	}
	if (['studio_start', 'studio_run_status'].includes(call.name) && result.runId) {
		const state = text(result.state) || 'accepted'
		const status: Record<string, string> = {
			accepted: 'Angefordert · noch nicht abgeschlossen',
			planning: 'Wird geplant',
			running: 'Läuft',
			succeeded: 'Abgeschlossen',
			failed: 'Fehlgeschlagen',
			waiting_for_input: 'Eingabe erforderlich',
			cancelled: 'Abgebrochen'
		}
		return {
			kind: 'receipt',
			title: 'Skill-Ausführung',
			runId: text(result.runId),
			status: status[state] ?? state,
			details: [
				...(objectValue(result.failure).message ? [text(objectValue(result.failure).message)] : []),
				...(Array.isArray(result.completedStepIds)
					? [`${result.completedStepIds.length} Schritte abgeschlossen`]
					: []),
				`Ausführung ${text(result.runId)}`
			]
		}
	}
	if (call.name === 'studio_publish') {
		const artifact = objectValue(result.artifact),
			payload = objectValue(artifact.payload)
		if (artifact.artifactId)
			return {
				kind: 'receipt',
				title:
					text(objectValue(payload.definition).name) ||
					text(payload.name) ||
					'Skill veröffentlicht',
				status: 'Veröffentlicht · nicht ausgeführt',
				details: [`Artefakt ${text(artifact.artifactId)}`]
			}
	}
	if (['studio_author', 'studio_draft'].includes(call.name)) {
		const definition = call.name === 'studio_author' ? result : objectValue(result.definition)
		if (result.id && definition.name)
			return {
				kind: 'receipt',
				title: text(definition.name),
				status: 'Entwurf gespeichert',
				details: [
					Array.isArray(definition.steps)
						? `${definition.steps.length} Schritte`
						: 'Definition gespeichert',
					`Revision ${result.revision}`
				]
			}
	}
	// A typed artifact envelope is sufficient to share the library's factual metadata,
	// but an inspection is not evidence that this call created that artifact.
	const artifact = objectValue(result.artifact)
	if (artifact.artifactId && artifact.typeKey === 'core.file') {
		const payload = objectValue(artifact.payload)
		return {
			kind: 'receipt',
			title: text(payload.originalName) || 'Dokument',
			status: toolPurpose(call),
			details: [text(payload.declaredMediaType), `Artefakt ${text(artifact.artifactId)}`].filter(
				Boolean
			)
		}
	}
	return null
}
