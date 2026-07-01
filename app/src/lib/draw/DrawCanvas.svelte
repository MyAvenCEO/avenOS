<script lang="ts">
// Board 0060 — Apple Pencil scratchpad canvas. Thin renderer over the pure
// `sketch-model`: pointer/pen samples go in, `SketchState` is painted out. One big
// viewport-filling canvas; in-memory only (strokes reset on reload). Tools: pen,
// eraser (whole-stroke on touch), basic rect-select (drag to select; drag a selected
// stroke to move it). No persistence, no infinite pan/zoom — deliberately minimal.
import { t } from '$lib/i18n'
import {
	addStroke,
	clearSelection,
	createSketch,
	eraseAt,
	moveSelection,
	type Point,
	pointNearStroke,
	type Rect,
	type Stroke,
	selectInRect
} from './sketch-model'

type Tool = 'pen' | 'eraser' | 'select'

const PEN_WIDTH = 3
const ERASE_RADIUS = 12
const HIT_TOL = 8

let tool = $state<Tool>('pen')

let canvas = $state<HTMLCanvasElement | null>(null)
// The model is intentionally NOT $state — we mutate it directly and schedule a redraw,
// which avoids proxying every point on high-frequency pen samples.
const sketch = createSketch()

let dpr = 1
let ctx: CanvasRenderingContext2D | null = null
let rafPending = false

// Active gesture bookkeeping (null between gestures).
let drawing: Stroke | null = null // pen: the stroke being extended
let selRect: Rect | null = null // select: the drag rectangle
let moving: { last: Point } | null = null // select: dragging a selection
let activePointer: number | null = null

function scheduleRender() {
	if (rafPending) return
	rafPending = true
	requestAnimationFrame(() => {
		rafPending = false
		render()
	})
}

function pointFrom(e: PointerEvent): Point {
	const rect = canvas?.getBoundingClientRect()
	const x = e.clientX - (rect?.left ?? 0)
	const y = e.clientY - (rect?.top ?? 0)
	// pressure is 0 for mouse / when unsupported; the renderer falls back to a flat width.
	return { x, y, pressure: e.pressure > 0 ? e.pressure : undefined }
}

function resize() {
	if (!canvas) return
	const rect = canvas.getBoundingClientRect()
	dpr = window.devicePixelRatio || 1
	canvas.width = Math.max(1, Math.round(rect.width * dpr))
	canvas.height = Math.max(1, Math.round(rect.height * dpr))
	ctx = canvas.getContext('2d')
	render()
}

function strokeWidthAt(base: number, pressure?: number): number {
	if (pressure === undefined) return base
	return base * (0.4 + 1.2 * pressure)
}

function paintStroke(c: CanvasRenderingContext2D, stroke: Stroke, selected: boolean) {
	const pts = stroke.points
	if (pts.length === 0) return
	c.strokeStyle = stroke.color
	c.lineCap = 'round'
	c.lineJoin = 'round'
	if (pts.length === 1) {
		c.beginPath()
		c.arc(pts[0].x, pts[0].y, strokeWidthAt(stroke.width, pts[0].pressure) / 2, 0, Math.PI * 2)
		c.fillStyle = stroke.color
		c.fill()
	} else {
		// Segment-by-segment so per-point pressure can vary the width.
		for (let i = 1; i < pts.length; i++) {
			c.beginPath()
			c.lineWidth = strokeWidthAt(stroke.width, pts[i].pressure)
			c.moveTo(pts[i - 1].x, pts[i - 1].y)
			c.lineTo(pts[i].x, pts[i].y)
			c.stroke()
		}
	}
	if (selected) {
		const b = boundsOf(stroke)
		c.save()
		c.strokeStyle = 'rgba(99,102,241,0.9)'
		c.lineWidth = 1
		c.setLineDash([4, 3])
		c.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8)
		c.restore()
	}
}

