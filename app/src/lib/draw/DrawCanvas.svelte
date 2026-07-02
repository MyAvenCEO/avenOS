<script lang="ts">
// Board 0060/0061 — Apple Pencil scratchpad canvas. Thin renderer over the pure
// `sketch-model`: pointer/pen samples go in (mapped to WORLD coords through the
// viewport), `SketchState` is painted out. In-memory only (resets on reload).
//
// Tools: pen (any pointer — pencil/finger/mouse; pick a colour), eraser (whole-stroke),
// select (drag to marquee; drag a selected stroke/image to move; drag an image's corner
// handles to resize). Add-image drops a reference image you can move/scale — trace or
// paint over it. Bounded zoom (0.2×–10×): pinch, wheel, or the −/＋/reset buttons; two
// fingers pan. No persistence.
import { t } from '$lib/i18n'
import {
	addImage,
	addStroke,
	clearSelection,
	createSketch,
	deleteSelection,
	eraseAt,
	type HandleId,
	imageAt,
	imageHandleAt,
	imageHandles,
	MIN_SCALE,
	moveSelection,
	type Point,
	pointNearStroke,
	type Rect,
	resizeImageByHandle,
	type SketchImage,
	type Stroke,
	screenToWorld,
	selectInRect,
	setSelection,
	type Viewport,
	worldToScreen,
	zoomAround
} from './sketch-model'

type Tool = 'pen' | 'eraser' | 'select'

// Screen-constant sizes (divided by the live scale to get world units).
const PEN_WIDTH = 3
const ERASE_RADIUS = 12
const HIT_TOL = 8
const HANDLE_HIT = 12
const HANDLE_SIZE = 9

const COLORS = [
	'#111827',
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#3b82f6',
	'#a855f7',
	'#ffffff'
]

let tool = $state<Tool>('pen')
let penColor = $state(COLORS[0])
let zoomPct = $state(100)

let canvas = $state<HTMLCanvasElement | null>(null)
let fileInput = $state<HTMLInputElement | null>(null)

// The model + viewport are intentionally NOT $state — they mutate on every high-frequency
// pointer/pinch sample and we schedule a redraw explicitly (no proxy overhead per point).
const sketch = createSketch()
const vp: Viewport = { scale: 1, tx: 0, ty: 0 }
// Decoded <img> elements keyed by SketchImage id (the model only holds the data URL).
const imgEls = new Map<string, HTMLImageElement>()

let dpr = 1
let ctx: CanvasRenderingContext2D | null = null
let rafPending = false

// Active pointers (screen coords, relative to the canvas). Two = pinch/pan.
const pointers = new Map<number, { x: number; y: number }>()
let primaryId: number | null = null

// Single-pointer gesture in flight (null between gestures).
type Gesture =
	| { kind: 'pen'; stroke: Stroke }
	| { kind: 'erase' }
	| { kind: 'resize'; img: SketchImage; handle: HandleId }
	| { kind: 'move'; last: Point }
	| { kind: 'marquee'; rect: Rect }
	| null
let gesture: Gesture = null

// Two-finger pinch baseline (screen coords + the viewport when it began).
let pinch: { startDist: number; startMid: { x: number; y: number }; startVp: Viewport } | null =
	null

function scheduleRender() {
	if (rafPending) return
	rafPending = true
	requestAnimationFrame(() => {
		rafPending = false
		render()
	})
}

function screenPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
	const r = canvas?.getBoundingClientRect()
	return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

/** Pointer → world point (through the viewport), carrying pen pressure. */
function worldPoint(e: PointerEvent): Point {
	const sp = screenPoint(e)
	const w = screenToWorld(vp, sp.x, sp.y)
	return { x: w.x, y: w.y, pressure: e.pressure > 0 ? e.pressure : undefined }
}

