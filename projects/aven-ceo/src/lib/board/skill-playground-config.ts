/**
 * Playground model (UX + JSON only — no execution engine).
 *
 * **Actor shell (IPR):** Inbox · Process · Report — single primitive: **agents** (nested same shape).
 *
 * Process = **serial ordered steps** (`deterministic | creative`).
 * Creative may be **inline** (prompt/model in place) or **delegated** (`delegatesToChild` → child agent subgraph).
 *
 * Lifecycle (simulated): `idle` · `running` · `blocked` · `success` · `error`
 *
 * Escalations use **Report**: `tell | ask` × `target: child | parent | sibling | terminate` — never `human`
 * (`parent` bubbles to Human at hierarchy root).
 */

export type ReportModality = 'tell' | 'ask'

export type ReportTarget = 'child' | 'parent' | 'sibling' | 'terminate'

/** Optional illustrative egress envelope on playground config JSON. */
export interface ReportEnvelopeStub {
	modality: ReportModality
	target: ReportTarget
	ref?: string
}

export type ProcessStepKind = 'deterministic' | 'creative'

/** Simulated lifecycle for each Process row (replacing legacy waiting/hitl). */
export type ProcessStepLifecycle = 'idle' | 'running' | 'blocked' | 'success' | 'error'

export interface JsonSchemaPlaceholder {
	type?: string
	title?: string
	description?: string
	properties?: Record<string, unknown>
	required?: string[]
	additionalProperties?: boolean
	items?: unknown
}

export interface SkillSerialStep {
	id: string
	title: string
	kind: ProcessStepKind
	/** Present when kind === deterministic — named tool/function implementation */
	toolName?: string
	/** Present when kind === creative — inline generative hint; optional if only delegating */
	llmPrompt?: string
	/**
	 * When set on a **creative** step, runtime/UI model **`tell → child`** seed + **`ask`** join.
	 * Subgraph loaded from {@link AgentSkillPlaygroundConfig.childAgents}[id].
	 */
	delegatesToChild?: string
	inputSchema: JsonSchemaPlaceholder
	outputSchema: JsonSchemaPlaceholder
	notes?: string
}

export interface SkillDef {
	id: string
	name: string
	description?: string
	steps: SkillSerialStep[]
}

/** Serial steps for another agent surfaced when a creative step delegates. */
export interface ChildAgentSnippet {
	id: string
	/** Shown as label above child Process line */
	name?: string
	steps: SkillSerialStep[]
}

/** One agent’s playable JSON: identity + serial Process + optional child snippets + optional Report stub. */
export interface AgentSkillPlaygroundConfig {
	version: string
	agentId: string
	/** Optional label for **`/board`** grouping (human intent lands on **Aven** supervisor). Stable `agentId` stays in JSON. */
	orchestratorLabel?: string
	identity_system_prompt: string
	sprite?: {
		id: string
		note?: string
	}
	/** Optional example Report row for docs / inspector. */
	reportStub?: ReportEnvelopeStub
	skill: SkillDef
	/** Map from `delegatesToChild` string to that agent’s serial Process (for graph + JSON roundtrip). */
	childAgents?: Record<string, ChildAgentSnippet>
}

