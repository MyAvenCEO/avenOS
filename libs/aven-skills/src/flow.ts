// board 0083 — a universal resource-transformation model (Minecraft-recipe style). A `Resource` is a
// typed item; a `RecipeNode` is an actor blackbox consuming 1+ input resources → producing 1+ output
// resources (fan-out 1→N by output kinds, fan-in N→1 by input kinds); a `Flow` is a graph of recipes;
// a `FlowInstance` is a run with per-node state. Descriptive (powers the Skills view); shaped so it
// could drive execution later. Pure (no DOM): just the schema + our existing skills as data.

import flowsJson from '../configs/flows.json'
import type { LlmConfig } from './capability.js'
import type { LogLevel } from './pipeline/types.js'

/** The typed items that flow between recipes. */
export type ResourceKind = string

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
	prompt: 'Prompt',
	audio: 'Voice note',
	file: 'File',
	image: 'Image',
	document: 'Document',
	invoice: 'Invoice',
	contract: 'Contract',
	bank_statement: 'Bank statement',
	transaction: 'Transaction',
	match: 'Match',
	booking: 'Booking',
	contact: 'Contact',
	pdf: 'PDF',
	report: 'Report',
	open_item: 'Open item',
	approval: 'Approval'
}

/** The open-item lifecycle (data-layer convenience for the vibes — NOT a schema enum). board 0084. */
export const OPEN_ITEM_STATUS = ['offen', 'teilbezahlt', 'bezahlt'] as const
export type OpenItemStatus = (typeof OPEN_ITEM_STATUS)[number]

/** Resource kinds backed by a persisted JSON Schema in the data store (the DB view), keyed by the
 *  schema NAME used there. Lets the flow UI type input/output badges to the real schema + deep-link
 *  to the DB schema view. Kinds absent here are ephemeral (in-memory) and carry no stored schema. */
export const RESOURCE_SCHEMA: Record<string, string> = {
	invoice: 'invoice',
	bank_statement: 'bank_statement',
	contract: 'contract',
	transaction: 'tx',
	booking: 'booking',
	contact: 'contact'
}
/** The data-store schema name backing a resource kind (for the DB view), or undefined if ephemeral. */
export function resourceSchema(kind: string): string | undefined {
	return RESOURCE_SCHEMA[kind]
}

/** State of a node within a running flow instance. `waiting` = stashed (blocked on a dependency,
 *  e.g. a Beleg awaiting its payment); `parked` = dead-lettered (e.g. a tx with no matching Beleg). */
export type NodeState = 'idle' | 'waiting' | 'running' | 'done' | 'error' | 'parked'

// LLM config + tool-call specs live in the capability layer; re-exported for flow consumers.
export type { JsonSchema, LlmConfig, ToolSpec } from './capability.js'
export { TOOL_SPECS, toolSpec } from './capability.js'

// ── Actor-model extras (board 0084, all OPTIONAL/additive — map the model onto an Akka-style runtime).

/** A named, typed port (mailbox slot) — for disambiguating multiple inputs/outputs of the same kind. */
export type Port = {
	id: string
	kind: ResourceKind
	label?: string
	required?: boolean
	many?: boolean
}

/** Supervision strategy for an actor (how the parent handles a failure) + retry/timeout. */
export type Supervision = {
	strategy: 'resume' | 'restart' | 'stop' | 'escalate'
	retry?: { max: number; backoff?: 'none' | 'linear' | 'exponential' }
	timeout?: number
}

/** What starts a flow (an actor system): manual, an inbound event/resource, or a schedule. */
export type Trigger = { kind: 'manual' | 'event' | 'schedule' | 'resource'; on?: ResourceKind }

/** A resource lifecycle = a tiny state machine (generic; e.g. open_item: offen→bezahlt). */
export type ResourceLifecycle = {
	kind: ResourceKind
	states: string[]
	transitions: { from: string; to: string; on?: string }[]
}

