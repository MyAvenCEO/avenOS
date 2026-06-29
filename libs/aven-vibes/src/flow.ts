// board 0083 — a universal resource-transformation model (Minecraft-recipe style). A `Resource` is a
// typed item; a `RecipeNode` is an actor blackbox consuming 1+ input resources → producing 1+ output
// resources (fan-out 1→N by output kinds, fan-in N→1 by input kinds); a `Flow` is a graph of recipes;
// a `FlowInstance` is a run with per-node state. Descriptive (powers the Skills view); shaped so it
// could drive execution later. Pure (no DOM): just the schema + our existing skills as data.

import flowsJson from './flows.json'
import runsJson from './runs.json'

/** The typed items that flow between recipes. */
export type ResourceKind = string

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
	prompt: 'Prompt',
	audio: 'Sprachnotiz',
	file: 'Datei',
	image: 'Bild',
	document: 'Dokument',
	invoice: 'Rechnung',
	contract: 'Vertrag',
	bank_statement: 'Kontoauszug',
	transaction: 'Transaktion',
	match: 'Match',
	booking: 'Buchung',
	contact: 'Kontakt',
	pdf: 'PDF',
	report: 'Bericht'
}

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

/** State of a node within a running flow instance. */
export type NodeState = 'idle' | 'waiting' | 'running' | 'done' | 'error'

/** LLM config an actor runs with (when it's an LLM step). */
export type LlmConfig = {
	model: string
	temperature?: number
	vision?: boolean
	/** how the model is driven: a forced tool call, free chat, or a vision pass. */
	mode?: 'tool' | 'chat' | 'vision'
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
	/** The actor's system prompt (for LLM steps). */
	system_prompt?: string
	/** The LLM config the actor runs with (for LLM steps). */
	llm?: LlmConfig
	/** The tools/functions the actor invokes. */
	tools?: string[]
}

/** A directed connection: one node's output feeds another node's inbox. `when` = a branch guard
 *  (e.g. the classified doc type) — that's how a shared entry point fans into conditional flows. */
export type Edge = { from: string; to: string; resource?: ResourceKind; when?: string }

/** A skill, modeled as a graph of recipe nodes. */
export type Flow = {
	id: string
	name: string
	description: string
	nodes: RecipeNode[]
	edges: Edge[]
	/** Optional domain label map for resource kinds (e.g. Minecraft items). */
	resourceLabels?: Record<string, string>
}

/** A run of a flow: the current state of each node. */
export type FlowInstance = { flowId: string; nodeStates: Record<string, NodeState> }

/** One step of an instance run's trace — what an actor did, when, with which resources. */
export type TraceStep = {
	nodeId: string
	state: NodeState
	/** human/relative timestamp, e.g. '+12s' or 'heute 10:14'. */
	at?: string
	inputs?: string[]
	outputs?: string[]
	message?: string
	/** Optional user-facing "vibe" renderer key for this step (e.g. a chat-timeline card to reuse). */
	vibe?: string
	/** The payload handed to that vibe view (shape depends on `vibe`). */
	vibeData?: unknown
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

/** Structural problems with a flow (edges referencing missing nodes, empty in/out). Empty = valid. */
export function validateFlow(flow: Flow): string[] {
	const ids = new Set(flow.nodes.map((n) => n.id))
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
	}
	return problems
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
		tools: { type: ['array', 'null'], items: { type: 'string' } }
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
					when: { type: ['string', 'null'] }
				}
			}
		}
	}
} as const

/** Our real skills + a Minecraft demo — loaded from pure JSON config (flows.json). board 0083. */
export const EXAMPLE_FLOWS: Flow[] = flowsJson as unknown as Flow[]

/** Example instance RUNS (with traces) — separate from the Flow templates. From runs.json. */
export const EXAMPLE_RUNS: FlowRun[] = runsJson as unknown as FlowRun[]

/** The runs (instances) of a given flow template. */
export function runsForFlow(flowId: string): FlowRun[] {
	return EXAMPLE_RUNS.filter((r) => r.flowId === flowId)
}

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
