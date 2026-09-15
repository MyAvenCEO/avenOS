import type { PlanRunExecutionContext, PlanRunExecutor, PlanRunStartRequest } from '@avenos/actors'
import {
	type CompiledStudioProgram,
	compileStudio,
	STUDIO_SKILL,
	type StudioBinding,
	sameType
} from '@avenos/actors/studio'
import {
	DOCUMENT_INGEST_RUN_PROTOCOL,
	DOCUMENT_INGEST_SKILL,
	documentPlanRunCommand
} from '@avenos/document-ingest/execution'
import {
	createDocumentSkillExecutor,
	type DocumentSkillExecutorDependencies
} from '@avenos/document-ingest/server'
import {
	type StudioArtifact,
	type StudioArtifacts,
	studioIdentity,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'

export function createStudioExecutor(
	store: StudioArtifacts,
	documentDependencies: DocumentSkillExecutorDependencies
): PlanRunExecutor {
	return async (request, context) => {
		if (request.skillRef !== STUDIO_SKILL) throw new Error('Invalid Studio execution request.')
		const p = studioObject(request.parameters)
		const activation = await store.get(String(p.activationArtifactId))
		if (
			activation.typeKey !== 'studio.activation' ||
			activation.typeVersion !== 1 ||
			activation.payload.initiator !== request.security.principal.subjectId
		)
			throw new Error('Invalid Studio activation.')
		const skillArtifactId = String(activation.payload.skillArtifactId)
		const library = await store.library([skillArtifactId])
		const definition = library.get(skillArtifactId)!
		const compiled = compileStudio(definition, library)
		const admission = studioObject(
			studioObject(await store.client.publication(store.scope, activation.publicationId)).run
		)
		if (
			admission.parameters?.planSha256 !== studioPlanDigest(compiled) ||
			admission.parameters?.catalogRevision !== 'studio-v1'
		)
			throw new Error(
				'The resolved program changed since admission. Create a new activation after reviewing it.'
			)
		const ids = studioObject(activation.payload.inputs)
		const sources: Record<string, StudioArtifact> = {}
		if (Object.keys(ids).length !== Object.keys(definition.inputs).length)
			throw new Error('Activation inputs changed.')
		for (const [name, type] of Object.entries(definition.inputs)) {
			const source = await store.get(String(ids[name]))
			if (!sameType(type, { key: source.typeKey, version: source.typeVersion }))
				throw new Error('Activation input type mismatch.')
			sources[name] = source
		}
		const activationId = String(activation.payload.activationId)
		let spent = 0
		const events: Array<Record<string, unknown>> = []
		const report = async (event: Record<string, unknown>) => {
			events.push(event)
			await context?.reportProgress?.({ studio: { activationId, events } })
		}
		const invoke = async (
			program: CompiledStudioProgram,
			skillId: string,
			inputs: Record<string, StudioArtifact>,
			path: string,
			parent: string | null
		): Promise<StudioArtifact> => {
			context?.signal?.throwIfAborted()
			const invocationId = await studioIdentity(store.scope, activationId, path)
			const inputIds = Object.fromEntries(
				Object.entries(inputs).map(([name, a]) => [name, a.artifactId])
			)
			const [invocation] = await store.publish({
				id: invocationId,
				procedure: 'studio.invoke',
				principal: request.security.principal.subjectId,
				inputs: [
					{ role: 'activation', id: activation.artifactId },
					{ role: 'program', id: skillId },
					...(parent ? [{ role: 'parent', id: parent }] : []),
					...Object.values(inputs).map((a) => ({ role: 'source', id: a.artifactId }))
				],
				parameters: {},
				artifacts: [
					{
						key: 'invocation',
						type: 'studio.invocation',
						payload: {
							activationId,
							callPath: path,
							skillArtifactId: skillId,
							parentInvocationId: parent,
							inputs: inputIds,
							parameters: {}
						}
					}
				]
			})
			const values = new Map<string, StudioArtifact>(
				Object.entries(inputs).map(([name, a]) => [`input:${name}`, a])
			)
			const resolve = (b: StudioBinding) =>
				values.get(`${b.kind}:${b.name}`) ??
				(() => {
					throw new Error('Missing committed input.')
				})()
			for (const step of program.steps) {
				context?.signal?.throwIfAborted()
				const stepPath = `${path}/${step.id}`
				const bound = Object.fromEntries(
					Object.entries(step.inputs).map(([name, b]) => [name, resolve(b)])
				)
				await report({
					path: stepPath,
					label: step.label,
					state: 'running',
					skillArtifactId: skillId,
					invocationArtifactId: invocation!.artifactId
				})
				let output: StudioArtifact
				if (step.child)
					output = await invoke(step.child, step.ref!, bound, stepPath, invocation!.artifactId)
				else {
					output = bound.source!
					for (const [index, capability] of (step.capabilities ?? []).entries()) {
						if (++spent > compiled.definition.policy.maxInvocations)
							throw new Error('The shared invocation budget was exhausted.')
						const publicationId = await studioIdentity(
							store.scope,
							activationId,
							stepPath,
							index,
							capability.id
						)
						const prior = await store.lookup(publicationId)
						if (prior) {
							output = prior[0]!
							continue
						}
						const source = output
						const causalInputs = [
							{ role: 'activation', id: activation.artifactId },
							{ role: 'program', id: skillId },
							{ role: 'invocation', id: invocation!.artifactId },
							{ role: 'source', id: source.artifactId }
						]
						if (capability.id === 'document.understand@1') {
							const docs = createDocumentSkillExecutor({
								...documentDependencies,
								model: program.definition.policy.allowModel
									? documentDependencies.model
									: undefined,
								provenanceFor: () => ({
									invocationId: publicationId,
									inputs: causalInputs
										.filter((i) => i.role !== 'source')
										.map((i) => ({ role: i.role, ordinal: 0, artifactId: i.id }))
								})
							})
							const command = documentPlanRunCommand({
								protocol: DOCUMENT_INGEST_RUN_PROTOCOL,
								skillRef: DOCUMENT_INGEST_SKILL,
								requestId: publicationId,
								idempotencyKey: publicationId,
								requestedAt: request.requestedAt,
								executionEnvironment: 'server',
								source: {
									artifactId: source.artifactId,
									originalName: String(source.payload.originalName),
									declaredMediaType: String(source.payload.declaredMediaType)
								}
							})
							const result = await docs(
								{ ...command, security: request.security },
								{ signal: context?.signal }
							)
							const understanding = studioObject(result.output)
							const presentation = studioObject(understanding.presentation)
							const artifactIds = result.artifactIds ?? []
							if (artifactIds.length > 1024)
								throw new Error('The understanding report exceeds the Studio result limit.')
							const warnings = (presentation.warnings ?? [])
								.map((w: any) => String(w.message).slice(0, 2048))
								.slice(0, 64)
							const [published] = await store.publish({
								id: publicationId,
								procedure: 'studio.understand',
								principal: request.security.principal.subjectId,
								inputs: [...causalInputs, ...artifactIds.map((id) => ({ role: 'evidence', id }))],
								parameters: { allowModel: program.definition.policy.allowModel },
								artifacts: [
									{
										key: 'understanding',
										type: 'studio.understanding',
										payload: {
											sourceArtifactId: source.artifactId,
											status: understanding.status,
											summary: String(
												presentation.summary ||
													(understanding.status === 'complete'
														? 'Document inspected. Open the recorded results.'
														: 'Document inspected; review is needed.')
											).slice(0, 2048),
											artifactIds,
											warnings
										},
										references: artifactIds.map((id) => ({ role: 'result', id }))
									}
								]
							})
							output = published!
						} else if (capability.id === 'report.brief@1') {
							const [published] = await store.publish({
								id: publicationId,
								procedure: 'studio.brief',
								principal: request.security.principal.subjectId,
								inputs: causalInputs,
								parameters: step.parameters,
								artifacts: [
									{
										key: 'brief',
										type: 'studio.brief',
										payload: {
											sourceArtifactId: source.artifactId,
											title: String(step.parameters.title ?? 'Document brief'),
											summary: String(source.payload.summary),
											status: source.payload.status
										}
									}
								]
							})
							output = published!
						} else throw new Error('Unavailable Studio implementation.')
					}
				}
				values.set(`step:${step.id}`, output)
				await report({
					path: stepPath,
					label: step.label,
					state: 'succeeded',
					artifactId: output.artifactId,
					status: output.payload.status ?? 'complete'
				})
			}
			return resolve(program.definition.output.from)
		}
		const output = await invoke(compiled, skillArtifactId, sources, 'root', null)
		return {
			artifactIds: [output.artifactId],
			completedStepIds: events.filter((e) => e.state === 'succeeded').map((e) => String(e.path)),
			remainingGoals: [],
			policyDecisionIds: ['studio:non-effecting-program-v1'],
			output: {
				kind: 'studio-result',
				activationArtifactId: activation.artifactId,
				skillArtifactId,
				artifact: output,
				events
			}
		}
	}
}