/** An actor blackbox: a recipe that turns its inbox (inputs) into its output.
 *  Composite/Leaf: a LEAF carries an `actor` (the real execution); a COMPOSITE carries a `flowRef`
 *  (the id of another Flow) and expands into that reusable sub-skill — so flows compose / daisy-chain. */
export type RecipeNode = {
	id: string
	name: string
	/** LEAF: the implementing actor (tool/function name), e.g. `classify_document`. */
	actor?: string
	/** COMPOSITE: the id of another Flow this node delegates to (a reusable sub-skill). */
	flowRef?: string
	/** Ingredients — what the actor consumes (≥1). */
	inputs: ResourceKind[]
	/** Products — what the actor emits (≥1). >1 = fan-out by kind. */
	outputs: ResourceKind[]
	note?: string
	/** The actor's system prompt (for LLM steps). board 0093: the SSOT for an extractor's instructions. */
	system_prompt?: string
	/** The tool-call / output JSON Schema the LLM step extracts to. board 0093: embedded here (the DRY
	 *  SSOT) so a generic extractor is driven entirely by node config — no per-doctype actor code. */
	schema?: Record<string, unknown>
	/** The LLM config the actor runs with (for LLM steps). */
	llm?: LlmConfig
	/** The tools/functions the actor invokes (ids into the capability `TOOL_SPECS`). */
	tools?: string[]
	/** Named typed ports (optional refinement of inputs/outputs). */
	ports?: { in?: Port[]; out?: Port[] }
	/** Supervision strategy for this actor. */
	supervision?: Supervision
	/** Generic actor config for non-LLM actors (a parser, an HTTP call, a furnace…). */
	config?: Record<string, unknown>
	/** Human-in-the-loop: this step waits for a person to review/accept before continuing. */
	hitl?: boolean
	/** The user-facing vibe card this step renders (e.g. "bookkeeping", "doc-compare", "invoice-booking").
	 *  The runner copies it onto the TraceStep so chat + the Runs explorer show the SAME card. board 0091. */
	vibe?: string
}

/** A directed connection (a message channel). `when` = a branch guard; `kind` = data (a resource
 *  message), control (ordering/trigger), or error (failure route). `message` = the resource sent. */
export type Edge = {
	from: string
	to: string
	resource?: ResourceKind
	when?: string
	kind?: 'data' | 'control' | 'error'
	message?: ResourceKind
	sourcePort?: string
	targetPort?: string
}

/** A skill (an actor system), modeled as a graph of recipe nodes. */
export type Flow = {
	id: string
	name: string
	description: string
	nodes: RecipeNode[]
	edges: Edge[]
	/** Optional domain label map for resource kinds (e.g. Minecraft items). */
	resourceLabels?: Record<string, string>
	/** What starts this flow (event sources / schedule / manual). board 0084. */
	triggers?: Trigger[]
}

/** A run of a flow: the current state of each node. */
export type FlowInstance = { flowId: string; nodeStates: Record<string, NodeState> }

/** One step of an instance run's trace = a SPAN (event-sourced): an actor received a message + emitted
 *  messages. Aligns with the aven-skills pipeline `StageEvent`/`Logger` model; nests via `parentSpanId`
 *  (composite sub-flows), repeats per item for fan-out, and carries lineage via produced/consumed ids. */
export type TraceStep = {
	nodeId: string
	state: NodeState
	/** human/relative timestamp (span start), e.g. '+12s' or 'heute 10:14'. */
	at?: string
	inputs?: string[]
	outputs?: string[]
	message?: string
	/** Optional user-facing "vibe" renderer key for this step (e.g. a chat-timeline card to reuse). */
	vibe?: string
	/** The payload handed to that vibe view (shape depends on `vibe`). */
	vibeData?: unknown
	// ── span fields (board 0084, optional/additive) ──
	/** This span's id; `parentSpanId` nests a composite's sub-flow spans. */
	spanId?: string
	parentSpanId?: string
	/** span end + attempt# (supervision retries). */
	endedAt?: string
	attempt?: number
	/** emitted output messages (lineage: produced resource ids). */
	emitted?: string[]
	/** structured log events within the span (aligned with the pipeline Logger). */
	events?: { level: LogLevel; at?: string; message: string }[]
	/** cost/metrics for this span (LLM tokens, duration). */
	cost?: { tokens?: number; ms?: number }
}

