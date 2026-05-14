<script lang="ts">
	import { onMount } from 'svelte'

	import EventRenderer from './event-renderers/EventRenderer.svelte'
	import RuntimeTreeNode from './RuntimeTreeNode.svelte'

	type ActorHierarchyRecord = {
		actorId: string
		parentActorId: string | null
		kind: string
		name: string
		depth: number
		isCurrent: boolean
		firstSeenAt: string | null
		lastSeenAt: string | null
		directChildCount?: number
		messageCount?: number
	}

	type ActorLogRecord = {
		seq: number
		id: string
		scope: string
		actorId: string | null
		envelopeId: string | null
		type: string
		payload: unknown
		createdAt: string
		logView: 'chat' | 'deep-dive'
	}

	type IntentSummaryRecord = {
		id: string
		title: string | null
		goal: string | null
		status: string | null
		summary: string | null
		createdAt: string
		updatedAt: string
		version: number
		state: unknown
	}

	type LogPreset = 'overview' | 'conversation' | 'prompts' | 'skills' | 'technical' | 'errors' | 'raw'

	type TreeKind = 'root' | 'actor' | 'intent' | 'conversation'
	type Projection = 'structural' | 'communication'

	type RuntimeTreeItem = {
		id: string
		label: string
		sublabel?: string
		kind: TreeKind
		projection?: Projection
		actorId?: string | null
		intentId?: string | null
		conversationIndex?: number
		pathActors?: string[]
		payload?: unknown
		hasChildren?: boolean
		childCount?: number
		children?: RuntimeTreeItem[]
		isExpanded?: boolean
		isLoading?: boolean
		isSelected?: boolean
	}

	type SelectedItem = {
		id: string
		kind: TreeKind
		projection?: Projection
		title: string
		subtitle?: string
		payload: unknown
	}

	type IntentTraceEntry = {
		id: string
		kind: 'message' | 'trace'
		role?: 'user' | 'assistant'
		title?: string
		text?: string
		meta?: string
		steps?: Array<{ label: string; detail?: string; tone?: 'neutral' | 'success' | 'error' }>
	}

	let tree: RuntimeTreeItem[] = $state([])
	let selectedItem: SelectedItem | null = $state(null)
	let detailLogs: ActorLogRecord[] = $state([])
	let activePreset = $state<LogPreset>('overview')
	let activeLogType = $state<string | null>(null)
	let error: string | null = $state(null)
	let loading = $state(false)
	let intentTraceEntries: IntentTraceEntry[] = $state([])

	const availableLogTypes = $derived(
		[...new Set(detailLogs.map((event) => event.type))].toSorted((a, b) => a.localeCompare(b))
	)
	const filteredDetailLogs = $derived(
		(detailLogs
			.filter((event) => matchesPreset(event, activePreset))
			.filter((event) => (activeLogType ? event.type === activeLogType : true)))
	)
	const displayedDetailLogs = $derived(
		activePreset === 'raw'
			? filteredDetailLogs
			: [...filteredDetailLogs].toSorted((a, b) => {
				const time = a.createdAt.localeCompare(b.createdAt)
				if (time !== 0) return time
				const priority = displayPriority(a) - displayPriority(b)
				if (priority !== 0) return priority
				return a.seq - b.seq
			})
	)
	const presetCounts = $derived({
		overview: detailLogs.filter((event) => matchesPreset(event, 'overview')).length,
		conversation: detailLogs.filter((event) => matchesPreset(event, 'conversation')).length,
		prompts: detailLogs.filter((event) => matchesPreset(event, 'prompts')).length,
		skills: detailLogs.filter((event) => matchesPreset(event, 'skills')).length,
		technical: detailLogs.filter((event) => matchesPreset(event, 'technical')).length,
		errors: detailLogs.filter((event) => matchesPreset(event, 'errors')).length,
		raw: detailLogs.length
	})

	async function expectJson<T>(response: Response): Promise<T> {
		if (!response.ok) throw new Error(await response.text())
		return (await response.json()) as T
	}

	function pretty(value: unknown): string {
		try {
			return JSON.stringify(value, null, 2)
		} catch {
			return String(value)
		}
	}

	function rootItems(): RuntimeTreeItem[] {
		return [
			{
				id: 'structural-root',
				label: 'Structural hierarchy',
				sublabel: 'Actual actor parent/child structure',
				kind: 'root',
				projection: 'structural',
				hasChildren: true,
				childCount: undefined,
				children: [],
				isExpanded: false
			},
			{
				id: 'communication-root',
				label: 'Communication hierarchy',
				sublabel: 'Sender → receiver projection',
				kind: 'root',
				projection: 'communication',
				hasChildren: true,
				childCount: undefined,
				children: [],
				isExpanded: false
			},
			{
				id: 'intent-root',
				label: 'Intent conversations',
				sublabel: 'Intent list with human-readable conversation traces',
				kind: 'root',
				hasChildren: true,
				childCount: undefined,
				children: [],
				isExpanded: false
			}
		]
	}

	function actorNodeId(projection: Projection, actorId: string, pathActors: string[]): string {
		return `${projection}:${[...pathActors, actorId].join('>')}`
	}

	function mapActorToNode(record: ActorHierarchyRecord, projection: Projection, pathActors: string[]): RuntimeTreeItem {
		const nextPath = projection === 'communication' ? [...pathActors, record.actorId] : pathActors
		return {
			id: actorNodeId(projection, record.actorId, pathActors),
			label: record.actorId,
			sublabel:
				projection === 'communication'
					? `${record.kind} · ${record.messageCount ?? 0} outgoing message${record.messageCount === 1 ? '' : 's'}`
					: `${record.kind} · ${record.lastSeenAt ?? 'n/a'}`,
			kind: 'actor',
			projection,
			actorId: record.actorId,
			pathActors: nextPath,
			hasChildren: (record.directChildCount ?? 0) > 0,
			childCount: record.directChildCount ?? 0,
			children: [],
			isExpanded: false,
			payload: record
		}
	}

	function mapIntentToNode(record: IntentSummaryRecord): RuntimeTreeItem {
		return {
			id: `intent:${record.id}`,
			label: record.title ?? record.id,
			sublabel: `${record.status ?? 'unknown'} · ${record.updatedAt}`,
			kind: 'intent',
			intentId: record.id,
			hasChildren: true,
			childCount: undefined,
			children: [],
			isExpanded: false,
			payload: record
		}
	}

	function mapTraceEntryToNode(intentId: string, entry: IntentTraceEntry, index: number): RuntimeTreeItem {
		const icon = entry.kind === 'trace' ? 'Trace' : entry.role === 'user' ? 'User' : 'Assistant'
		const preview = entry.text?.replace(/\s+/g, ' ').trim() ?? entry.title ?? 'Conversation step'
		return {
			id: `intent:${intentId}:conversation:${index}`,
			label: preview.length > 72 ? `${preview.slice(0, 71)}…` : preview,
			sublabel: `${icon}${entry.meta ? ` · ${entry.meta}` : ''}`,
			kind: 'conversation',
			intentId,
			conversationIndex: index,
			hasChildren: false,
			childCount: 0,
			children: [],
			isExpanded: false,
			payload: entry
		}
	}

	async function loadStructuralChildren(parentActorId: string | null): Promise<ActorHierarchyRecord[]> {
		const params = new URLSearchParams()
		if (parentActorId) params.set('parentActorId', parentActorId)
		const suffix = params.size > 0 ? `?${params.toString()}` : ''
		const response = await fetch(`/api/aven/jaensen/actors/structural-children${suffix}`)
		return (await expectJson<{ actors: ActorHierarchyRecord[] }>(response)).actors
	}

	async function loadCommunicationChildren(actorId: string | null): Promise<ActorHierarchyRecord[]> {
		const params = new URLSearchParams()
		if (actorId) params.set('actorId', actorId)
		const suffix = params.size > 0 ? `?${params.toString()}` : ''
		const response = await fetch(`/api/aven/jaensen/actors/communication-children${suffix}`)
		return (await expectJson<{ actors: ActorHierarchyRecord[] }>(response)).actors
	}

	async function loadIntentChildren(): Promise<IntentSummaryRecord[]> {
		const response = await fetch('/api/aven/jaensen/intents')
		const body = await expectJson<{ intents: IntentSummaryRecord[] }>(response)
		return body.intents.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	}

	async function fetchIntentEvents(intentId: string): Promise<ActorLogRecord[]> {
		const scope = `intents/${intentId}`
		const response = await fetch(`/api/aven/jaensen/events?scope=${encodeURIComponent(scope)}`)
		return (await expectJson<{ events: ActorLogRecord[] }>(response)).events.toSorted((a, b) => a.seq - b.seq)
	}

	async function loadActorDetails(actorId: string) {
		const response = await fetch(`/api/aven/jaensen/actors/branch-logs?rootActorId=${encodeURIComponent(actorId)}&view=deep-dive&limit=300`)
		detailLogs = (await expectJson<{ events: ActorLogRecord[] }>(response)).events.toSorted((a, b) => a.seq - b.seq)
		intentTraceEntries = []
		activePreset = 'overview'
		activeLogType = null
	}

	async function loadIntentDetails(intentId: string) {
		detailLogs = await fetchIntentEvents(intentId)
		intentTraceEntries = buildIntentTraceEntries(detailLogs)
		activePreset = 'conversation'
		activeLogType = null
	}

	function updateTreeItem(items: RuntimeTreeItem[], itemId: string, updater: (item: RuntimeTreeItem) => RuntimeTreeItem): RuntimeTreeItem[] {
		return items.map((item) => {
			if (item.id === itemId) return updater(item)
			if ((item.children?.length ?? 0) > 0) {
				return { ...item, children: updateTreeItem(item.children ?? [], itemId, updater) }
			}
			return item
		})
	}

	function clearSelection(items: RuntimeTreeItem[]): RuntimeTreeItem[] {
		return items.map((item) => ({
			...item,
			isSelected: false,
			children: item.children ? clearSelection(item.children) : item.children
		}))
	}

	async function ensureChildrenLoaded(item: RuntimeTreeItem): Promise<void> {
		if (!item.hasChildren || item.isLoading || (item.children?.length ?? 0) > 0) return
		tree = updateTreeItem(tree, item.id, (node) => ({ ...node, isLoading: true }))
		try {
			let children: RuntimeTreeItem[] = []
			if (item.id === 'intent-root') {
				const intents = await loadIntentChildren()
				children = intents.map(mapIntentToNode)
			} else if (item.kind === 'intent' && item.intentId) {
				const events = await fetchIntentEvents(item.intentId)
				const entries = buildIntentTraceEntries(events)
				children = entries.map((entry, index) => mapTraceEntryToNode(item.intentId ?? 'intent', entry, index))
			} else {
				const rows = item.projection === 'structural'
					? await loadStructuralChildren(item.actorId ?? null)
					: await loadCommunicationChildren(item.actorId ?? null)

				const filteredRows = item.projection === 'communication'
					? rows.filter((row) => !(item.pathActors ?? []).includes(row.actorId))
					: rows

				children = filteredRows.map((row) => mapActorToNode(row, item.projection ?? 'structural', item.pathActors ?? []))
			}
			tree = updateTreeItem(tree, item.id, (node) => ({
				...node,
				isLoading: false,
				children,
				childCount: children.length,
				hasChildren: children.length > 0
			}))
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause)
			tree = updateTreeItem(tree, item.id, (node) => ({ ...node, isLoading: false }))
		}
	}

	async function onToggle(item: RuntimeTreeItem) {
		const nextExpanded = !item.isExpanded
		tree = updateTreeItem(tree, item.id, (node) => ({ ...node, isExpanded: nextExpanded }))
		if (nextExpanded) await ensureChildrenLoaded(item)
	}

	async function onSelect(item: RuntimeTreeItem) {
		error = null
		tree = updateTreeItem(clearSelection(tree), item.id, (node) => ({ ...node, isSelected: true }))
		selectedItem = {
			id: item.id,
			kind: item.kind,
			projection: item.projection,
			title: item.label,
			subtitle: item.sublabel,
			payload: item.payload ?? { actorId: item.actorId, intentId: item.intentId, projection: item.projection }
		}
		if (item.kind === 'actor' && item.actorId) await loadActorDetails(item.actorId)
		else if (item.kind === 'intent' && item.intentId) await loadIntentDetails(item.intentId)
		else if (item.kind === 'conversation' && item.intentId) await loadIntentDetails(item.intentId)
		else {
			detailLogs = []
			intentTraceEntries = []
		}
	}

	async function refresh() {
		loading = true
		error = null
		selectedItem = null
		detailLogs = []
		intentTraceEntries = []
		activePreset = 'overview'
		activeLogType = null
		try {
			tree = rootItems()
		} finally {
			loading = false
		}
	}

	async function refreshSelectedDetails() {
		if (!selectedItem) return
		error = null
		if (selectedItem.kind === 'actor') {
			const actorId = (selectedItem.payload as ActorHierarchyRecord).actorId
			if (actorId) await loadActorDetails(actorId)
			return
		}
		if (selectedItem.kind === 'intent') {
			const payload = selectedItem.payload as IntentSummaryRecord
			if (payload.id) await loadIntentDetails(payload.id)
			return
		}
		if (selectedItem.kind === 'conversation') {
			const item = findItemById(tree, selectedItem.id)
			if (item?.intentId) await loadIntentDetails(item.intentId)
		}
	}

	function findItemById(items: RuntimeTreeItem[], itemId: string): RuntimeTreeItem | null {
		for (const item of items) {
			if (item.id === itemId) return item
			const child = item.children ? findItemById(item.children, itemId) : null
			if (child) return child
		}
		return null
	}

	function visibleIntentTraceEntries(): IntentTraceEntry[] {
		if (selectedItem?.kind !== 'conversation') return intentTraceEntries
		const item = findItemById(tree, selectedItem.id)
		const start = item?.conversationIndex ?? 0
		return intentTraceEntries.slice(start)
	}

	function directionParts(event: ActorLogRecord) {
		const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
			? (event.payload as Record<string, unknown>)
			: {}
		const from = typeof payload.fromActor === 'string' ? payload.fromActor : event.actorId ?? 'unknown'
		const to = typeof payload.toActor === 'string' ? payload.toActor : 'unknown'
		return { from, to }
	}

	function isTransferEvent(event: ActorLogRecord): boolean {
		return [
			'actor.io.inbound',
			'actor.io.outbound',
			'runtime.envelope.queued',
			'runtime.envelope.claimed',
			'runtime.envelope.completed',
			'runtime.envelope.failed'
		].includes(event.type)
	}

	function eventMetaChips(event: ActorLogRecord): Array<{ label: string; value: string }> {
		const payload = payloadRecord(event.payload)
		const chips: Array<{ label: string; value: string }> = []
		if (isTransferEvent(event)) {
			const flow = directionParts(event)
			chips.push({ label: 'From', value: flow.from })
			chips.push({ label: 'To', value: flow.to })
			return chips
		}
		if (typeof payload.intentId === 'string') chips.push({ label: 'Intent', value: payload.intentId })
		if (typeof payload.skillId === 'string') chips.push({ label: 'Skill', value: payload.skillId })
		if (typeof payload.fromSkillId === 'string') chips.push({ label: 'Skill', value: payload.fromSkillId })
		if (typeof payload.workerId === 'string') chips.push({ label: 'Worker', value: payload.workerId })
		if (typeof payload.workerActorId === 'string') chips.push({ label: 'Worker actor', value: payload.workerActorId })
		if (typeof payload.messageType === 'string') chips.push({ label: 'Message', value: payload.messageType })
		if (typeof payload.status === 'string') chips.push({ label: 'Status', value: payload.status })
		return chips
	}

	function compactMetaItems(event: ActorLogRecord): Array<{ label: string; value: string }> {
		const payload = payloadRecord(event.payload)
		const trace = traceRecord(event)
		const result = payloadRecord(payload.result)
		const items: Array<{ label: string; value: string }> = []

		switch (event.type) {
			case 'intent.created':
			case 'intent.status_changed':
				if (typeof payload.status === 'string') items.push({ label: 'Status', value: payload.status })
				break
			case 'intent.message_to_user':
				if (typeof payload.messageType === 'string') items.push({ label: 'Kind', value: payload.messageType })
				break
			case 'intent.skill_call_started':
				if (typeof payload.skillId === 'string') items.push({ label: 'Skill', value: payload.skillId })
				if (typeof payload.request === 'string') items.push({ label: 'Request', value: payload.request })
				break
			case 'intent.skill_call_completed':
			case 'skill.worker_completed':
				if (typeof payload.fromSkillId === 'string') items.push({ label: 'Skill', value: payload.fromSkillId })
				else if (typeof payload.skillId === 'string') items.push({ label: 'Skill', value: payload.skillId })
				if (typeof result.count === 'number') items.push({ label: 'Count', value: String(result.count) })
				else if (typeof result.entityId === 'string') items.push({ label: 'Entity', value: result.entityId })
				if (typeof result.ok === 'boolean') items.push({ label: 'Result', value: result.ok ? 'ok' : 'error' })
				break
			case 'skill.worker_spawned':
			case 'skill.worker_routed':
				if (typeof payload.skillId === 'string') items.push({ label: 'Skill', value: payload.skillId })
				if (typeof payload.workerId === 'string') items.push({ label: 'Worker', value: payload.workerId })
				break
			case 'actor.io.prompt':
				if (typeof trace.label === 'string') items.push({ label: 'Prompt', value: trace.label })
				break
			case 'actor.io.shell':
				if (typeof trace.exitCode === 'number') items.push({ label: 'Exit', value: String(trace.exitCode) })
				break
			case 'actor.io.inbound':
			case 'actor.io.outbound':
			case 'runtime.envelope.queued':
			case 'runtime.envelope.completed': {
				const flow = directionParts(event)
				if (typeof payload.envelopeType === 'string') items.push({ label: 'Type', value: payload.envelopeType })
				items.push({ label: event.type.includes('inbound') ? 'From' : 'To', value: event.type.includes('inbound') ? flow.from : flow.to })
				break
			}
			case 'runtime.envelope.claimed':
				if (typeof payload.actorId === 'string') items.push({ label: 'Actor', value: payload.actorId })
				if (typeof payload.attempts === 'number') items.push({ label: 'Attempt', value: String(payload.attempts) })
				break
			case 'runtime.envelope.failed':
				if (typeof payload.actorId === 'string') items.push({ label: 'Actor', value: payload.actorId })
				if (typeof payload.status === 'string') items.push({ label: 'Status', value: payload.status })
				break
			case 'actor.event': {
				const inner = payloadRecord(payload.event)
				if (typeof payload.eventType === 'string') items.push({ label: 'Event', value: payload.eventType })
				if (typeof inner.actorKind === 'string') items.push({ label: 'Kind', value: inner.actorKind })
				break
			}
			case 'context.appended':
				if (typeof payload.kind === 'string') items.push({ label: 'Kind', value: payload.kind })
				if (typeof payload.key === 'string') items.push({ label: 'Key', value: payload.key })
				if (typeof payload.actorId === 'string') items.push({ label: 'Actor', value: payload.actorId })
				break
		}

		for (const chip of eventMetaChips(event)) {
			if (items.length >= 3) break
			if (!items.some((item) => item.label === chip.label && item.value === chip.value)) items.push(chip)
		}

		return items.slice(0, 3)
	}

	function hasExpandedInsight(event: ActorLogRecord): boolean {
		return !isCompactEvent(event) || event.type === 'runtime.envelope.failed' || event.type === 'actor.io.inbound' || event.type === 'actor.io.outbound'
	}

	function bubbleSide(event: ActorLogRecord): 'left' | 'right' | 'center' {
		if (selectedItem?.kind !== 'actor') return 'center'
		const actorId = (selectedItem.payload as ActorHierarchyRecord).actorId
		const { from, to } = directionParts(event)
		if (from === actorId && to !== actorId) return 'right'
		if (to === actorId && from !== actorId) return 'left'
		return 'center'
	}

	function sideLabel(side: 'left' | 'right' | 'center'): string {
		if (side === 'left') return 'Incoming'
		if (side === 'right') return 'Outgoing'
		return 'Internal'
	}

	function payloadRecord(value: unknown): Record<string, unknown> {
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
	}

	function traceRecord(event: ActorLogRecord): Record<string, unknown> {
		return payloadRecord(payloadRecord(event.payload).trace)
	}

	function matchesPreset(event: ActorLogRecord, preset: LogPreset): boolean {
		if (preset === 'raw') return true
		if (preset === 'errors') return event.type.includes('failed') || event.type.includes('error')
		if (preset === 'prompts') return event.type === 'actor.io.prompt' || event.type === 'actor.io.shell'
		if (preset === 'conversation') {
			return [
				'intent.created',
				'intent.message_to_user',
				'intent.status_changed',
				'actor.io.outbound',
				'actor.io.inbound'
			].includes(event.type)
		}
		if (preset === 'skills') {
			return event.type.startsWith('intent.skill_call_') || event.type.startsWith('skill.worker_')
		}
		if (preset === 'technical') {
			return event.type.startsWith('runtime.') || event.type === 'actor.event' || event.type === 'context.appended'
		}
		return [
			'intent.created',
			'intent.message_to_user',
			'intent.status_changed',
			'intent.skill_call_started',
			'intent.skill_call_completed',
			'skill.worker_completed',
			'actor.io.prompt',
			'actor.io.shell'
		].includes(event.type) || event.type.includes('failed')
	}

	function eventHeadline(event: ActorLogRecord): string {
		const payload = payloadRecord(event.payload)
		const trace = traceRecord(event)
		switch (event.type) {
			case 'intent.created':
				return String(payload.title ?? 'Intent created')
			case 'intent.status_changed':
				return `${String(payload.title ?? 'Intent')} → ${String(payload.status ?? 'updated')}`
			case 'intent.message_to_user':
				return 'Reply to user'
			case 'intent.skill_call_started':
				return `Skill call started: ${String(payload.skillId ?? 'unknown')}`
			case 'intent.skill_call_completed':
				return `Skill call completed: ${String(payload.fromSkillId ?? payload.skillId ?? 'unknown')}`
			case 'skill.worker_completed':
				return `Worker completed: ${String(payload.workerId ?? 'unknown')}`
			case 'skill.worker_spawned':
				return `Worker spawned: ${String(payload.workerActorId ?? 'unknown')}`
			case 'actor.io.prompt':
				return `Prompt: ${String(trace.label ?? 'LLM call')}`
			case 'actor.io.shell':
				return `Shell: ${String(trace.label ?? 'command')}`
			case 'runtime.envelope.failed':
				return 'Envelope failed'
			default:
				return event.type
		}
	}

	function eventSummary(event: ActorLogRecord): string | null {
		const payload = payloadRecord(event.payload)
		const trace = traceRecord(event)
		switch (event.type) {
			case 'intent.created':
				return typeof payload.goal === 'string' ? payload.goal : null
			case 'intent.status_changed':
				return typeof payload.summary === 'string' ? payload.summary : null
			case 'intent.message_to_user':
				return typeof payload.message === 'string'
					? payload.message
					: (typeof payload.question === 'string' ? payload.question : null)
			case 'intent.skill_call_started':
				return typeof payload.request === 'string' ? payload.request : null
			case 'intent.skill_call_completed':
				return summarizeResult(payload.result)
			case 'skill.worker_completed':
				return summarizeResult(payload.result)
			case 'actor.io.prompt':
				return typeof trace.outputSummary === 'string' ? trace.outputSummary : (typeof trace.inputSummary === 'string' ? trace.inputSummary : null)
			case 'actor.io.shell':
				return typeof trace.command === 'string' ? trace.command : null
			case 'runtime.envelope.failed':
				return typeof payload.error === 'string' ? payload.error : null
			default:
				return null
		}
	}

	function shorten(text: string, max = 220): string {
		const normalized = text.replace(/\s+/g, ' ').trim()
		return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
	}

	function humanInputFromEvent(event: ActorLogRecord): string | null {
		const payload = payloadRecord(event.payload)
		const nested = payloadRecord(payload.payload)
		const userInput = payloadRecord(nested.userInput)
		for (const value of [userInput.text, nested.message, nested.question, payload.message, payload.question]) {
			if (typeof value === 'string' && value.trim()) return value
		}
		return null
	}

	function traceStepForEvent(event: ActorLogRecord): { label: string; detail?: string; tone?: 'neutral' | 'success' | 'error' } | null {
		const payload = payloadRecord(event.payload)
		const trace = traceRecord(event)
		switch (event.type) {
			case 'intent.created':
				return { label: `Intent created: ${String(payload.title ?? 'Untitled')}`, detail: typeof payload.goal === 'string' ? shorten(payload.goal, 180) : undefined }
			case 'intent.status_changed':
				return { label: `Status → ${String(payload.status ?? 'updated')}`, detail: typeof payload.summary === 'string' ? shorten(payload.summary, 160) : undefined }
			case 'intent.skill_call_started':
				return { label: `Called ${String(payload.skillId ?? 'skill')}`, detail: typeof payload.request === 'string' ? payload.request : undefined }
			case 'intent.skill_call_completed':
			case 'skill.worker_completed':
				return { label: `Completed ${String(payload.fromSkillId ?? payload.skillId ?? payload.workerId ?? 'work')}`, detail: eventSummary(event) ?? undefined, tone: 'success' }
			case 'skill.worker_spawned':
				return { label: `Spawned worker ${String(payload.workerId ?? 'unknown')}`, detail: typeof payload.skillId === 'string' ? payload.skillId : undefined }
			case 'skill.worker_routed':
				return { label: `Routed worker ${String(payload.workerId ?? 'unknown')}`, detail: typeof payload.skillId === 'string' ? payload.skillId : undefined }
			case 'actor.io.prompt':
				return { label: `LLM prompt: ${String(trace.label ?? 'prompt')}`, detail: typeof trace.outputSummary === 'string' ? shorten(trace.outputSummary, 180) : undefined }
			case 'actor.io.shell':
				return { label: 'Shell command', detail: typeof trace.command === 'string' ? shorten(trace.command, 180) : undefined }
			case 'runtime.envelope.failed':
				return { label: 'Envelope failed', detail: typeof payload.error === 'string' ? shorten(payload.error, 180) : undefined, tone: 'error' }
			default:
				return null
		}
	}

	function buildIntentTraceEntries(events: ActorLogRecord[]): IntentTraceEntry[] {
		const entries: IntentTraceEntry[] = []
		let currentAssistant: IntentTraceEntry | null = null

		for (const event of events) {
			if (event.type === 'actor.io.inbound') {
				const payload = payloadRecord(event.payload)
				if (typeof payload.toActor === 'string' && payload.toActor.startsWith('intents/')) {
					const text = humanInputFromEvent(event)
					if (text) {
						currentAssistant = null
						entries.push({
							id: `user:${event.seq}`,
							kind: 'message',
							role: 'user',
							text,
							meta: event.createdAt
						})
						continue
					}
				}
			}

		if (event.type === 'intent.message_to_user') {
			currentAssistant = {
				id: `assistant:${event.seq}`,
				kind: 'message',
				role: 'assistant',
				text: eventSummary(event) ?? eventHeadline(event),
				meta: event.createdAt,
				steps: []
			}
			entries.push(currentAssistant)
			continue
		}

		const step = traceStepForEvent(event)
		if (!step) continue

		if (!currentAssistant) {
			currentAssistant = {
				id: `trace:${event.seq}`,
				kind: 'trace',
				title: 'System trace',
				meta: event.createdAt,
				steps: []
			}
			entries.push(currentAssistant)
		}

		currentAssistant.steps = [...(currentAssistant.steps ?? []), step]
		if (currentAssistant.kind === 'trace' && !currentAssistant.text) {
			currentAssistant.text = step.detail ?? step.label
		}
		if (currentAssistant.kind === 'message' && currentAssistant.role === 'assistant' && !currentAssistant.title) {
			currentAssistant.title = 'How the reply was produced'
		}
		if (event.type === 'runtime.envelope.failed') currentAssistant = null
		if (event.type === 'intent.message_to_user') currentAssistant = currentAssistant
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'completed') currentAssistant = null
		if (event.type === 'intent.skill_call_completed' || event.type === 'skill.worker_completed') {
			// keep grouping until the eventual assistant message arrives
		}
		if (event.type === 'intent.created') currentAssistant = currentAssistant
		if (event.type === 'actor.io.prompt' || event.type === 'actor.io.shell') currentAssistant = currentAssistant
		if (event.type === 'intent.skill_call_started') currentAssistant = currentAssistant
		if (event.type === 'skill.worker_spawned' || event.type === 'skill.worker_routed') currentAssistant = currentAssistant
		if (event.type === 'intent.message_to_user') currentAssistant = entries[entries.length - 1] ?? null
		if (event.type === 'intent.created' && entries.at(-1)?.kind === 'trace') currentAssistant = entries.at(-1) ?? null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'waiting_for_user') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'completed') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'failed') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'active') currentAssistant = currentAssistant
		if (event.type === 'runtime.envelope.failed') currentAssistant = null
		if (event.type === 'intent.message_to_user') currentAssistant = null
		if (event.type === 'actor.io.inbound' && humanInputFromEvent(event)) currentAssistant = null
		if (event.type === 'intent.created') currentAssistant = currentAssistant
		if (event.type === 'intent.skill_call_started') currentAssistant = currentAssistant
		if (event.type === 'intent.skill_call_completed') currentAssistant = currentAssistant
		if (event.type === 'skill.worker_completed') currentAssistant = currentAssistant
		if (event.type === 'actor.io.prompt') currentAssistant = currentAssistant
		if (event.type === 'actor.io.shell') currentAssistant = currentAssistant
		if (event.type === 'skill.worker_spawned') currentAssistant = currentAssistant
		if (event.type === 'skill.worker_routed') currentAssistant = currentAssistant
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'waiting_for_user') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'completed') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'failed') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status === 'active') currentAssistant = currentAssistant
		if (event.type === 'runtime.envelope.failed') currentAssistant = null
		if (event.type === 'intent.message_to_user') currentAssistant = null
		if (event.type === 'actor.io.inbound' && humanInputFromEvent(event)) currentAssistant = null
		if (entries.at(-1)?.kind === 'trace' && !(entries.at(-1)?.steps?.length)) entries.pop()
		currentAssistant = entries.at(-1)?.kind === 'trace' ? (entries.at(-1) as IntentTraceEntry) : currentAssistant
		if (currentAssistant?.kind !== 'trace' && currentAssistant?.role !== 'assistant') currentAssistant = null
		if (event.type === 'intent.message_to_user') currentAssistant = null
		if (event.type === 'intent.status_changed' && payloadRecord(event.payload).status !== 'active') currentAssistant = null
		if (event.type === 'runtime.envelope.failed') currentAssistant = null
		if (event.type === 'actor.io.inbound' && humanInputFromEvent(event)) currentAssistant = null
		if (currentAssistant?.kind === 'trace' && currentAssistant.steps?.length === 0) currentAssistant = null
	}

	return entries.filter((entry) => {
		if (entry.kind === 'message') return Boolean(entry.text)
		return (entry.steps?.length ?? 0) > 0
	})
	}

	function defaultExpandedLabel(event: ActorLogRecord): string {
		switch (event.type) {
			case 'actor.io.prompt':
				return 'Prompt details'
			case 'actor.io.shell':
				return 'Shell details'
			case 'intent.skill_call_completed':
			case 'skill.worker_completed':
				return 'Result details'
			case 'runtime.envelope.failed':
				return 'Failure details'
			default:
				return 'More details'
		}
	}

	function summarizeResult(result: unknown): string | null {
		const record = payloadRecord(result)
		if (typeof record.count === 'number') return `Found ${record.count} result${record.count === 1 ? '' : 's'}`
		if (typeof record.ok === 'boolean') return record.ok ? 'Completed successfully' : 'Completed with issues'
		return null
	}

	function humanMessageText(event: ActorLogRecord): string | null {
		const payload = payloadRecord(event.payload)
		for (const key of ['message', 'question', 'summary', 'goal', 'request'] as const) {
			const value = payload[key]
			if (typeof value === 'string' && value.trim().length > 0) return value
		}
		return null
	}

	function resultItems(event: ActorLogRecord): Array<{ label: string; value: string }> {
		const result = payloadRecord(payloadRecord(event.payload).result)
		const items: Array<{ label: string; value: string }> = []
		if (typeof result.count === 'number') items.push({ label: 'Count', value: String(result.count) })
		const invoices = Array.isArray(result.invoices) ? result.invoices : []
		for (const invoice of invoices.slice(0, 3)) {
			const record = payloadRecord(invoice)
			const id = typeof record.entityId === 'string' ? record.entityId : 'unknown'
			const status = typeof record.status === 'string' ? record.status : 'unknown'
			items.push({ label: 'Invoice', value: `${id} · ${status}` })
		}
		return items
	}

	function promptPreview(event: ActorLogRecord): { input: string | null; output: string | null } {
		const trace = traceRecord(event)
		return {
			input: typeof trace.inputSummary === 'string' ? trace.inputSummary : null,
			output: typeof trace.outputSummary === 'string' ? trace.outputSummary : null
		}
	}

	function shellPreview(event: ActorLogRecord): { command: string | null; stdout: string | null; stderr: string | null; exitCode: string | null } {
		const trace = traceRecord(event)
		return {
			command: typeof trace.command === 'string' ? trace.command : null,
			stdout: typeof trace.stdout === 'string' && trace.stdout.trim().length > 0 ? trace.stdout : null,
			stderr: typeof trace.stderr === 'string' && trace.stderr.trim().length > 0 ? trace.stderr : null,
			exitCode: typeof trace.exitCode === 'number' ? String(trace.exitCode) : null
		}
	}

	function eventTone(event: ActorLogRecord): 'hero' | 'message' | 'skill' | 'trace' | 'technical' | 'error' {
		if (event.type.includes('failed') || event.type.includes('error')) return 'error'
		if (event.type === 'intent.message_to_user' || event.type === 'intent.created' || event.type === 'intent.status_changed') return 'hero'
		if (event.type.startsWith('intent.skill_call_') || event.type.startsWith('skill.worker_')) return 'skill'
		if (event.type === 'actor.io.prompt' || event.type === 'actor.io.shell') return 'trace'
		if (event.type.startsWith('runtime.') || event.type === 'actor.event' || event.type === 'context.appended') return 'technical'
		return 'message'
	}

	function isCompactEvent(event: ActorLogRecord): boolean {
		return ['runtime.envelope.queued', 'runtime.envelope.claimed', 'runtime.envelope.completed', 'actor.event', 'context.appended'].includes(event.type)
	}

	function summaryClass(event: ActorLogRecord): string {
		if (event.type === 'intent.message_to_user') return 'text-[13px] leading-5 font-medium opacity-95'
		return 'text-[12px] leading-5 opacity-78'
	}

	function displayPriority(event: ActorLogRecord): number {
		switch (event.type) {
			case 'intent.created':
				return 10
			case 'intent.status_changed':
				return 20
			case 'intent.message_to_user':
				return 30
			case 'intent.skill_call_started':
				return 40
			case 'skill.worker_spawned':
			case 'skill.worker_routed':
				return 50
			case 'actor.io.prompt':
			case 'actor.io.shell':
				return 60
			case 'intent.skill_call_completed':
			case 'skill.worker_completed':
				return 70
			case 'runtime.envelope.failed':
				return 80
			case 'actor.io.outbound':
				return 90
			case 'actor.io.inbound':
				return 100
			case 'runtime.envelope.queued':
				return 110
			case 'runtime.envelope.claimed':
				return 120
			case 'runtime.envelope.completed':
				return 130
			case 'actor.event':
				return 140
			case 'context.appended':
				return 145
			default:
				return 200
		}
	}

	onMount(() => {
		void refresh()
	})
