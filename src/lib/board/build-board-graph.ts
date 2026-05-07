import type { Edge, Node } from '@xyflow/svelte'
import type {
	AgentSkillPlaygroundConfig,
	ProcessStepLifecycle,
	ReportEnvelopeStub,
	SkillSerialStep
} from './skill-playground-config'
import { childStepId } from './skill-playground-config'

export const HUMAN_ROOT_NODE_ID = 'human__root_inbox'

const LANE_GAP_Y = 56
/** Approx px for lane chrome + step list (excluding scroll cap). */
const LANE_BODY_EST_BASE = 128
const LANE_ROW_LINE = 30
const MIN_TOP = 42
const COLUMN_X = 300

const edgeAccent = '#1e3a8a'
const edgeMuted = '#334155'

export function supervisorPresentationName(cfg: AgentSkillPlaygroundConfig): string {
	return cfg.orchestratorLabel ?? cfg.agentId
}

/** Legacy helpers (JSON / MCP); graph no longer renders band primitives. */
export function skillProcessBandId(
	cfg: AgentSkillPlaygroundConfig,
	scope: 'supervisor' | string
): string {
	return scope === 'supervisor' ? `${cfg.agentId}__process_band` : `${scope}__process_band`
}

export function agentReportShellId(cfg: AgentSkillPlaygroundConfig): string {
	return `${cfg.agentId}__ipr_report`
}

export function qualifyStepId(mapKey: string | null, sid: string): string {
	return mapKey ? childStepId(mapKey, sid) : sid
}

function laneNodeId(agentKey: 'human' | string): string {
	return agentKey === 'human' ? HUMAN_ROOT_NODE_ID : `${agentKey}__lane`
}

function rowsForSnippet(
	steps: SkillSerialStep[],
	mapKey: string | null,
	state: Record<string, ProcessStepLifecycle>
): { stepId: string; title: string; state: ProcessStepLifecycle }[] {
	const out: { stepId: string; title: string; state: ProcessStepLifecycle }[] = []
	for (const s of steps) {
		if (!s) continue
		const qid = qualifyStepId(mapKey, s.id)
		out.push({ stepId: qid, title: s.title, state: state[qid] ?? 'idle' })
	}
	return out
}

function snippetDelegates(steps: SkillSerialStep[]): boolean {
	return steps.some(
		(s) =>
			s?.kind === 'creative' &&
			typeof s.delegatesToChild === 'string' &&
			s.delegatesToChild.trim().length > 0
	)
}

function estimateLaneHeight(rows: number): number {
	const body =
		rows > 9
			? Math.min(rows, 9) * LANE_ROW_LINE + LANE_BODY_EST_BASE
			: rows * LANE_ROW_LINE + LANE_BODY_EST_BASE
	return Math.max(body, LANE_BODY_EST_BASE + 40)
}

export type BoardInspectLane = {
	kind: 'lane'
	laneKind: 'human' | 'orchestrator' | 'worker'
	/** display / JSON key—`supervisor` for main skill agent */
	ref: string
	displayTitle: string
	sub?: string | undefined
	rows: readonly { readonly stepId: string; readonly title: string }[]
}

/** @deprecated Bands removed from playground UI */
export type BoardInspectBand = { kind: 'band'; scope: string }

export type BoardInspectShell = {
	kind: 'shell'
	shell: 'report'
	reportStub?: ReportEnvelopeStub | undefined
}

export type BoardInspectProcess = {
	kind: 'process'
	step: SkillSerialStep
	childMapKey?: string | undefined
}

export type BoardInspect =
	| BoardInspectLane
	| BoardInspectShell
	| BoardInspectBand
	| BoardInspectProcess

/** Lane-level summary — used when selecting a **`agentLane`** composite node without a chip. */
export function inspectBoardLane(
	cfg: AgentSkillPlaygroundConfig,
	nodeId: string
): BoardInspectLane | null {
	if (nodeId === HUMAN_ROOT_NODE_ID) {
		return {
			kind: 'lane',
			laneKind: 'human',
			ref: 'human',
			displayTitle: 'Human · root inbox',
			sub: 'Intent originates · bubbled `ask→parent` returns here · pick a delegated Process row elsewhere to tweak simulation.',
			rows: []
		}
	}
	const supLane = laneNodeId(cfg.agentId)
	if (nodeId === supLane) {
		return {
			kind: 'lane',
			laneKind: 'orchestrator',
			ref: 'supervisor',
			displayTitle: supervisorPresentationName(cfg),
			sub:
				cfg.skill.description ??
				'Supervisor orchestration · delegated steps live on child **`ocr_worker`** in this preset.',
			rows: cfg.skill.steps.map((s) => ({ stepId: s.id, title: s.title }))
		}
	}
	for (const [k, ch] of Object.entries(cfg.childAgents ?? {})) {
		if (nodeId !== laneNodeId(k)) continue
		return {
			kind: 'lane',
			laneKind: 'worker',
			ref: k,
			displayTitle: ch.name?.trim() || k,
			sub: `Delegated agent · \`childAgents.${k}\`.`,
			rows: ch.steps.map((s) => ({ stepId: childStepId(k, s.id), title: s.title }))
		}
	}
	return null
}