/** An INSTANCE of a Flow (the template/class): one execution with its trace. board 0083. */
export type FlowRun = {
	id: string
	flowId: string
	label: string
	startedAt?: string
	status: 'running' | 'done' | 'error'
	trace: TraceStep[]
}

/** A node that fans OUT: one input kind → ≥2 output kinds (e.g. statement → tx + account holder). */
export function isFanOut(n: RecipeNode): boolean {
	return n.inputs.length === 1 && n.outputs.length >= 2
}
/** A node that fans IN: ≥2 input kinds → one output (e.g. invoice + tx → match). */
export function isFanIn(n: RecipeNode): boolean {
	return n.inputs.length >= 2 && n.outputs.length === 1
}

/** COMPOSITE: a node that delegates to another flow (a reusable sub-skill). */
export function isComposite(n: RecipeNode): boolean {
	return !!n.flowRef
}
/** LEAF: a node that actually executes (no sub-flow). */
export function isLeaf(n: RecipeNode): boolean {
	return !n.flowRef
}

/** Entry nodes of a flow = those with no incoming edge (where upstream resources arrive). */
function entryNodes(f: Flow): string[] {
	const hasIn = new Set(f.edges.map((e) => e.to))
	return f.nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id)
}
/** Terminal nodes of a flow = those with no outgoing edge (where products leave). */
function terminalNodes(f: Flow): string[] {
	const hasOut = new Set(f.edges.map((e) => e.from))
	return f.nodes.filter((n) => !hasOut.has(n.id)).map((n) => n.id)
}

/** Expand a flow's COMPOSITE nodes recursively into a flat graph of only LEAF actors.
 *  Sub-flow nodes are namespaced (`<compositeId>/<subId>`); edges into a composite reconnect to the
 *  sub-flow's entry nodes, edges out reconnect from its terminals. Throws on a missing ref or a cycle. */
export function flattenFlow(flow: Flow, all: Flow[], path: Set<string> = new Set()): Flow {
	if (path.has(flow.id)) throw new Error(`flow cycle via "${flow.id}"`)
	const seen = new Set(path)
	seen.add(flow.id)
	const nodes: RecipeNode[] = []
	const edges: Edge[] = []
	const expanded: Record<string, { entries: string[]; terminals: string[] }> = {}
	for (const n of flow.nodes) {
		if (isLeaf(n)) {
			nodes.push({ ...n })
			continue
		}
		const sub = all.find((f) => f.id === n.flowRef)
		if (!sub) throw new Error(`${flow.id}/${n.id}: flowRef "${n.flowRef}" not found`)
		const flat = flattenFlow(sub, all, seen)
		const prefix = `${n.id}/`
		for (const sn of flat.nodes) nodes.push({ ...sn, id: prefix + sn.id })
		for (const se of flat.edges) edges.push({ ...se, from: prefix + se.from, to: prefix + se.to })
		expanded[n.id] = {
			entries: entryNodes(flat).map((id) => prefix + id),
			terminals: terminalNodes(flat).map((id) => prefix + id)
		}
	}
	for (const e of flow.edges) {
		const froms = expanded[e.from]?.terminals ?? [e.from]
		const tos = expanded[e.to]?.entries ?? [e.to]
		for (const from of froms) for (const to of tos) edges.push({ ...e, from, to })
	}
	return {
		id: flow.id,
		name: flow.name,
		description: flow.description,
		nodes,
		edges,
		resourceLabels: flow.resourceLabels
	}
}

