/**
 * Reactive, app-wide state for the POS ingestor — shared by the Orders, Order Table,
 * and Ingest (flow debug) views. Holds the imported orders plus a live picture of the
 * pipeline: per-stage status/timing and a structured log stream. One ingestor instance
 * is created up-front and reused, so re-importing the same file is idempotent.
 */

import {
	INGEST_STAGES,
	type IngestReport,
	type Logger
} from '../../../../libs/aven-skills/src/index'
import type { Order } from '../../routes/avens/[projectId]/[identityId]/orders/orders-data'
import { createOrdersIngestor } from './victorio-orders'

export type StageStatus = 'pending' | 'running' | 'done' | 'error'

export interface StageNode {
	name: string
	status: StageStatus
	durationMs?: number
	detail?: string
}

export interface LogEntry {
	seq: number
	level: string
	stage: string
	message: string
	data?: unknown
}

function freshStages(): StageNode[] {
	return INGEST_STAGES.map((name) => ({ name, status: 'pending' as StageStatus }))
}

// --- reactive state ---------------------------------------------------------
let orders = $state<Order[]>([])
let stages = $state<StageNode[]>(freshStages())
let logs = $state<LogEntry[]>([])
let report = $state<IngestReport | null>(null)
let importing = $state(false)
let errorMsg = $state<string | null>(null)
let fileName = $state<string | null>(null)
let lastDuplicate = $state(false)
let logSeq = 0

// Logger + stage events mutate the reactive state above; the ingestor is created once.
const logger: Logger = {
	log(level, stage, message, data) {
		// 'start'/'done' lifecycle is handled by onStageEvent — keep the log stream signal-rich.
		if (message === 'start' || message === 'done') return
		logs.push({ seq: logSeq++, level, stage, message, data })
		const node = stages.find((s) => s.name === stage)
		if (node && level === 'info') node.detail = message
	}
}

const ingestor = createOrdersIngestor({
	logger,
	yield: () => new Promise((r) => setTimeout(r, 0)),
	onStageEvent: (e) => {
		const node = stages.find((s) => s.name === e.stage)
		if (!node) return
		if (e.phase === 'start') {
			node.status = 'running'
		} else if (e.phase === 'done') {
			node.status = 'done'
			node.durationMs = e.durationMs
		} else {
			node.status = 'error'
			node.durationMs = e.durationMs
			node.detail = e.error
		}
	}
})

async function runImport(file: File): Promise<void> {
	importing = true
	errorMsg = null
	lastDuplicate = false
	fileName = file.name
	stages = freshStages()
	logs = []
	logSeq = 0
	try {
		const bytes = new Uint8Array(await file.arrayBuffer())
		const r = await ingestor.ingest({
			filename: file.name,
			mimeType: file.type || 'text/csv',
			bytes
		})
		report = r
		lastDuplicate = r.duplicateFile
		orders = r.output.orders as unknown as Order[]
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : String(e)
		const running = stages.find((s) => s.status === 'running')
		if (running) running.status = 'error'
	} finally {
		importing = false
	}
}

function reset(): void {
	orders = []
	stages = freshStages()
	logs = []
	report = null
	errorMsg = null
	fileName = null
	lastDuplicate = false
	logSeq = 0
}

/** Per-target `{ added, skipped }` from the latest report, as a flat list. */
function perTargetStats(): { target: string; added: number; skipped: number }[] {
	if (!report) return []
	return Object.entries(report.stats).map(([target, s]) => ({ target, ...s }))
}

export const ordersFlow = {
	get orders() {
		return orders
	},
	get stages() {
		return stages
	},
	get logs() {
		return logs
	},
	get report() {
		return report
	},
	get importing() {
		return importing
	},
	get error() {
		return errorMsg
	},
	get fileName() {
		return fileName
	},
	get duplicate() {
		return lastDuplicate
	},
	get hasImport() {
		return report !== null
	},
	get orderCount() {
		return orders.length
	},
	get lineCount() {
		let n = 0
		for (const o of orders) n += o.lines.length
		return n
	},
	get stats() {
		return perTargetStats()
	},
	runImport,
	reset
}