/** Inspect graph selection (lane shell, typed step chips, deprecated band match, Report facet). */
export function inspectBoardNode(
	cfg: AgentSkillPlaygroundConfig,
	nodeId: string
): BoardInspect | null {
	const lane = inspectBoardLane(cfg, nodeId)
	if (lane) return lane

	if (nodeId === agentReportShellId(cfg)) {
		return { kind: 'shell', shell: 'report', reportStub: cfg.reportStub }
	}

	if (nodeId === skillProcessBandId(cfg, 'supervisor')) return { kind: 'band', scope: 'supervisor' }
	for (const k of Object.keys(cfg.childAgents ?? {})) {
		if (nodeId === skillProcessBandId(cfg, k)) return { kind: 'band', scope: k }
	}

	for (const step of cfg.skill.steps) {
		if (step.id === nodeId) return { kind: 'process', step, childMapKey: undefined }
	}

	const m = /^(.+)::([^:]+)$/.exec(nodeId)
	if (m?.[1] && m[2]) {
		const snippet = cfg.childAgents?.[m[1]]
		if (!snippet) return null
		const rid = m[2]
		for (const step of snippet.steps) {
			if (step?.id === rid) return { kind: 'process', step, childMapKey: m[1] }
		}
	}

	return null
}

export function buildBoardGraph(
	cfg: AgentSkillPlaygroundConfig,
	state: Record<string, ProcessStepLifecycle>
): { nodes: Node[]; edges: Edge[] } {
	const oid = cfg.agentId
	const humanLane = laneNodeId('human')
	const supLane = laneNodeId(oid)
	const ocrSnippet = cfg.childAgents?.ocr_worker
	const fwSnippet = cfg.childAgents?.field_worker

	const fieldRowsLen = fwSnippet?.steps?.length ?? 0
	const ocrRowsLen = ocrSnippet?.steps?.length ?? cfg.skill.steps.length
	const aveRowsLen = cfg.skill.steps.length

	const hf = estimateLaneHeight(fieldRowsLen)
	const ho = estimateLaneHeight(ocrRowsLen)
	const ha = estimateLaneHeight(aveRowsLen)

	let yCursor = MIN_TOP
	const fieldTop = fwSnippet ? yCursor : -1
	if (fwSnippet) yCursor += hf + LANE_GAP_Y

	const ocrTop = ocrSnippet ? yCursor : MIN_TOP + hf + LANE_GAP_Y
	if (ocrSnippet) yCursor += ho + LANE_GAP_Y

	const avenTop = yCursor
	yCursor += ha + LANE_GAP_Y

	const humanTop = yCursor

	const nodes: Node[] = []
	const edges: Edge[] = []

	const lx = COLUMN_X - 148

	nodes.push({
		id: humanLane,
		type: 'agentLane',
		position: { x: lx, y: humanTop },
		data: {
			kind: 'human',
			headline: 'Human agent · root inbox · intentions · bubbled replies',
			sub: 'Root intents · replies · `Report ask→parent` lands here.',
			rows: []
		},
		zIndex: 5
	})

	nodes.push({
		id: supLane,
		type: 'agentLane',
		position: { x: lx, y: avenTop },
		data: {
			kind: 'orchestrator',
			headline: `${supervisorPresentationName(cfg)} · orchestrator`,
			sub: cfg.skill.description ?? 'Routes Human intents · delegates OCR pipeline.',
			rows: rowsForSnippet(cfg.skill.steps, null, state),
			delegatesDown: snippetDelegates(cfg.skill.steps),
			hasReportOut: false,
			hasJoinTarget: false,
			emitsJoinReturn: false
		},
		zIndex: 5
	})

	if (ocrSnippet) {
		nodes.push({
			id: laneNodeId('ocr_worker'),
			type: 'agentLane',
			position: { x: lx, y: ocrTop },
			data: {
				kind: 'worker',
				headline: ocrSnippet.name?.trim() ?? 'OCR agent',
				sub: 'Receipt IO · preprocess · layout · delegated field shard · gate before rollup to Report.',
				rows: rowsForSnippet(ocrSnippet.steps, 'ocr_worker', state),
				delegatesDown: snippetDelegates(ocrSnippet.steps),
				hasReportOut: true,
				hasJoinTarget: fwSnippet !== undefined,
				emitsJoinReturn: false
			},
			zIndex: 5
		})
	}

	if (fwSnippet && fieldTop >= 0) {
		nodes.push({
			id: laneNodeId('field_worker'),
			type: 'agentLane',
			position: { x: lx, y: fieldTop },
			data: {
				kind: 'worker',
				headline: fwSnippet.name?.trim() ?? 'OCR field worker',
				sub: 'Structured shard · returns join to OCR agent lane.',
				rows: rowsForSnippet(fwSnippet.steps, 'field_worker', state),
				delegatesDown: false,
				hasReportOut: false,
				hasJoinTarget: false,
				emitsJoinReturn: true
			},
			zIndex: 5
		})
	}

	const reportShell = agentReportShellId(cfg)
	nodes.push({
		id: reportShell,
		type: 'skillShell',
		position: { x: lx + 376, y: ocrSnippet ? ocrTop + 40 : avenTop + 40 },
		data: {
			variant: 'report',
			headline: cfg.reportStub?.ref ?? 'Report egress',
			sub:
				cfg.reportStub == null
					? `${supervisorPresentationName(cfg)} · Report facet`
					: `${cfg.reportStub.modality}→${cfg.reportStub.target}${cfg.reportStub.ref ? ` · ref:${cfg.reportStub.ref}` : ''}`
		},
		zIndex: 6
	})

	edges.push({
		id: `${humanLane}-intent-${oid}`,
		source: humanLane,
		target: supLane,
		sourceHandle: 'intentDown',
		targetHandle: 'inboxIn',
		type: 'smoothstep',
		style: `stroke: ${edgeMuted}; stroke-width: 1.5px`
	})

	if (cfg.childAgents?.ocr_worker && ocrSnippet)
		edges.push({
			id: `${supLane}-T-ocr_worker`,
			source: supLane,
			target: laneNodeId('ocr_worker'),
			sourceHandle: 'delegateDown',
			targetHandle: 'inboxIn',
			type: 'smoothstep',
			style: `stroke: ${edgeAccent}; stroke-width: 2px; stroke-dasharray: 6 4`,
			animated: false
		})

	if (ocrSnippet?.steps && fwSnippet)
		edges.push({
			id: `${laneNodeId('ocr_worker')}-T-field_worker`,
			source: laneNodeId('ocr_worker'),
			target: laneNodeId('field_worker'),
			sourceHandle: 'delegateDown',
			targetHandle: 'inboxIn',
			type: 'smoothstep',
			style: `stroke: ${edgeAccent}; stroke-width: 2px; stroke-dasharray: 6 4`,
			animated: false
		})

	if (fwSnippet && ocrSnippet)
		edges.push({
			id: `field-return-join-ocr`,
			source: laneNodeId('field_worker'),
			target: laneNodeId('ocr_worker'),
			sourceHandle: 'joinReturnOut',
			targetHandle: 'joinFromChild',
			type: 'smoothstep',
			style: `stroke: ${edgeMuted}; stroke-width: 1.75px`
		})

	if (ocrSnippet) {
		const tail = ocrSnippet.steps.at(-1)
		const tailQ = tail ? qualifyStepId('ocr_worker', tail.id) : ''
		const runAnim = tailQ !== '' ? state[tailQ] === 'running' : false
		edges.push({
			id: `rollup-ocr-report`,
			source: laneNodeId('ocr_worker'),
			target: reportShell,
			sourceHandle: 'rollupOut',
			targetHandle: 'serial-in',
			type: 'smoothstep',
			style: `stroke: ${edgeMuted}; stroke-width: 1.5px`,
			animated: runAnim
		})
	}

	edges.push({
		id: `${reportShell}-bubble-human`,
		source: reportShell,
		target: humanLane,
		sourceHandle: 'parentBubble',
		targetHandle: 'bubbleIn',
		type: 'smoothstep',
		style: `stroke: ${edgeAccent}; stroke-width: 1.85px; stroke-dasharray: 6 4`
	})

	return { nodes, edges }
}