</script>

<svelte:head>
	<title>Runtime explorer demo — AvenOS</title>
</svelte:head>

<section class="mx-auto flex min-h-0 w-full max-w-[84rem] flex-1 flex-col gap-5 overflow-hidden px-4 py-4">
	<div>
		<p class="text-[10px] font-bold uppercase tracking-[0.26em] opacity-40">Demo</p>
		<h1 class="text-xl font-semibold tracking-tight">Runtime explorer</h1>
		<p class="text-sm opacity-60">Explore the runtime through two actor-centered projections: structural hierarchy and communication hierarchy.</p>
	</div>

	{#if error}
		<p class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
	{/if}

	<div class="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]">
		<section class="flex h-[36rem] min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-border/60 bg-white/40 p-4">
			<div class="mb-4 flex items-center justify-between gap-3">
				<div>
					<h2 class="mb-1 text-base font-semibold">Actor explorer</h2>
					<p class="text-xs opacity-60">Both projections use lazy loading. Expand nodes to fetch the next level only.</p>
				</div>
				<button class="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onclick={() => void refresh()} disabled={loading}>
					{loading ? 'Loading…' : 'Refresh'}
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overflow-x-auto rounded-xl border border-border/50 bg-white/35 p-2">
			<ul class="m-0 p-0">
				{#each tree as item (item.id)}
					<RuntimeTreeNode {item} {onSelect} {onToggle} />
				{/each}
			</ul>
			</div>
		</section>

		<section class="flex h-[36rem] min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-border/60 bg-white/40 p-4">
			<div class="mb-3 flex items-center justify-between gap-3">
				<h2 class="text-base font-semibold">Details</h2>
				<button
					type="button"
					class="rounded-lg border border-border/70 bg-white/80 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
					onclick={() => void refreshSelectedDetails()}
					disabled={!selectedItem || selectedItem.kind === 'root'}
				>
					Refresh details
				</button>
			</div>
			{#if selectedItem}
				<div class="min-h-0 flex flex-1 flex-col space-y-4 overflow-hidden">
					<div>
						<div class="font-mono text-xs opacity-60">{selectedItem.projection ?? 'root'} / {selectedItem.kind}</div>
						<div class="text-sm font-semibold break-all">{selectedItem.title}</div>
						{#if selectedItem.subtitle}
							<div class="text-xs opacity-60">{selectedItem.subtitle}</div>
						{/if}
					</div>

					{#if selectedItem.kind === 'actor'}
						<p class="text-xs opacity-60">Showing the selected actor’s aggregated log stream.</p>
						<div class="flex flex-wrap gap-2">
							<button type="button" class:preset-active={activePreset === 'overview'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'overview'; activeLogType = null }}>Overview <span class="opacity-60">({presetCounts.overview})</span></button>
							<button type="button" class:preset-active={activePreset === 'conversation'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'conversation'; activeLogType = null }}>Conversation <span class="opacity-60">({presetCounts.conversation})</span></button>
							<button type="button" class:preset-active={activePreset === 'prompts'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'prompts'; activeLogType = null }}>Prompts & shell <span class="opacity-60">({presetCounts.prompts})</span></button>
							<button type="button" class:preset-active={activePreset === 'skills'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'skills'; activeLogType = null }}>Skill work <span class="opacity-60">({presetCounts.skills})</span></button>
							<button type="button" class:preset-active={activePreset === 'technical'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'technical'; activeLogType = null }}>Technical <span class="opacity-60">({presetCounts.technical})</span></button>
							<button type="button" class:preset-active={activePreset === 'errors'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'errors'; activeLogType = null }}>Errors <span class="opacity-60">({presetCounts.errors})</span></button>
							<button type="button" class:preset-active={activePreset === 'raw'} class="preset-chip rounded-full border px-3 py-1 text-xs font-medium" onclick={() => { activePreset = 'raw'; activeLogType = null }}>Raw <span class="opacity-60">({presetCounts.raw})</span></button>
						</div>
						{#if availableLogTypes.length > 0}
							<div class="flex flex-wrap gap-2">
								<button
									type="button"
									class:chip-active={activeLogType === null}
									class="log-chip rounded-full border px-3 py-1 text-xs font-medium"
									onclick={() => (activeLogType = null)}
								>
									All <span class="opacity-60">({detailLogs.length})</span>
								</button>
								{#each availableLogTypes as type (type)}
									<button
										type="button"
										class:chip-active={activeLogType === type}
										class="log-chip rounded-full border px-3 py-1 text-xs font-medium"
										onclick={() => (activeLogType = type)}
									>
										{type}
										<span class="opacity-60">
											({detailLogs.filter((event) => event.type === type).length})
										</span>
									</button>
								{/each}
							</div>
						{/if}
						<div class="min-h-0 flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
							{#each displayedDetailLogs as event (event.id + ':' + event.seq)}
								{@const side = bubbleSide(event)}
								{@const tone = eventTone(event)}
								{@const headline = eventHeadline(event)}
								{@const summary = eventSummary(event)}
								{@const metaItems = compactMetaItems(event)}
								<div class="flex">
									<article class:incoming={side === 'left'} class:outgoing={side === 'right'} class:neutral={side === 'center'} class:hero-card={tone === 'hero'} class:skill-card={tone === 'skill'} class:trace-card={tone === 'trace'} class:technical-card={tone === 'technical'} class:error-card={tone === 'error'} class:compact-card={isCompactEvent(event)} class="log-bubble w-full max-w-[48rem] rounded-xl border px-3 py-2 shadow-sm">
										<div class="mb-1.5 flex items-center justify-between gap-3 text-[10px] opacity-65">
											<div class="flex items-center gap-2">
												<span class:flow-incoming={side === 'left'} class:flow-outgoing={side === 'right'} class:flow-internal={side === 'center'} class="flow-pill rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">{sideLabel(side)}</span>
												<span class="font-mono">#{event.seq} · {event.type}</span>
											</div>
											<span>{event.createdAt}</span>
										</div>
										<div class="mb-1 flex items-center gap-2">
											<div class="text-sm font-semibold leading-5">{headline}</div>
											{#if tone === 'technical'}
												<span aria-hidden="true" class="size-2 rounded-full bg-slate-400/60"></span>
											{/if}
										</div>
										{#if summary}
											<p class={`mb-1.5 ${summaryClass(event)}`}>{summary}</p>
										{/if}
										{#if metaItems.length > 0}
											<div class="flex flex-wrap items-center gap-1.5 text-[11px]">
												{#each metaItems as item (`${item.label}:${item.value}`)}
													<span class="rounded-full bg-black/5 px-2 py-0.5 font-medium">{item.label}: {item.value}</span>
												{/each}
											</div>
										{/if}
										{#if hasExpandedInsight(event)}
											<details class="group mt-1.5">
												<summary class="cursor-pointer text-[11px] font-medium opacity-55 transition-opacity hover:opacity-80">{defaultExpandedLabel(event)}</summary>
												<div class="mt-2 space-y-2">
													<EventRenderer {event} />
													<details class="group">
														<summary class="cursor-pointer text-[11px] opacity-55 transition-opacity hover:opacity-80">Raw payload</summary>
														<pre class="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-xs">{pretty(event.payload)}</pre>
													</details>
												</div>
											</details>
										{/if}
									</article>
								</div>
							{/each}
							{#if filteredDetailLogs.length === 0}
								<p class="text-sm opacity-60">No logs found for this actor yet.</p>
							{/if}
						</div>
					{:else if selectedItem.kind === 'intent' || selectedItem.kind === 'conversation'}
						<div class="min-h-0 flex flex-1 flex-col overflow-y-auto pr-1">
							<div class="mb-3 text-xs opacity-60">
								{#if selectedItem.kind === 'conversation'}
									Sub-conversation from the selected node downward.
								{:else}
									Chat-like trace of the selected intent: user input → orchestration → tools/workers → reply.
								{/if}
							</div>
							<div class="flex flex-col gap-3">
								{#each visibleIntentTraceEntries() as entry (entry.id)}
									{#if entry.kind === 'message'}
										<div class:justify-end={entry.role === 'user'} class="flex">
											<div class:chat-user={entry.role === 'user'} class:chat-assistant={entry.role === 'assistant'} class="chat-bubble max-w-[42rem] rounded-2xl px-4 py-3 shadow-sm">
												<div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-55">{entry.role === 'user' ? 'User' : 'Assistant'}</div>
												<div class="whitespace-pre-wrap text-[13px] leading-6">{entry.text}</div>
												{#if entry.steps && entry.steps.length > 0}
													<details class="mt-2 rounded-xl bg-black/5 px-3 py-2">
														<summary class="cursor-pointer text-[11px] font-medium opacity-70">Trace behind this reply</summary>
														<div class="mt-2 space-y-2">
															{#each entry.steps as step, index (`${entry.id}:${index}`)}
																<div class="trace-step">
																	<div class="text-[11px] font-medium">{step.label}</div>
																	{#if step.detail}
																		<div class="mt-0.5 text-[11px] opacity-70">{step.detail}</div>
																	{/if}
																</div>
															{/each}
														</div>
													</details>
												{/if}
												{#if entry.meta}
													<div class="mt-2 text-[10px] opacity-45">{entry.meta}</div>
												{/if}
											</div>
										</div>
									{:else}
										<div class="rounded-2xl border border-dashed border-border/60 bg-white/55 px-4 py-3">
											<div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-55">System trace</div>
											<div class="space-y-2">
												{#each entry.steps ?? [] as step, index (`${entry.id}:${index}`)}
													<div class="trace-step">
														<div class="text-[11px] font-medium">{step.label}</div>
														{#if step.detail}
															<div class="mt-0.5 text-[11px] opacity-70">{step.detail}</div>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/if}
								{/each}
								{#if intentTraceEntries.length === 0}
									<p class="text-sm opacity-60">No readable conversation trace found for this intent yet.</p>
								{/if}
							</div>
						</div>
					{:else}
						<pre class="min-h-0 flex-1 overflow-auto rounded-xl border border-border/50 bg-black/85 p-3 text-xs text-white whitespace-pre-wrap break-words">{pretty(selectedItem.payload)}</pre>
					{/if}
				</div>
			{:else}
				<p class="text-sm opacity-60">Select any node to inspect its metadata. Selecting an actor also opens its log stream.</p>
			{/if}
		</section>
	</div>
</section>

<style>
	.log-bubble {
		border-color: rgb(203 213 225 / 0.85);
		background: rgb(255 255 255 / 0.78);
	}

	.log-bubble.incoming {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.95), rgb(239 246 255 / 0.88));
	}

	.log-bubble.outgoing {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.96), rgb(236 253 245 / 0.9));
	}

	.log-bubble.neutral {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.92), rgb(248 250 252 / 0.88));
	}

	.log-chip {
		border-color: rgb(203 213 225 / 0.9);
		background: rgb(255 255 255 / 0.72);
	}

	.log-chip:hover {
		background: rgb(255 255 255 / 0.92);
	}

	.log-chip.chip-active {
		border-color: rgb(15 23 42 / 0.25);
		background: rgb(15 23 42 / 0.08);
		color: rgb(15 23 42);
	}

	.preset-chip {
		border-color: rgb(191 219 254 / 0.9);
		background: rgb(239 246 255 / 0.75);
	}

	.preset-chip:hover {
		background: rgb(219 234 254 / 0.9);
	}

	.preset-chip.preset-active {
		border-color: rgb(37 99 235 / 0.35);
		background: linear-gradient(180deg, rgb(239 246 255 / 0.98), rgb(219 234 254 / 0.95));
		color: rgb(30 64 175);
	}

	.log-bubble.hero-card {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.98), rgb(239 246 255 / 0.92));
		border-color: rgb(147 197 253 / 0.75);
	}

	.log-bubble.skill-card {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.98), rgb(236 253 245 / 0.94));
		border-color: rgb(134 239 172 / 0.7);
	}

	.log-bubble.trace-card {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.97), rgb(245 243 255 / 0.93));
		border-color: rgb(196 181 253 / 0.75);
	}

	.log-bubble.technical-card {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.92), rgb(248 250 252 / 0.9));
		border-color: rgb(203 213 225 / 0.85);
	}

	.log-bubble.error-card {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.98), rgb(254 242 242 / 0.95));
		border-color: rgb(252 165 165 / 0.8);
	}

	.log-bubble.compact-card {
		padding-top: 0.55rem;
		padding-bottom: 0.55rem;
	}

	.chat-bubble {
		border: 1px solid rgb(203 213 225 / 0.75);
		background: rgb(255 255 255 / 0.9);
	}

	.chat-bubble.chat-user {
		background: linear-gradient(180deg, rgb(37 99 235 / 0.95), rgb(29 78 216 / 0.94));
		border-color: rgb(59 130 246 / 0.8);
		color: white;
	}

	.chat-bubble.chat-assistant {
		background: linear-gradient(180deg, rgb(255 255 255 / 0.98), rgb(248 250 252 / 0.95));
	}

	.trace-step {
		border-left: 2px solid rgb(148 163 184 / 0.45);
		padding-left: 0.75rem;
	}

	.flow-pill {
		background: rgb(15 23 42 / 0.07);
		color: rgb(51 65 85);
	}

	.flow-pill.flow-incoming {
		background: rgb(219 234 254 / 0.9);
		color: rgb(30 64 175);
	}

	.flow-pill.flow-outgoing {
		background: rgb(220 252 231 / 0.95);
		color: rgb(22 101 52);
	}

	.flow-pill.flow-internal {
		background: rgb(241 245 249 / 0.95);
		color: rgb(71 85 105);
	}
</style>