function boundsOf(stroke: Stroke): Rect {
	const p0 = stroke.points[0]
	let minX = p0.x
	let minY = p0.y
	let maxX = p0.x
	let maxY = p0.y
	for (const p of stroke.points) {
		minX = Math.min(minX, p.x)
		minY = Math.min(minY, p.y)
		maxX = Math.max(maxX, p.x)
		maxY = Math.max(maxY, p.y)
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function render() {
	if (!canvas || !ctx) return
	const c = ctx
	c.save()
	c.setTransform(dpr, 0, 0, dpr, 0, 0)
	c.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
	for (const stroke of sketch.strokes) paintStroke(c, stroke, sketch.selectedIds.has(stroke.id))
	if (selRect) {
		c.strokeStyle = 'rgba(99,102,241,0.9)'
		c.fillStyle = 'rgba(99,102,241,0.08)'
		c.lineWidth = 1
		c.setLineDash([4, 3])
		c.fillRect(selRect.x, selRect.y, selRect.w, selRect.h)
		c.strokeRect(selRect.x, selRect.y, selRect.w, selRect.h)
		c.setLineDash([])
	}
	c.restore()
}

function onPointerDown(e: PointerEvent) {
	if (activePointer !== null) return
	activePointer = e.pointerId
	canvas?.setPointerCapture(e.pointerId)
	const p = pointFrom(e)
	if (tool === 'pen') {
		drawing = { id: crypto.randomUUID(), points: [p], color: '#111827', width: PEN_WIDTH }
		addStroke(sketch, drawing)
	} else if (tool === 'eraser') {
		eraseAt(sketch, p, ERASE_RADIUS)
	} else {
		// select: if the press lands on an already-selected stroke, drag to move; else
		// start a fresh selection rectangle.
		const onSelected = sketch.strokes.some(
			(s) => sketch.selectedIds.has(s.id) && pointNearStroke(s, p, HIT_TOL)
		)
		if (onSelected) {
			moving = { last: p }
		} else {
			clearSelection(sketch)
			selRect = { x: p.x, y: p.y, w: 0, h: 0 }
		}
	}
	scheduleRender()
}

function onPointerMove(e: PointerEvent) {
	if (e.pointerId !== activePointer) return
	if (tool === 'pen' && drawing) {
		const samples = e.getCoalescedEvents?.() ?? [e]
		for (const s of samples) drawing.points.push(pointFrom(s))
	} else if (tool === 'eraser') {
		eraseAt(sketch, pointFrom(e), ERASE_RADIUS)
	} else if (moving) {
		const p = pointFrom(e)
		moveSelection(sketch, p.x - moving.last.x, p.y - moving.last.y)
		moving.last = p
	} else if (selRect) {
		const p = pointFrom(e)
		selRect.w = p.x - selRect.x
		selRect.h = p.y - selRect.y
	}
	scheduleRender()
}

function endGesture(e: PointerEvent) {
	if (e.pointerId !== activePointer) return
	if (tool === 'select' && selRect) selectInRect(sketch, selRect)
	drawing = null
	selRect = null
	moving = null
	activePointer = null
	scheduleRender()
}

function clearAll() {
	sketch.strokes = []
	clearSelection(sketch)
	scheduleRender()
}

$effect(() => {
	resize()
	const onResize = () => resize()
	window.addEventListener('resize', onResize)
	return () => window.removeEventListener('resize', onResize)
})

const tools: { id: Tool; label: string }[] = [
	{ id: 'pen', label: t('draw.pen') },
	{ id: 'eraser', label: t('draw.eraser') },
	{ id: 'select', label: t('draw.select') }
]
</script>

<div class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
	<canvas
		bind:this={canvas}
		class="absolute inset-0 h-full w-full touch-none"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={endGesture}
		onpointercancel={endGesture}
	></canvas>

	<div
		class="border-border bg-background/95 absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border p-1 shadow-md backdrop-blur-sm"
		role="toolbar"
		aria-label={t('draw.tools')}
	>
		{#each tools as item (item.id)}
			<button
				type="button"
				class="rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors {tool ===
				item.id
					? 'bg-primary text-primary-foreground'
					: 'text-foreground hover:bg-foreground/10'}"
				aria-pressed={tool === item.id}
				onclick={() => (tool = item.id)}
			>
				{item.label}
			</button>
		{/each}
		<span class="bg-border mx-1 h-4 w-px" aria-hidden="true"></span>
		<button
			type="button"
			class="text-foreground hover:bg-foreground/10 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors"
			onclick={clearAll}
		>
			{t('draw.clear')}
		</button>
	</div>
</div>
