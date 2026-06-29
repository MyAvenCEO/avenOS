<script lang="ts">
import type { Flow, NodeState, RecipeNode, TraceStep } from '@avenos/aven-skills'
import BookkeepingVibe from '$lib/shell/BookkeepingVibe.svelte'
import DocCompareVibe from '$lib/shell/DocCompareVibe.svelte'
import InvoiceBookingVibe from '$lib/shell/InvoiceBookingVibe.svelte'
import InvoiceMatchVibe from '$lib/shell/InvoiceMatchVibe.svelte'

// board 0083 — the optional "vibe view" of a single flow step: a more visually appealing, user-facing
// rendering of what an actor is doing right now. A step may name a `vibe` (reusing a chat-timeline card
// like classify/extract/match/book) with `vibeData`; otherwise we key on `${flowId}:${nodeId}` for the
// Minecraft sand→glass samples, and fall back to a clean generic step card.
let { flow, node, step }: { flow: Flow; node: RecipeNode | null; step: TraceStep | null } = $props()

const key = $derived(node ? `${flow.id}:${node.id}` : '')
const running = $derived(step?.state === 'running')
const vibe = $derived(step?.vibe ?? '')
const vibeData = $derived((step?.vibeData ?? {}) as Record<string, unknown>)
const contact = $derived(
	vibeData as {
		name?: string
		matchedBy?: string
		isNew?: boolean
		ust_id?: string
		address?: string
		added?: string[]
	}
)

const STATE_LABEL: Record<NodeState, string> = {
	idle: 'Bereit',
	waiting: 'Wartet',
	running: 'Läuft',
	done: 'Fertig',
	error: 'Fehler'
}
const STATE_CHIP: Record<NodeState, string> = {
	idle: 'bg-muted text-muted-foreground',
	waiting: 'bg-amber-500/15 text-amber-700',
	running: 'bg-blue-500/15 text-blue-700',
	done: 'bg-green-600/15 text-green-700',
	error: 'bg-red-600/15 text-red-700'
}
</script>

