import {
	type InputCapture,
	type InputReference,
	inputAdmissionSchema,
	inputCaptureSchema,
	inputReferenceSchema
} from '@avenos/intents/admission'
import type { InputTarget } from '@avenos/llm-client/input-decision'
import type { PendingInput } from './input-inbox-controller'

export { type InputCapture, inputCaptureSchema } from '@avenos/intents/admission'

/** Select only persisted identities; definitions, previews and credentials stay local. */
export function screenReferences(
	selection: Record<string, unknown> | null,
	caseId = ''
): InputReference[] {
	const references: InputReference[] = []
	const add = (raw: unknown) => {
		const reference = inputReferenceSchema.parse(raw)
		if (!references.some((r) => r.kind === reference.kind && r.id === reference.id))
			references.push(reference)
	}
	if (caseId) add({ kind: 'case', id: caseId })
	if (selection?.view === 'compose' && selection.draftId)
		add({ kind: 'skill-draft', id: selection.draftId, revision: selection.draftRevision })
	for (const key of ['artifactId', 'rootArtifactId'])
		if (selection?.[key]) add({ kind: 'artifact', id: selection[key] })
	return references
}

export function captureInputContext(
	view: Partial<Pick<InputCapture, 'references' | 'prompt'>> = {},
	timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): InputCapture {
	return inputCaptureSchema.parse({ timezone, references: [], prompt: '', ...view })
}

/** Exact assignment material; navigation/retry cannot rebuild it from the current screen. */
export function admissionFromPending(item: PendingInput, target: InputTarget) {
	if (!item.capture)
		throw Error('This draft has no saved screen context. Review and resubmit it before sending.')
	return inputAdmissionSchema.parse({
		inputId: item.id,
		revision: item.revision,
		text: item.text,
		originalText: item.originalText,
		corrections: item.corrections,
		target,
		locale: item.locale,
		timezone: item.capture.timezone,
		capturedAt: item.createdAt,
		decisionId: item.decisionId,
		confirmed: item.confirmed,
		responseMode: item.responseMode,
		...(item.sourceContext &&
			(target.kind === 'new' || target.id !== item.sourceContext.intentId) && {
				sourceContext: item.sourceContext
			}),
		feedbackCheck: item.feedbackCheck,
		references: item.capture.references,
		speaker: item.speaker
	})
}
