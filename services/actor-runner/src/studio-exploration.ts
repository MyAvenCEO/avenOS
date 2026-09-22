import {
	composeCatalogOperation,
	newStudioSkillV2,
	type StudioCatalogEntry,
	type StudioCatalogPort
} from '@avenos/actors'
import type { StudioArtifact } from './studio-artifacts'

export function sourceFitsPort(source: StudioArtifact, port: StudioCatalogPort): boolean {
	if (
		port.sensitive ||
		port.type?.key !== source.typeKey ||
		port.type.version !== source.typeVersion
	)
		return false
	if (!port.mediaTypes?.length) return true
	const media = String(source.payload.declaredMediaType ?? source.payload.mediaType ?? '')
		.split(';')[0]!
		.trim()
		.toLowerCase()
	return port.mediaTypes.some(
		(accepted) =>
			accepted === media || (accepted.endsWith('/*') && media.startsWith(accepted.slice(0, -1)))
	)
}

/** Authoring suggestions, not an execution or completeness claim. */
export function exploreCatalog(source: StudioArtifact, entries: StudioCatalogEntry[]) {
	return entries
		.flatMap((entry) => {
			if (!entry.canAuthor || !entry.inputs.some((port) => sourceFitsPort(source, port))) return []
			try {
				const { definition } = composeCatalogOperation(newStudioSkillV2(entry.label), entry)
				// One selected artifact binds one port. Matching types do not imply
				// permission to silently reuse it for every required input.
				const selectedPort = entry.inputs.find((port) => sourceFitsPort(source, port))!
				const missingInputs = entry.inputs
					.filter(
						(port) => !port.sensitive && port.cardinality !== 'optional' && port !== selectedPort
					)
					.map((port) => ({ name: port.name, type: port.type?.key ?? 'artifact' }))
				const requiredParameters = (entry.parametersSchema.required ?? []) as string[]
				return [
					{
						label: entry.label,
						description: entry.description,
						conditional: missingInputs.length > 0 || requiredParameters.length > 0,
						missingInputs,
						requiredParameters,
						steps: [{ id: entry.capabilityId, label: entry.label }],
						definition
					}
				]
			} catch {
				return []
			}
		})
		.sort((a, b) => Number(a.conditional) - Number(b.conditional) || a.label.localeCompare(b.label))
}

/** Goals open a conversation anchored in this real case; none imply an installed executable route. */
export function explorationDirections(source: StudioArtifact) {
	const media = String(source.payload.declaredMediaType ?? source.payload.mediaType ?? '')
		.split(';')[0]!
		.trim()
		.toLowerCase()
	const kind = source.typeKey === 'core.file' && media === 'application/pdf' ? 'PDF' : 'item'
	const document = source.typeKey === 'core.file' || source.typeKey.startsWith('docs.')
	return [
		{
			id: 'understand',
			label: 'Understand this document',
			description: 'Ask questions, get a summary, and check the evidence.',
			request:
				'Help me understand this PDF. Read its available content, give me a concise summary with evidence, and explain any unreadable parts.'
		},
		{
			id: 'extract',
			label: 'Extract useful information',
			description: 'Text, tables, dates, or fields that matter to you.',
			request:
				'Help me extract useful information from this PDF. Ask which text, tables or fields I need, then check what the installed tools can actually extract.'
		},
		{
			id: 'finance',
			label: 'Work with an invoice or statement',
			description: 'Identify financial data and prepare it for checking.',
			request:
				'Check whether this PDF is an invoice or bank statement. Show the evidence and propose the appropriate extraction and validation steps. Do not assume its type from the filename.'
		},
		{
			id: 'compare',
			label: 'Compare with another document',
			description: 'Find changes, agreements, and contradictions.',
			request:
				'Help me compare this PDF with another document. First help me choose the other document, then identify the important differences with evidence.'
		},
		{
			id: 'write',
			label: 'Turn findings into a document',
			description: 'Prepare a brief, notes, or a checklist with sources.',
			request:
				'Help me turn findings from this PDF into a Markdown brief or checklist. Ask what I want it for, retain source provenance, and show me the proposed result before saving.'
		},
		{
			id: 'reuse',
			label: 'Make this a reusable skill',
			description: 'Start with this case; refine and automate it later.',
			request:
				'Help me turn work on this PDF into a reusable skill. Find relevant previous manual work, confirm the real case with me, and propose the procedure. Clearly label missing capabilities as ideal steps; do not publish or run automatically.'
		}
	]
		.filter((direction) => direction.id !== 'finance' || source.typeKey === 'core.file')
		.map((direction) => ({
			...direction,
			label: document ? direction.label : direction.label.replaceAll('document', 'item'),
			request: direction.request.replaceAll('PDF', kind),
			mode: 'agent-assisted' as const
		}))
}