/** Column index per node = longest path from a root — for a layered DAG layout (handles branches). */
export function flowDepths(flow: Flow): Record<string, number> {
	const depth: Record<string, number> = {}
	for (const n of flow.nodes) depth[n.id] = 0
	// Relax edges up to N times (DAG → converges); longest-path assigns each node its column.
	for (let pass = 0; pass < flow.nodes.length; pass++) {
		let changed = false
		for (const e of flow.edges) {
			if (depth[e.from] == null || depth[e.to] == null) continue
			if (depth[e.to] < depth[e.from] + 1) {
				depth[e.to] = depth[e.from] + 1
				changed = true
			}
		}
		if (!changed) break
	}
	return depth
}

/** Structural problems with a flow. Empty = valid. board 0084 adds (additive, satisfied by all real
 *  flows): edge resource type-compatibility, flow-level cycle detection, and unreachable-node detection. */
export function validateFlow(flow: Flow): string[] {
	const byId = new Map(flow.nodes.map((n) => [n.id, n]))
	const ids = new Set(byId.keys())
	const problems: string[] = []
	for (const n of flow.nodes) {
		if (!n.actor && !n.flowRef)
			problems.push(`${flow.id}/${n.id}: needs an actor (leaf) or flowRef (composite)`)
		if (n.inputs.length === 0) problems.push(`${flow.id}/${n.id}: no inputs`)
		if (n.outputs.length === 0) problems.push(`${flow.id}/${n.id}: no outputs`)
	}
	for (const e of flow.edges) {
		if (!ids.has(e.from)) problems.push(`${flow.id}: edge.from "${e.from}" missing`)
		if (!ids.has(e.to)) problems.push(`${flow.id}: edge.to "${e.to}" missing`)
		// type-compat: the message must be produced by the source and accepted by the target.
		const msg = e.message ?? e.resource
		const from = byId.get(e.from)
		const to = byId.get(e.to)
		if (msg && from && to) {
			if (!from.outputs.includes(msg))
				problems.push(`${flow.id}: edge ${e.from}→${e.to} sends "${msg}" not in ${e.from}.outputs`)
			if (!to.inputs.includes(msg))
				problems.push(`${flow.id}: edge ${e.from}→${e.to} sends "${msg}" not in ${e.to}.inputs`)
		}
	}
	// flow-level cycle detection (DFS over the edge graph).
	const adj = new Map<string, string[]>()
	for (const e of flow.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
	const WHITE = 0
	const GREY = 1
	const BLACK = 2
	const color = new Map<string, number>()
	const visit = (id: string): boolean => {
		color.set(id, GREY)
		for (const nxt of adj.get(id) ?? []) {
			const c = color.get(nxt) ?? WHITE
			if (c === GREY) return true
			if (c === WHITE && visit(nxt)) return true
		}
		color.set(id, BLACK)
		return false
	}
	for (const n of flow.nodes)
		if ((color.get(n.id) ?? WHITE) === WHITE && visit(n.id))
			problems.push(`${flow.id}: cycle detected (not a DAG)`)
	// unreachable / orphan nodes: in a multi-node flow, a node that appears in no edge is disconnected.
	if (flow.nodes.length > 1) {
		const wired = new Set<string>()
		for (const e of flow.edges) {
			wired.add(e.from)
			wired.add(e.to)
		}
		for (const n of flow.nodes)
			if (!wired.has(n.id)) problems.push(`${flow.id}/${n.id}: unreachable (no edges)`)
	}
	return problems
}

/** The node↔actor / edge↔message / composite↔supervision-subtree / trace↔event-log mapping — the
 *  contract that keeps the descriptive model aligned with a future actor (Akka-style) runtime. 0084. */
export const ACTOR_MAPPING: { flow: string; actor: string }[] = [
	{ flow: 'RecipeNode', actor: 'Actor (id=address, inputs=mailbox, state=behavior)' },
	{ flow: 'ResourceKind on an edge', actor: 'typed Message' },
	{ flow: 'Edge', actor: 'message channel (tell); kind data/control/error' },
	{ flow: 'Composite (flowRef)', actor: 'child actor system / supervision subtree' },
	{ flow: 'Flow', actor: 'ActorSystem' },
	{ flow: 'FlowRun / TraceStep', actor: 'event-sourced span log (StageEvent/Logger)' },
	{ flow: 'waiting', actor: 'stash' },
	{ flow: 'parked', actor: 'dead-letters' },
	{ flow: 'supervision', actor: 'supervision strategy (resume/restart/stop/escalate)' },
	{ flow: 'triggers', actor: 'event sources' }
]

/** A generic resource lifecycle (state machine). Example: the open-item offen→bezahlt lifecycle. */
export const OPEN_ITEM_LIFECYCLE: ResourceLifecycle = {
	kind: 'open_item',
	states: [...OPEN_ITEM_STATUS],
	transitions: [
		{ from: 'offen', to: 'teilbezahlt', on: 'Teilzahlung' },
		{ from: 'offen', to: 'bezahlt', on: 'Zahlung' },
		{ from: 'teilbezahlt', to: 'bezahlt', on: 'Restzahlung' }
	]
}

const NODE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['id', 'name', 'inputs', 'outputs'],
	properties: {
		id: { type: 'string' },
		name: { type: 'string' },
		actor: { type: ['string', 'null'] },
		flowRef: { type: ['string', 'null'] },
		inputs: { type: 'array', minItems: 1, items: { type: 'string' } },
		outputs: { type: 'array', minItems: 1, items: { type: 'string' } },
		note: { type: ['string', 'null'] },
		system_prompt: { type: ['string', 'null'] },
		llm: { type: ['object', 'null'], additionalProperties: true },
		tools: { type: ['array', 'null'], items: { type: 'string' } },
		ports: { type: ['object', 'null'], additionalProperties: true },
		supervision: { type: ['object', 'null'], additionalProperties: true },
		config: { type: ['object', 'null'], additionalProperties: true },
		hitl: { type: ['boolean', 'null'] }
	}
} as const

