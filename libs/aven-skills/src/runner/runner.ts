import {
	type Flow,
	flowDepths,
	type FlowRun,
	type RecipeNode,
	type TraceStep,
	validateFlow
} from '../flow.js'

// The generic flow runner (board 0089). Executes ANY Flow by resolving each node's `actor` from an
// injected registry — there is NO skill-specific code here. Nodes run in longest-path (topological)
// order; typed resources thread along a bus; the result is a FlowRun event-log + the final outputs.
// Synchronous topological run only — mailboxes / supervision / parallelism / HITL are follow-on.

/** What an actor receives: its node + the resources present on the node's declared inputs. */
export type ActorContext = {
	node: RecipeNode
	inputs: Record<string, unknown>
}
/** An actor is a pure-ish async function (its side-effecting ports are closed over by the registry). */
export type Actor = (ctx: ActorContext) => Promise<Record<string, unknown>>
export type ActorRegistry = Record<string, Actor>

export type RunFlowOpts = {
	actors: ActorRegistry
	runId: string
	now: () => string
	label?: string
	/** initial trigger resources seeded onto the bus (e.g. `{ file: bytes }`) */
	input?: Record<string, unknown>
	/** Called after each node completes — lets the host stream the step's vibe card live. board 0091. */
	onStep?: (step: TraceStep) => void
}

export type RunResult = {
	run: FlowRun
	/** the final resource bus — every kind produced by the flow (e.g. the `document` output) */
	outputs: Record<string, unknown>
}

export async function runFlow(flow: Flow, opts: RunFlowOpts): Promise<RunResult> {
	const { actors, runId, now } = opts
	const base: FlowRun = {
		id: runId,
		flowId: flow.id,
		label: opts.label ?? flow.name,
		startedAt: now(),
		status: 'running',
		trace: []
	}
	const bus: Record<string, unknown> = { ...(opts.input ?? {}) }

	const problems = validateFlow(flow)
	if (problems.length > 0) {
		const trace: TraceStep[] = [
			{ nodeId: flow.nodes[0]?.id ?? '?', state: 'error', at: now(), message: `invalid flow: ${problems.join('; ')}` }
		]
		return { run: { ...base, status: 'error', trace }, outputs: bus }
	}

	const depth = flowDepths(flow)
	const order = [...flow.nodes].sort((a, b) => (depth[a.id] ?? 0) - (depth[b.id] ?? 0))
	const trace: TraceStep[] = []

	for (const node of order) {
		const inputs: Record<string, unknown> = {}
		for (const kind of node.inputs) if (kind in bus) inputs[kind] = bus[kind]
		const actor = node.actor ? actors[node.actor] : undefined
		if (!actor) {
			trace.push({
				nodeId: node.id,
				state: 'error',
				at: now(),
				inputs: Object.keys(inputs),
				message: `no actor registered for "${node.actor ?? node.id}"`
			})
			return { run: { ...base, status: 'error', trace }, outputs: bus }
		}
		try {
			const out = await actor({ node, inputs })
			for (const [kind, val] of Object.entries(out)) bus[kind] = val
			// the step's vibe card (config-driven): node.vibe + the node's primary output as data — so
			// chat + the Runs explorer render the SAME card from one source (the trace). board 0091.
			const primaryOut = node.outputs[0]
			const step: TraceStep = {
				nodeId: node.id,
				state: 'done',
				at: now(),
				inputs: Object.keys(inputs),
				outputs: Object.keys(out),
				...(node.vibe
					? { vibe: node.vibe, vibeData: primaryOut !== undefined ? out[primaryOut] : undefined }
					: {})
			}
			trace.push(step)
			opts.onStep?.(step)
		} catch (e) {
			trace.push({
				nodeId: node.id,
				state: 'error',
				at: now(),
				inputs: Object.keys(inputs),
				message: e instanceof Error ? e.message : String(e)
			})
			return { run: { ...base, status: 'error', trace }, outputs: bus }
		}
	}
	return { run: { ...base, status: 'done', trace }, outputs: bus }
}
