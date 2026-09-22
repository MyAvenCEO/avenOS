import type { ModelPhase } from './model'
import { type ToolCall, toolPurpose } from './tool-call'

/** Execution-owned status, never an invented account of the model's reasoning. */
export interface ModelActivity {
	id: string
	phase: ModelPhase
	startedAt: number
}

export const modelPhaseLabels: Record<ModelPhase, string> = {
	answer: 'Antwort vorbereiten',
	checklist: 'Belege sammeln',
	verification: 'Antwort prüfen',
	repair: 'Antwort überarbeiten'
}

export function currentStep(model: ModelActivity | null, calls: ToolCall[], recovering = false) {
	if (model) {
		return {
			label: modelPhaseLabels[model.phase],
			startedAt: model.startedAt,
			kind: model.phase,
			detail: recovering
				? 'Der unterbrochene Modellaufruf wird erneut versucht. Bereits ausgeführte Aktionen bleiben erhalten.'
				: 'Modellanfrage läuft; einschließlich möglicher Wartezeit beim Anbieter.'
		}
	}
	const tool = calls.find((call) => call.status === 'running')
	if (tool)
		return {
			label: toolPurpose(tool),
			startedAt: tool.startedAt,
			kind: 'tool',
			detail: 'Werkzeug wird ausgeführt.'
		}
	return {
		label: recovering ? 'Verbindung wiederherstellen' : 'Weiterarbeiten',
		startedAt: undefined,
		kind: 'waiting',
		detail: ''
	}
}
