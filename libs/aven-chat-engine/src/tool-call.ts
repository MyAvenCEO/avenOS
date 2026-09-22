import type { Task } from '@avenos/productivity/tasks'

export type TaskPreviewRow = Pick<
	Task,
	'title' | 'status' | 'archived' | 'group' | 'due' | 'responsible'
>
export type ToolPreview =
	| { kind: 'calculation'; value: Record<string, unknown> }
	| { kind: 'knowledge'; value: Record<string, unknown> }
	| { kind: 'receipt'; title: string; status: string; details: string[]; runId?: string }
	| {
			kind: 'tasks'
			operation: 'create' | 'update' | 'archive'
			mode: 'production' | 'trial'
			count: number
			tasks: TaskPreviewRow[]
	  }
export interface ToolCall {
	id: string
	name: string
	arguments: string
	status: 'running' | 'completed' | 'failed' | 'interrupted'
	result: string
	error?: string
	durationMs?: number
	/** Recovery checked an existing receipt; this is not the lost execution duration. */
	durationBasis?: 'receipt-check' | 'read-again' | 'recomputed'
	startedAt?: number
	preview?: ToolPreview
}

export function formatDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'nicht erfasst'
	if (ms < 1) return '< 1 ms'
	if (ms < 1000) return `${Math.floor(ms)} ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
	return `${Math.floor(ms / 60000)} min ${Math.floor((ms % 60000) / 1000)} s`
}

export function toolPurpose(call: ToolCall): string {
	let args: Record<string, unknown> = {}
	try {
		const parsed = JSON.parse(call.arguments)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
	} catch {
		/* Incomplete arguments stay technical. */
	}
	if (
		['calculate', 'knowledge_query', 'workspace_search', 'workspace_read'].includes(call.name) &&
		typeof args.purpose === 'string' &&
		args.purpose.trim()
	)
		return args.purpose.slice(0, 240)
	if (call.name === 'studio_control' && typeof args.enabled === 'boolean')
		return args.enabled
			? 'Automatische Verarbeitung fortsetzen'
			: 'Automatische Verarbeitung pausieren'
	if (call.name === 'studio_connect' && typeof args.enabled === 'boolean')
		return args.enabled
			? 'Automatische Verarbeitung verbinden und aktivieren'
			: 'Eine automatische Verbindung vorbereiten'
	if (call.name === 'knowledge_query') {
		const collections: Record<string, string> = {
			documents: 'Dokumente',
			invoices: 'Rechnungen',
			statements: 'Kontoauszüge',
			transactions: 'Buchungen',
			'line-items': 'Positionen'
		}
		const collection = collections[String(args.collection)] ?? 'Gespeicherte Daten'
		return `${collection}: ${args.view === 'schema' ? 'verfügbare Felder prüfen' : args.view === 'summary' ? 'Auswahl zählen und zusammenfassen' : 'passende Einträge ansehen'}`
	}
	const labels: Record<string, string> = {
		calculate: 'Mit den angegebenen Werten rechnen',
		knowledge_query: 'Gespeicherte Daten auswerten',
		workspace_search: 'Passende Quellen finden',
		workspace_read: 'Eine Quelle nachlesen',
		research_record: 'Quellenbelege festhalten',
		studio_catalog: 'Verfügbare Bausteine prüfen',
		studio_state: 'Skills, Verbindungen und Ausführungen prüfen',
		studio_items: 'Passende Artefakte finden',
		studio_explore: 'Mögliche nächste Schritte erkunden',
		studio_inspect: 'Ergebnis und Herkunft nachsehen',
		studio_present: 'Ein Ergebnis zur Ansicht öffnen',
		studio_author: 'Einen Skill entwerfen oder ändern',
		studio_publish: 'Einen Skill veröffentlichen',
		studio_start: 'Eine Skill-Ausführung anfordern',
		studio_run_status: 'Fortschritt und Ergebnisse prüfen',
		studio_sync: 'Neue Eingänge und Verbindungen abgleichen',
		studio_control: 'Eine automatische Verbindung steuern',
		studio_connect: 'Eine automatische Verbindung vorbereiten',
		studio_run_control: 'Eine Ausführung erneut versuchen oder abbrechen',
		studio_sample: 'Eine Beispieldatei bereitstellen',
		studio_case_propose: 'Einen realen Fall beschreiben',
		studio_case_revise: 'Den Fallplan verfeinern',
		studio_case_what_if: 'Einen möglichen Ablauf untersuchen',
		studio_case_build: 'Aus dem bestätigten Fall einen Skill erstellen',
		registry_list: 'Verfügbare Akteure nachsehen',
		registry_describe: 'Die Fähigkeiten eines Akteurs prüfen',
		reconcile_ledger: 'Buchungen und Belege abgleichen',
		check_coverage: 'Erforderliche und belegte Zeiträume vergleichen',
		todo_list: 'Aufgaben nachsehen',
		todo_create: 'Aufgaben speichern',
		todo_update: 'Ausgewählte Aufgaben ändern',
		todo_archive: 'Aufgaben archivieren oder wiederherstellen'
	}
	const label = labels[call.name] ?? call.name.replaceAll('_', ' ')
	const context = args.query ?? args.title
	return typeof context === 'string' && context.trim()
		? `${label}: ${context.slice(0, 160)}`
		: label
}

export function toolArgumentsError(argumentsText: string): string | null {
	try {
		const value = JSON.parse(argumentsText)
		if (value && typeof value === 'object' && !Array.isArray(value)) return null
	} catch {
		/* Reject rather than guessing arguments for an action. */
	}
	return 'Not executed: tool arguments must be a valid JSON object. Correct the arguments and retry this call.'
}

/** A returned tool error is still an observed result, not a successful action. */
export function toolResultFailed(record: string): boolean {
	try {
		const value = JSON.parse(record)
		return value?.ok === false || Boolean(value?.error)
	} catch {
		return false
	}
}

export function redactToolField(key: string, item: unknown): unknown {
	return /^(password|secret|token|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(
		key
	)
		? '[redacted]'
		: item
}

/** Bound presentation only. The model and tool retain the original values. */
export function toolDetail(value: string): string {
	let text = value
	try {
		text = JSON.stringify(JSON.parse(value), redactToolField, 2)
	} catch {
		/* Plain tool messages are already text. */
	}
	return text.length > 12_000 ? `${text.slice(0, 12_000)}\n… Display truncated` : text
}