/** JSON Schema for a Flow (Ajv-validatable). */
export const FLOW_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['id', 'name', 'description', 'nodes', 'edges'],
	properties: {
		id: { type: 'string' },
		name: { type: 'string' },
		description: { type: 'string' },
		nodes: { type: 'array', minItems: 1, items: NODE_SCHEMA },
		resourceLabels: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
		triggers: { type: ['array', 'null'], items: { type: 'object', additionalProperties: true } },
		edges: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['from', 'to'],
				properties: {
					from: { type: 'string' },
					to: { type: 'string' },
					resource: { type: ['string', 'null'] },
					when: { type: ['string', 'null'] },
					kind: { type: ['string', 'null'] },
					message: { type: ['string', 'null'] },
					sourcePort: { type: ['string', 'null'] },
					targetPort: { type: ['string', 'null'] }
				}
			}
		}
	}
} as const

/** Our real skills + a Minecraft demo — loaded from pure JSON config (flows.json). board 0083. */
export const EXAMPLE_FLOWS: Flow[] = flowsJson as unknown as Flow[]

// Runs are no longer seeded fixtures — they are the REAL persisted flow_run rows produced by the
// generic runner (board 0089/0090); the app reads them from GET /api/skills/runs, not from here.

/** The index of a run's CURRENT step = the first 'running' step, else the last traced step (else -1). */
export function currentStepIndex(run: FlowRun | null): number {
	if (!run || run.trace.length === 0) return -1
	const running = run.trace.findIndex((s) => s.state === 'running')
	return running >= 0 ? running : run.trace.length - 1
}

/** The latest traced state of a node within a run (else 'idle'). */
export function runStateOf(run: FlowRun | null, nodeId: string): NodeState {
	if (!run) return 'idle'
	let st: NodeState = 'idle'
	for (const step of run.trace) if (step.nodeId === nodeId) st = step.state
	return st
}

/** A plausible mock run state for a flow — first node done, the next running, the rest idle. */
export function exampleInstance(flow: Flow): FlowInstance {
	const nodeStates: Record<string, NodeState> = {}
	flow.nodes.forEach((n, i) => {
		nodeStates[n.id] = i === 0 ? 'done' : i === 1 ? 'running' : 'idle'
	})
	return { flowId: flow.id, nodeStates }
}
