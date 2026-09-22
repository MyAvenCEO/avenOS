import { taskResultEvidence } from '@avenos/productivity/evidence'
import { redactToolField } from './tool-call'

export const TOOL_EVIDENCE_LIMIT = 8000

/** The machine-evidence boundary must not pass through the display formatter:
 * pretty-printing/truncation can destroy perfectly usable structured results. */
export function retainedToolResult(record: string, notice: string): unknown {
	try {
		const value = JSON.parse(JSON.stringify(JSON.parse(record), redactToolField))
		if (JSON.stringify(value).length <= TOOL_EVIDENCE_LIMIT) return value
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const projection = taskResultEvidence(value, TOOL_EVIDENCE_LIMIT)
			if (projection) return projection
		}
	} catch {
		/* A display excerpt or malformed response is not execution evidence. */
	}
	return { resultRetained: false, notice }
}
