import {
	composeCatalogOperation,
	composeSkillArtifact,
	newStudioSkillV2,
	parseStudioSkillV2,
	type StudioCatalogEntry,
	type StudioSkillV2
} from '@avenos/actors'

/** Synthetic supplier review, using only catalog-discovered contracts and exact child revisions. */
export async function invoiceReviewSkills(
	entries: StudioCatalogEntry[],
	publish: (definition: StudioSkillV2) => Promise<string>
) {
	const add = (definition: StudioSkillV2, method: string) => {
		const operation = entries.find((e) => e.capabilityId.endsWith(`:${method}@1`))
		if (!operation) throw Error(`Missing installed operation: ${method}`)
		return composeCatalogOperation(definition, operation).definition
	}
	const expose = (definition: StudioSkillV2, step = definition.steps.at(-1)!) => {
		definition.outputs = Object.fromEntries(
			Object.entries(step.outputs).map(([name, port]) => [
				name,
				{ ...port, from: { kind: 'step' as const, stepId: step.id, port: name } }
			])
		)
		return parseStudioSkillV2(definition)
	}
	const page = add(newStudioSkillV2('Read a document page'), 'document_extract_native_text')
	const pageId = await publish(page)
	let extract = add(
		add(newStudioSkillV2('Extract a supplier invoice'), 'document_inspect'),
		'document_decompose'
	)
	const pages = extract.steps.at(-1)!
	extract.steps.push({
		kind: 'forEach',
		id: 'read-pages',
		label: 'Read each page',
		collection: { kind: 'step', stepId: pages.id, port: 'page' },
		itemName: 'page',
		childSkillArtifactId: pageId,
		childInputs: {
			source: { kind: 'input', port: 'source' },
			page: { kind: 'item', loopId: 'read-pages' }
		},
		concurrency: 1,
		failureMode: 'fail-fast',
		outputs: Object.fromEntries(
			Object.entries(page.outputs).map(([name, { from: _, ...port }]) => [
				name,
				{ ...port, cardinality: 'many' as const }
			])
		)
	})
	extract = expose(add(add(extract, 'document_classify_kind'), 'document_extract_invoice'))
	extract.policy.allowModel = true
	const extractId = await publish(extract)
	const validate = expose(
		add(
			add(
				newStudioSkillV2('Check invoice totals and prepare open item'),
				'document_validate_invoice'
			),
			'document_normalize_open_item'
		)
	)
	const validateId = await publish(validate)
	const note = add(newStudioSkillV2('Prepare supplier review checklist'), 'write')
	const write = note.steps[0]!
	if (write.kind !== 'invoke') throw Error('Expected write operation')
	write.parameters = {
		title: { kind: 'literal', value: 'Supplier review' },
		content: {
			kind: 'literal',
			value:
				'# Supplier review\n\n- [ ] Check invoice totals\n- [ ] Confirm receipt of goods\n- [ ] Approve payment manually\n'
		}
	}
	note.parametersSchema = newStudioSkillV2('empty').parametersSchema
	const noteId = await publish(note)
	let parent = newStudioSkillV2('Supplier invoice review packet')
	for (const [id, child] of [
		[extractId, extract],
		[validateId, validate],
		[noteId, note]
	] as const)
		parent = composeSkillArtifact(parent, id, child).definition
	parent.policy.allowModel = true
	const [extraction, validation, checklist] = parent.steps
	parent.outputs = {
		invoice: {
			...extraction!.outputs.candidate!,
			from: { kind: 'step', stepId: extraction!.id, port: 'candidate' }
		},
		'open-item': {
			...validation!.outputs['open-item']!,
			from: { kind: 'step', stepId: validation!.id, port: 'open-item' }
		},
		checklist: {
			...checklist!.outputs.document!,
			from: { kind: 'step', stepId: checklist!.id, port: 'document' }
		}
	}
	return {
		parent: parseStudioSkillV2(parent),
		page,
		pageId,
		extract,
		extractId,
		validate,
		validateId,
		note,
		noteId,
		add,
		expose
	}
}