export const defaultSkillPlaygroundConfig: AgentSkillPlaygroundConfig = {
	version: '0.4-ipr-serial',
	agentId: 'receipt_supervisor',
	orchestratorLabel: 'Aven',
	identity_system_prompt:
		'You are Aven orchestrator ingesting Human intents: route receipt / document jobs to the dedicated OCR worker via Report tell→child; escalate with Report ask→parent only.',
	sprite: {
		id: 'sprite_receipt_supervisor_01',
		note: 'One Sprite per agent at execution time; playground is static JSON only.'
	},
	reportStub: {
		modality: 'ask',
		target: 'parent',
		ref: 'low_confidence_fields'
	},
	skill: {
		id: 'skill_receipt_extract_serial',
		name: 'Receipt extract · serial Process',
		description:
			'Receipt routing preset: Aven supervises ingress only; preprocessing + OCR + nested field worker live under **`ocr_worker`**. Humans talk to Aven; **`Report ask→parent`** surfaces at Aven then bubbles to Human.',
		steps: [
			{
				id: 'c_route_downstream',
				title: 'Creative: delegate receipt artifact job to OCR agent',
				kind: 'creative',
				delegatesToChild: 'ocr_worker',
				llmPrompt:
					'Bind Human intent artifacts to OCR pipeline job · emit Report tell→child seed envelope for **ocr_worker** only.',
				inputSchema: { type: 'object', properties: { intentPayload: { type: 'object' } } },
				outputSchema: {
					type: 'object',
					properties: { jobRef: { type: 'string' } },
					required: ['jobRef']
				}
			}
		]
	},
	childAgents: {
		ocr_worker: {
			id: 'ocr_worker',
			name: 'OCR agent',
			steps: [
				{
					id: 'd_ingest',
					title: 'Ingest artifact bundle',
					kind: 'deterministic',
					toolName: 'receive_document_bundle_stub',
					inputSchema: {
						type: 'object',
						properties: { uploadRefs: { type: 'array', items: { type: 'string' } } },
						required: ['uploadRefs']
					},
					outputSchema: {
						type: 'object',
						properties: { bytesSha256: { type: 'string' }, mime: { type: 'string' } },
						required: ['bytesSha256']
					}
				},
				{
					id: 'd_preprocess',
					title: 'Deskew · denoise · page split',
					kind: 'deterministic',
					toolName: 'image_preprocess_stub',
					inputSchema: {
						type: 'object',
						properties: { bytesSha256: { type: 'string' } },
						required: ['bytesSha256']
					},
					outputSchema: {
						type: 'object',
						properties: { cleanPages: { type: 'array', items: { type: 'string' } } }
					}
				},
				{
					id: 'c_layout_inline',
					title: 'Creative: reading order & layout (inline)',
					kind: 'creative',
					llmPrompt:
						'From OCR tokens, propose reading order blocks and table vs body regions. JSON regions[] only.',
					inputSchema: { type: 'object', properties: { ocrJson: { type: 'object' } } },
					outputSchema: {
						type: 'object',
						properties: { regions: { type: 'array' } },
						required: ['regions']
					}
				},
				{
					id: 'c_fields_delegate',
					title: 'Creative: normalized field extraction (delegated child)',
					kind: 'creative',
					delegatesToChild: 'field_worker',
					llmPrompt: 'Seed: extract vendor · date · line items · totals; correlate with regions.',
					inputSchema: { type: 'object', properties: { regionsRef: { type: 'string' } } },
					outputSchema: {
						type: 'object',
						properties: {
							receiptStructured: { type: 'object' },
							confidenceMap: { type: 'object' }
						},
						required: ['receiptStructured']
					}
				},
				{
					id: 'd_confidence_gate',
					title: 'Deterministic confidence gate · roll-up or escalate stub',
					kind: 'deterministic',
					toolName: 'confidence_aggregate_stub',
					inputSchema: { type: 'object', properties: { confidenceMap: { type: 'object' } } },
					outputSchema: {
						type: 'object',
						properties: {
							pass: { type: 'boolean' },
							rollupPayload: { type: 'object' }
						},
						required: ['pass']
					},
					notes:
						'Below threshold → runtime emits Report ask→parent (Aven rollup; Human hears only via parent chain root).'
				}
			]
		},
		field_worker: {
			id: 'field_worker',
			name: 'OCR field worker',
			steps: [
				{
					id: 'fw_parse',
					title: 'Structured parse from regions',
					kind: 'creative',
					llmPrompt:
						'Fill receipt JSON schema strictly; abstain unknowns with null; never invent totals.',
					inputSchema: {
						type: 'object',
						properties: { regions: { type: 'array' } },
						required: ['regions']
					},
					outputSchema: {
						type: 'object',
						properties: {
							lineItems: { type: 'array' },
							totals: { type: 'object' }
						},
						required: ['lineItems', 'totals']
					}
				},
				{
					id: 'fw_normalize',
					title: 'Normalize currency & dates',
					kind: 'deterministic',
					toolName: 'normalize_money_dates_stub',
					inputSchema: { type: 'object', properties: { draftReceipt: { type: 'object' } } },
					outputSchema: { type: 'object', properties: { receiptStructured: { type: 'object' } } }
				}
			]
		}
	}
}

