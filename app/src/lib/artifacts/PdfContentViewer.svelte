<script lang="ts">
import type { ArtifactLocator } from './artifact-view'
import { base64ToBytes, loadOwnedPdf, type PDFDocumentProxy } from './pdf'

let {
	base64,
	locator = null,
	initialPage = 1
}: { base64: string; locator?: ArtifactLocator | null; initialPage?: number } = $props()
let document = $state<PDFDocumentProxy | null>(null)
let current = $state(1)
let canvas = $state<HTMLCanvasElement | null>(null)
let width = $state(0)
let loading = $state(false)
let failure = $state('')
const count = $derived(document?.numPages ?? 1)
const choices = $derived(
	Array.from(
		{ length: Math.min(count, 7) },
		(_, i) => Math.min(Math.max(1, current - 3), Math.max(1, count - 6)) + i
	)
)
const region = $derived(
	locator?.kind === 'page-region' && locator.page === current ? locator : null
)
$effect(() => {
	const encoded = base64
	let stale = false
	let dispose: (() => Promise<void>) | undefined
	document = null
	failure = ''
	loading = true
	void loadOwnedPdf(base64ToBytes(encoded))
		.then(async (owned) => {
			dispose = owned.destroy
			if (stale) {
				await dispose()
				return
			}
			document = owned.document
			current = 1
		})
		.catch((error) => {
			if (!stale) {
				failure = String(error)
				loading = false
			}
		})
	return () => {
		stale = true
		void dispose?.()
	}
})
$effect(() => {
	if (document && !locator) current = Math.min(count, Math.max(1, initialPage))
	if (document && locator?.kind === 'page-region')
		current = Math.min(count, Math.max(1, locator.page))
})
let renderGeneration = 0
let renderQueue = Promise.resolve()
$effect(() => {
	const doc = document
	const pageNumber = current
	const target = canvas
	const pageWidth = Math.floor(width)
	if (!doc || !target || pageWidth < 1) return
	const generation = ++renderGeneration
	loading = true
	renderQueue = renderQueue
		.catch(() => {})
		.then(async () => {
			if (generation !== renderGeneration) return
			const page = await doc.getPage(pageNumber)
			if (generation !== renderGeneration) return
			const viewport = page.getViewport({ scale: pageWidth / page.getViewport({ scale: 1 }).width })
			target.width = Math.ceil(viewport.width)
			target.height = Math.ceil(viewport.height)
			const context = target.getContext('2d')
			if (context) await page.render({ canvas: target, canvasContext: context, viewport }).promise
		})
		.catch((error) => {
			if (generation === renderGeneration) failure = String(error)
		})
		.finally(() => {
			if (generation === renderGeneration) loading = false
		})
	return () => {
		renderGeneration++
	}
})
</script>
<div class="pdf-preview">
	<nav aria-label="PDF-Seiten">
		<button
			type="button"
			aria-label="Vorherige PDF-Seite"
			disabled={current===1}
			onclick={()=>current--}
		>
			←
		</button>
		{#each choices as number}
			<button
				type="button"
				aria-label={`PDF-Seite ${number}`}
				aria-pressed={current===number}
				onclick={()=>current=number}
			>
				{number}
			</button>
		{/each}
		<button
			type="button"
			aria-label="Nächste PDF-Seite"
			disabled={current===count}
			onclick={()=>current++}
		>
			→
		</button>
		<label
			>Seite
			<input
				aria-label="PDF-Seitennummer"
				type="number"
				min="1"
				max={count}
				value={current}
				onchange={event=>{current=Math.min(count,Math.max(1,Number(event.currentTarget.value)||1))}}
			>
			/ {count}</label
		>
	</nav>
	{#if failure}
		<p role="alert">{failure}</p>
	{/if}
	<div class="pdf-scroll">
		{#if loading}
			<p role="status">Seite wird geladen …</p>
		{/if}
		<div class="page" bind:clientWidth={width} data-page={current}>
			<canvas bind:this={canvas}></canvas>
			{#if region}
				<div
					aria-label="Markierte Fundstelle"
					class="marker"
					style={`left:${region.x/10000}%;top:${region.y/10000}%;width:${region.width/10000}%;height:${region.height/10000}%`}
				></div>
			{/if}
		</div>
	</div>
</div>
<style>
.pdf-preview {
	display: flex;
	flex: 1;
	min-height: 0;
	flex-direction: column;
}
.pdf-preview nav {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
	flex-shrink: 0;
	flex-wrap: wrap;
}
.pdf-preview button {
	padding: 4px 8px;
	border: 1px solid var(--color-border);
	border-radius: 6px;
	font-size: 12px;
	cursor: pointer;
}
.pdf-preview button[aria-pressed="true"] {
	background: var(--color-primary);
	color: var(--color-primary-foreground);
}
.pdf-preview button:disabled {
	opacity: 0.35;
}
.pdf-preview label {
	margin-left: auto;
	font-size: 11px;
}
.pdf-preview input {
	width: 45px;
	border: 1px solid var(--color-border);
	border-radius: 5px;
	padding: 3px;
}
.pdf-scroll {
	overflow: auto;
	min-height: 0;
	padding: 12px;
	flex: 1;
}
.page {
	position: relative;
	width: 100%;
}
.page canvas {
	width: 100%;
	display: block;
}
.marker {
	position: absolute;
	border: 2px solid #d68a17;
	background: #f5b94244;
	pointer-events: none;
}
.pdf-preview p {
	font-size: 12px;
	padding: 8px;
}
</style>