function setScale(next: Viewport) {
	vp.scale = next.scale
	vp.tx = next.tx
	vp.ty = next.ty
	zoomPct = Math.round(vp.scale * 100)
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

function paintStroke(c: CanvasRenderingContext2D, stroke: Stroke, selected: boolean, inv: number) {
	const pts = stroke.points
	if (pts.length === 0) return
	c.strokeStyle = stroke.color
	c.fillStyle = stroke.color
	c.lineCap = 'round'
	c.lineJoin = 'round'
	if (pts.length === 1) {
		c.beginPath()
		c.arc(pts[0].x, pts[0].y, strokeWidthAt(stroke.width, pts[0].pressure) / 2, 0, Math.PI * 2)
		c.fill()
	} else {
		for (let i = 1; i < pts.length; i++) {
			c.beginPath()
			c.lineWidth = strokeWidthAt(stroke.width, pts[i].pressure)
			c.moveTo(pts[i - 1].x, pts[i - 1].y)
			c.lineTo(pts[i].x, pts[i].y)
			c.stroke()
		}
	}
	if (selected) {
		const b = strokeBoundsLocal(stroke)
		c.save()
		c.strokeStyle = 'rgba(99,102,241,0.9)'
		c.lineWidth = 1.5 * inv
		c.setLineDash([4 * inv, 3 * inv])
		c.strokeRect(b.x - 4 * inv, b.y - 4 * inv, b.w + 8 * inv, b.h + 8 * inv)
		c.restore()
	}
}

function strokeBoundsLocal(stroke: Stroke): Rect {
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
	const inv = 1 / vp.scale
	c.setTransform(dpr, 0, 0, dpr, 0, 0)
	c.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

	// World content (images behind, strokes on top).
	c.save()
	c.translate(vp.tx, vp.ty)
	c.scale(vp.scale, vp.scale)
	for (const img of sketch.images) {
		const el = imgEls.get(img.id)
		if (el?.complete && el.naturalWidth > 0) c.drawImage(el, img.x, img.y, img.w, img.h)
		else {
			c.fillStyle = 'rgba(0,0,0,0.06)'
			c.fillRect(img.x, img.y, img.w, img.h)
		}
	}
	for (const stroke of sketch.strokes) {
		paintStroke(c, stroke, sketch.selectedIds.has(stroke.id), inv)
	}
	if (gesture?.kind === 'marquee') {
		const r = gesture.rect
		c.strokeStyle = 'rgba(99,102,241,0.9)'
		c.fillStyle = 'rgba(99,102,241,0.08)'
		c.lineWidth = inv
		c.setLineDash([4 * inv, 3 * inv])
		c.fillRect(r.x, r.y, r.w, r.h)
		c.strokeRect(r.x, r.y, r.w, r.h)
		c.setLineDash([])
	}
	c.restore()

	// Screen-space overlay: image selection outline + constant-size corner handles.
	for (const img of sketch.images) {
		if (!sketch.selectedIds.has(img.id)) continue
		const tl = worldToScreen(vp, img.x, img.y)
		const br = worldToScreen(vp, img.x + img.w, img.y + img.h)
		c.strokeStyle = 'rgba(99,102,241,0.95)'
		c.lineWidth = 1.5
		c.setLineDash([5, 3])
		c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
		c.setLineDash([])
		for (const h of imageHandles(img)) {
			const s = worldToScreen(vp, h.x, h.y)
			c.fillStyle = '#fff'
			c.strokeStyle = 'rgba(99,102,241,0.95)'
			c.lineWidth = 1.5
			c.fillRect(s.x - HANDLE_SIZE / 2, s.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
			c.strokeRect(s.x - HANDLE_SIZE / 2, s.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
		}
	}
}

function beginGesture(e: PointerEvent) {
	const p = worldPoint(e)
	const inv = 1 / vp.scale
	if (tool === 'pen') {
		const stroke: Stroke = {
			id: crypto.randomUUID(),
			points: [p],
			color: penColor,
			width: PEN_WIDTH * inv
		}
		addStroke(sketch, stroke)
		gesture = { kind: 'pen', stroke }
	} else if (tool === 'eraser') {
		eraseAt(sketch, p, ERASE_RADIUS * inv)
		gesture = { kind: 'erase' }
	} else {
		// select — handle > image body > selected stroke > marquee.
		const selImg = sketch.images.find((im) => sketch.selectedIds.has(im.id))
		const handle = selImg ? imageHandleAt(selImg, p, HANDLE_HIT * inv) : null
		if (selImg && handle) {
			gesture = { kind: 'resize', img: selImg, handle }
			return
		}
		const hitImg = imageAt(sketch, p)
		if (hitImg) {
			setSelection(sketch, [hitImg.id])
			gesture = { kind: 'move', last: p }
			return
		}
		const hitStroke = sketch.strokes.find(
			(s) => sketch.selectedIds.has(s.id) && pointNearStroke(s, p, HIT_TOL * inv)
		)
		if (hitStroke) {
			gesture = { kind: 'move', last: p }
			return
		}
		clearSelection(sketch)
		gesture = { kind: 'marquee', rect: { x: p.x, y: p.y, w: 0, h: 0 } }
	}
}

function onPointerDown(e: PointerEvent) {
	const sp = screenPoint(e)
	pointers.set(e.pointerId, sp)
	canvas?.setPointerCapture(e.pointerId)

	if (pointers.size === 1) {
		primaryId = e.pointerId
		beginGesture(e)
	} else if (pointers.size === 2) {
		// Second finger down → cancel any in-flight single gesture (drop a stray pen stroke)
		// and start pinch/pan.
		if (gesture?.kind === 'pen') {
			const stray = gesture.stroke
			sketch.strokes = sketch.strokes.filter((s) => s !== stray)
		}
		gesture = null
		primaryId = null
		const pts = [...pointers.values()]
		const startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
		const startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
		pinch = { startDist, startMid, startVp: { ...vp } }
	}
	scheduleRender()
}

function onPointerMove(e: PointerEvent) {
	if (!pointers.has(e.pointerId)) return
	pointers.set(e.pointerId, screenPoint(e))

	if (pinch && pointers.size >= 2) {
		const pts = [...pointers.values()]
		const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
		const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
		const zed = zoomAround(
			pinch.startVp,
			pinch.startMid.x,
			pinch.startMid.y,
			pinch.startVp.scale * (dist / pinch.startDist)
		)
		setScale({
			scale: zed.scale,
			tx: zed.tx + (mid.x - pinch.startMid.x),
			ty: zed.ty + (mid.y - pinch.startMid.y)
		})
		scheduleRender()
		return
	}

	if (e.pointerId !== primaryId || !gesture) return
	const inv = 1 / vp.scale
	if (gesture.kind === 'pen') {
		const samples = e.getCoalescedEvents?.() ?? [e]
		for (const s of samples) gesture.stroke.points.push(worldPoint(s))
	} else if (gesture.kind === 'erase') {
		eraseAt(sketch, worldPoint(e), ERASE_RADIUS * inv)
	} else if (gesture.kind === 'resize') {
		resizeImageByHandle(gesture.img, gesture.handle, worldPoint(e))
	} else if (gesture.kind === 'move') {
		const p = worldPoint(e)
		moveSelection(sketch, p.x - gesture.last.x, p.y - gesture.last.y)
		gesture.last = p
	} else {
		const p = worldPoint(e)
		gesture.rect.w = p.x - gesture.rect.x
		gesture.rect.h = p.y - gesture.rect.y
	}
	scheduleRender()
}

function endPointer(e: PointerEvent) {
	pointers.delete(e.pointerId)

	if (pinch) {
		// Stay in pinch until ALL fingers lift, so a lingering finger doesn't start drawing.
		if (pointers.size === 0) pinch = null
		scheduleRender()
		return
	}

	if (e.pointerId === primaryId) {
		if (gesture?.kind === 'marquee') selectInRect(sketch, gesture.rect)
		gesture = null
		primaryId = null
	}
	scheduleRender()
}

function zoomByFactor(f: number) {
	if (!canvas) return
	setScale(zoomAround(vp, canvas.clientWidth / 2, canvas.clientHeight / 2, vp.scale * f))
	scheduleRender()
}

function resetView() {
	setScale({ scale: 1, tx: 0, ty: 0 })
	scheduleRender()
}

function onWheel(e: WheelEvent) {
	e.preventDefault()
	const sp = screenPoint(e)
	const f = e.deltaY < 0 ? 1.1 : 1 / 1.1
	setScale(zoomAround(vp, sp.x, sp.y, vp.scale * f))
	scheduleRender()
}

function onKey(e: KeyboardEvent) {
	if ((e.key === 'Delete' || e.key === 'Backspace') && sketch.selectedIds.size > 0) {
		deleteSelection(sketch)
		scheduleRender()
	}
}

function loadImageFile(file: File) {
	const reader = new FileReader()
	reader.onload = () => {
		const src = reader.result
		if (typeof src !== 'string' || !canvas) return
		const el = new Image()
		el.onload = () => {
			if (!canvas) return
			const cssW = canvas.clientWidth
			const cssH = canvas.clientHeight
			// Fit ~60% of the current viewport (in world units); never upscale past natural size.
			const maxW = (cssW * 0.6) / vp.scale
			const maxH = (cssH * 0.6) / vp.scale
			const k = Math.min(maxW / el.naturalWidth, maxH / el.naturalHeight, 1)
			const w = el.naturalWidth * k
			const h = el.naturalHeight * k
			const center = screenToWorld(vp, cssW / 2, cssH / 2)
			const id = addImage(sketch, { src, x: center.x - w / 2, y: center.y - h / 2, w, h })
			imgEls.set(id, el)
			setSelection(sketch, [id])
			tool = 'select'
			scheduleRender()
		}
		el.src = src
	}
	reader.readAsDataURL(file)
}

function onFileChange(e: Event) {
	const input = e.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (file) loadImageFile(file)
	input.value = '' // allow re-picking the same file
}

function clearAll() {
	sketch.strokes = []
	sketch.images = []
	imgEls.clear()
	clearSelection(sketch)
	scheduleRender()
}

$effect(() => {
	resize()
	const onResize = () => resize()
	window.addEventListener('resize', onResize)
	window.addEventListener('keydown', onKey)
	return () => {
		window.removeEventListener('resize', onResize)
		window.removeEventListener('keydown', onKey)
	}
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
		onpointerup={endPointer}
		onpointercancel={endPointer}
		onwheel={onWheel}
	></canvas>

	<div
		class="border-border bg-background/95 absolute top-3 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-2xl border p-1 shadow-md backdrop-blur-sm"
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

		<span class="bg-border mx-0.5 h-4 w-px" aria-hidden="true"></span>

		<div class="flex items-center gap-1" role="group" aria-label={t('draw.colors')}>
			{#each COLORS as c (c)}
				<button
					type="button"
					class="size-5 rounded-full border transition-transform hover:scale-110 {penColor === c
						? 'ring-primary ring-2 ring-offset-1'
						: 'border-border'}"
					style="background-color: {c}"
					aria-label={c}
					aria-pressed={penColor === c}
					onclick={() => {
						penColor = c
						tool = 'pen'
					}}
				></button>
			{/each}
		</div>

		<span class="bg-border mx-0.5 h-4 w-px" aria-hidden="true"></span>

		<button
			type="button"
			class="text-foreground hover:bg-foreground/10 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors"
			onclick={() => fileInput?.click()}
		>
			{t('draw.addImage')}
		</button>

		<span class="bg-border mx-0.5 h-4 w-px" aria-hidden="true"></span>

		<div class="flex items-center gap-0.5" role="group" aria-label={t('draw.zoom')}>
			<button
				type="button"
				class="text-foreground hover:bg-foreground/10 size-6 rounded-full text-sm font-bold transition-colors"
				aria-label={t('draw.zoomOut')}
				onclick={() => zoomByFactor(1 / 1.25)}
			>
				−
			</button>
			<button
				type="button"
				class="text-foreground hover:bg-foreground/10 min-w-[3rem] rounded-full px-1 py-1 text-xs font-bold tabular-nums transition-colors"
				onclick={resetView}
				title={t('draw.resetView')}
			>
				{zoomPct}%
			</button>
			<button
				type="button"
				class="text-foreground hover:bg-foreground/10 size-6 rounded-full text-sm font-bold transition-colors"
				aria-label={t('draw.zoomIn')}
				onclick={() => zoomByFactor(1.25)}
			>
				＋
			</button>
		</div>

		<span class="bg-border mx-0.5 h-4 w-px" aria-hidden="true"></span>

		<button
			type="button"
			class="text-foreground hover:bg-foreground/10 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase transition-colors"
			onclick={clearAll}
		>
			{t('draw.clear')}
		</button>
	</div>

	<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={onFileChange}>
</div>