export function initialStepStates(allStepIds: string[]): Record<string, ProcessStepLifecycle> {
	const m: Record<string, ProcessStepLifecycle> = {}
	for (const id of allStepIds) {
		m[id] = 'idle'
	}
	return m
}

export function collectStepIds(cfg: AgentSkillPlaygroundConfig): string[] {
	const ids = [...cfg.skill.steps.map((s) => s.id)]
	if (cfg.childAgents) {
		for (const ch of Object.values(cfg.childAgents)) {
			for (const s of ch.steps) ids.push(childStepId(ch.id, s.id))
		}
	}
	return ids
}

export function childStepId(childAgentKey: string, stepId: string): string {
	return `${childAgentKey}::${stepId}`
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function parseAgentSkillPlaygroundConfig(
	raw: unknown
): { ok: true; config: AgentSkillPlaygroundConfig } | { ok: false; error: string } {
	if (!isRecord(raw)) return { ok: false, error: 'Root must be an object' }
	if (typeof raw.version !== 'string') return { ok: false, error: 'version must be a string' }
	if (typeof raw.agentId !== 'string') return { ok: false, error: 'agentId must be a string' }
	if (typeof raw.identity_system_prompt !== 'string')
		return { ok: false, error: 'identity_system_prompt must be a string' }
	if (!isRecord(raw.skill)) return { ok: false, error: 'skill must be an object' }
	if (typeof raw.skill.id !== 'string') return { ok: false, error: 'skill.id must be a string' }
	if (typeof raw.skill.name !== 'string') return { ok: false, error: 'skill.name must be a string' }
	if (!Array.isArray(raw.skill.steps) || raw.skill.steps.length === 0)
		return { ok: false, error: 'skill.steps must be a non-empty array' }

	function parseSteps(
		steps: unknown[],
		ctxLabel: string
	): { ok: true; steps: SkillSerialStep[] } | { ok: false; error: string } {
		const kinds = new Set(['deterministic', 'creative'])
		const parsed: SkillSerialStep[] = []
		for (const stRaw of steps) {
			const st = stRaw as Record<string, unknown>
			if (!isRecord(st) || typeof st.id !== 'string' || typeof st.title !== 'string') {
				return { ok: false, error: `${ctxLabel}: each step needs id and title` }
			}
			if (typeof st.kind !== 'string' || !kinds.has(st.kind)) {
				return { ok: false, error: `${ctxLabel} ${st.id}: kind must be deterministic | creative` }
			}
			if (
				st.kind === 'deterministic' &&
				(typeof st.toolName !== 'string' || st.toolName.length === 0)
			) {
				return {
					ok: false,
					error: `${ctxLabel} ${st.id}: deterministic steps require non-empty toolName`
				}
			}
			if (st.kind === 'creative') {
				const hasDel = typeof st.delegatesToChild === 'string' && st.delegatesToChild.trim() !== ''
				const hasLl = typeof st.llmPrompt === 'string' && st.llmPrompt.trim().length > 0
				if (!(hasDel || hasLl)) {
					return {
						ok: false,
						error: `${ctxLabel} ${st.id}: creative steps need llmPrompt and/or delegatesToChild`
					}
				}
				if (st.delegatesToChild != null) {
					if (typeof st.delegatesToChild !== 'string' || st.delegatesToChild.trim() === '')
						return {
							ok: false,
							error: `${ctxLabel} ${st.id}: delegatesToChild must be non-empty string when set`
						}
				}
			}
			if (!isRecord(st.inputSchema) || !isRecord(st.outputSchema)) {
				return {
					ok: false,
					error: `${ctxLabel} ${st.id}: inputSchema and outputSchema objects required`
				}
			}
			parsed.push(st as unknown as SkillSerialStep)
		}
		return { ok: true, steps: parsed }
	}

	const mainParsed = parseSteps(raw.skill.steps, 'skill')
	if (!mainParsed.ok) return { ok: false, error: mainParsed.error }

	let childAgents: Record<string, ChildAgentSnippet> | undefined
	if (raw.childAgents !== undefined) {
		if (!isRecord(raw.childAgents))
			return { ok: false, error: 'childAgents must be an object map when present' }
		childAgents = {}
		for (const [key, snippet] of Object.entries(raw.childAgents)) {
			if (!isRecord(snippet)) return { ok: false, error: `childAgents.${key}: must be object` }
			if (typeof snippet.id !== 'string')
				return { ok: false, error: `childAgents.${key}.id string` }
			if (snippet.id !== key)
				return {
					ok: false,
					error: `childAgents: property key "${key}" must equal snippet.id "${snippet.id}"`
				}
			if (!Array.isArray(snippet.steps) || snippet.steps.length === 0) {
				return { ok: false, error: `childAgents.${key}.steps non-empty array` }
			}
			const nested = parseSteps(snippet.steps, `childAgents.${key}`)
			if (!nested.ok) return { ok: false, error: nested.error }
			childAgents[key] = {
				id: snippet.id,
				name: typeof snippet.name === 'string' ? snippet.name : undefined,
				steps: nested.steps
			}
		}
	}

	function delegationsResolvable(
		stepsArr: SkillSerialStep[],
		ctx: string
	): { ok: true } | { ok: false; error: string } {
		for (const s of stepsArr) {
			if (s.kind !== 'creative' || !s.delegatesToChild?.trim()) continue
			const k = s.delegatesToChild.trim()
			if (!childAgents?.[k])
				return {
					ok: false,
					error: `${ctx}: step "${s.id}" delegatesToChild="${k}" missing in childAgents map`
				}
		}
		return { ok: true }
	}

	const okMainDl = delegationsResolvable(mainParsed.steps, 'skill')
	if (!okMainDl.ok) return { ok: false, error: okMainDl.error }

	if (childAgents) {
		for (const [ck, snippet] of Object.entries(childAgents)) {
			const okCh = delegationsResolvable(snippet.steps, `childAgents.${ck}`)
			if (!okCh.ok) return { ok: false, error: okCh.error }
		}
	}

	const skillRec = raw.skill as Record<string, unknown>
	const normalizedSkill: SkillDef = {
		id: skillRec.id as string,
		name: skillRec.name as string,
		description: typeof skillRec.description === 'string' ? skillRec.description : undefined,
		steps: mainParsed.steps
	}

	const normalized: AgentSkillPlaygroundConfig = {
		version: raw.version,
		agentId: raw.agentId,
		orchestratorLabel:
			typeof raw.orchestratorLabel === 'string' && raw.orchestratorLabel.trim().length > 0
				? raw.orchestratorLabel.trim()
				: undefined,
		identity_system_prompt: raw.identity_system_prompt,
		sprite: isRecord(raw.sprite)
			? {
					id: typeof raw.sprite.id === 'string' ? raw.sprite.id : 'sprite_unknown',
					note: typeof raw.sprite.note === 'string' ? raw.sprite.note : undefined
				}
			: undefined,
		reportStub:
			raw.reportStub && isRecord(raw.reportStub)
				? {
						modality:
							raw.reportStub.modality === 'tell' || raw.reportStub.modality === 'ask'
								? raw.reportStub.modality
								: 'tell',
						target:
							typeof raw.reportStub.target === 'string' &&
							['child', 'parent', 'sibling', 'terminate'].includes(raw.reportStub.target as string)
								? (raw.reportStub.target as ReportTarget)
								: 'parent',
						ref: typeof raw.reportStub.ref === 'string' ? raw.reportStub.ref : undefined
					}
				: undefined,
		skill: normalizedSkill,
		childAgents
	}

	return { ok: true, config: normalized }
}

export function reconcileStepStates(
	config: AgentSkillPlaygroundConfig,
	previous: Record<string, ProcessStepLifecycle>
): Record<string, ProcessStepLifecycle> {
	const next = initialStepStates(collectStepIds(config))
	for (const id of Object.keys(next)) {
		const p = previous[id]
		if (p) next[id] = p
	}
	return next
}