{#if !node || !step}
	<div class="text-muted-foreground flex h-full items-center justify-center text-sm">
		Kein Schritt ausgewählt.
	</div>
{:else if vibe === 'bookkeeping'}
	<div class="w-full">
		<BookkeepingVibe data={vibeData} />
	</div>
{:else if vibe === 'doc-compare'}
	<div class="w-full">
		<DocCompareVibe data={vibeData} />
	</div>
{:else if vibe === 'invoice-match'}
	<div class="w-full">
		<InvoiceMatchVibe data={vibeData} />
	</div>
{:else if vibe === 'invoice-booking'}
	<div class="w-full">
		<InvoiceBookingVibe data={vibeData} />
	</div>
{:else if vibe === 'contact'}
	<!-- Adressbuch-Anreicherung: which party was matched/created + what was added -->
	<div
		class="border-border bg-card mx-auto flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-lg)] border p-6"
	>
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-3">
				<div
					class="bg-primary/15 text-primary flex size-11 items-center justify-center rounded-full text-lg font-bold"
				>
					{(contact.name ?? '?').slice(0, 2).toUpperCase()}
				</div>
				<div class="min-w-0">
					<h3 class="text-foreground truncate text-lg font-semibold">
						{contact.name ?? 'Kontakt'}
					</h3>
					<p class="text-muted-foreground text-xs">
						{contact.isNew ? 'Neu angelegt' : 'Aktualisiert'}
						· Match über {contact.matchedBy ?? '—'}
					</p>
				</div>
			</div>
			<span class="rounded-full bg-green-600/15 px-2.5 py-1 text-xs font-semibold text-green-700"
				>Adressbuch ✓</span
			>
		</div>
		{#if contact.ust_id}
			<div class="flex justify-between text-sm">
				<span class="text-muted-foreground">USt-IdNr</span
				><span class="text-foreground font-mono">{contact.ust_id}</span>
			</div>
		{/if}
		{#if contact.address}
			<div class="flex justify-between gap-3 text-sm">
				<span class="text-muted-foreground shrink-0">Adresse</span
				><span class="text-foreground text-right">{contact.address}</span>
			</div>
		{/if}
		{#if contact.added?.length}
			<div>
				<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
					Ergänzt
				</p>
				<div class="flex flex-wrap gap-1">
					{#each contact.added as a (a)}
						<span class="bg-primary/10 text-foreground rounded px-2 py-0.5 text-xs">+ {a}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else if key === 'minecraft-glass:mine'}
	<!-- ⛏️ Sand abbauen -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8"
		style="background: linear-gradient(160deg,#e7d9b0,#cbb481)"
	>
		<div class="text-6xl">⛏️</div>
		<h3 class="text-2xl font-bold text-[#5a4a2a]">Sand abgebaut</h3>
		<div class="grid grid-cols-4 gap-1.5">
			{#each Array(8) as _, i (i)}
				<div class="size-9 rounded-sm border border-[#a8915f]" style="background:#ddc88f"></div>
			{/each}
		</div>
		{#each step.outputs ?? [] as o (o)}
			<span class="rounded-full bg-[#5a4a2a] px-4 py-1 text-sm font-semibold text-[#f3e9cf]"
				>⛏ {o}</span
			>
		{/each}
	</div>
{:else if key === 'minecraft-glass:smelt'}
	<!-- 🔥 Ofen -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8 text-[#ffe]"
		style="background: linear-gradient(160deg,#2b2b33,#16161b)"
	>
		<div class="text-6xl {running ? 'animate-pulse' : ''}">🔥</div>
		<h3 class="text-2xl font-bold">Schmelzen im Ofen</h3>
		<div class="flex items-center gap-3">
			<div class="flex flex-col items-center gap-1">
				{#each step.inputs ?? [] as i (i)}
					<span class="rounded bg-white/10 px-3 py-1 text-sm">{i}</span>
				{/each}
			</div>
			<span class="text-3xl text-orange-400">→</span>
			<div class="flex flex-col items-center gap-1">
				{#each step.outputs ?? [] as o (o)}
					<span class="rounded bg-sky-400/20 px-3 py-1 text-sm font-semibold text-sky-200"
						>🪟 {o}</span
					>
				{/each}
			</div>
		</div>
		<div class="h-2 w-56 overflow-hidden rounded-full bg-white/10">
			<div
				class="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-300 {running
					? 'animate-pulse'
					: ''}"
				style="width: {running ? '70%' : '100%'}"
			></div>
		</div>
		{#if step.message}
			<p class="text-sm text-orange-200">{step.message}</p>
		{/if}
	</div>
{:else if key === 'minecraft-glass:craft-pane'}
	<!-- 🪟 Glasscheiben craften -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8"
		style="background: linear-gradient(160deg,#cfe6ef,#a9cfe0)"
	>
		<h3 class="text-2xl font-bold text-[#1f4a5c]">Glasscheiben craften</h3>
		<div class="grid grid-cols-3 gap-1 rounded-md bg-[#6b4a2a] p-2">
			{#each Array(9) as _, i (i)}
				<div
					class="size-10 rounded-sm border"
					style="background:{i < 6 ? 'rgba(180,220,235,.85)' : 'rgba(255,255,255,.25)'};border-color:#4a341f"
				></div>
			{/each}
		</div>
		<span class="text-2xl text-[#1f4a5c]">↓</span>
		{#each step.outputs ?? [] as o (o)}
			<span class="rounded-full bg-[#1f4a5c] px-4 py-1 text-sm font-semibold text-white"
				>🪟 {o}</span
			>
		{/each}
		{#if step.message}
			<p class="text-sm text-[#1f4a5c]">{step.message}</p>
		{/if}
	</div>
{:else}
	<!-- Generic fallback: a clean step card (vibe optional) -->
	<div
		class="border-border bg-card flex h-full flex-col gap-4 rounded-[var(--radius-lg)] border p-6"
	>
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<h3 class="text-foreground truncate text-lg font-semibold">{node.name}</h3>
				{#if node.actor}
					<p class="text-muted-foreground truncate font-mono text-[11px]">{node.actor}</p>
				{/if}
			</div>
			<span class="rounded-full px-2.5 py-1 text-xs font-semibold {STATE_CHIP[step.state]}"
				>{STATE_LABEL[step.state]}</span
			>
		</div>
		{#if node.note}
			<p class="text-muted-foreground text-sm">{node.note}</p>
		{/if}
		<div class="flex items-center gap-3">
			<div class="flex flex-1 flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
					>Inbox</span
				>
				{#each step.inputs ?? [] as i (i)}
					<span class="bg-muted text-foreground rounded px-2 py-1 text-xs">{i}</span>
				{/each}
			</div>
			<span class="text-muted-foreground text-2xl">→</span>
			<div class="flex flex-1 flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
					>Output</span
				>
				{#each step.outputs ?? [] as o (o)}
					<span class="bg-primary/10 text-foreground rounded px-2 py-1 text-xs font-medium"
						>{o}</span
					>
				{/each}
			</div>
		</div>
		{#if step.message}
			<p
				class="text-muted-foreground border-border mt-auto rounded border border-dashed p-2 text-sm"
			>
				{step.message}
			</p>
		{/if}
	</div>
{/if}
