<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { loadContext, type NodeContextPayload } from '$lib/data/client'
import VibeCard from '$lib/shell/VibeCard.svelte'

// board 0119n — the FLOWS right aside: the DETAIL of the node selected in the flow graph, cleanly
// separated by metadata type (each its own tab): Overview · Prompt · Code · LLM · Context · Caps.
// Same data source as the DB viewer's Actors category (loadContext('actors')) — one SSOT.

type ActorCfg = {
	binding?: 'code' | 'engine'
	engine?: string | null
	code?: string | null
	caps?: string[] | null
	mailbox?: { description?: string; parameters?: unknown } | null
	llm?: unknown
	prompt?: string | null
	/** provenance of the system prompt: a DB config row vs a hardcoded string in server code. */
	promptSource?: 'db' | 'hardcoded' | null
	context?: string[] | null
	vibe?: string | null
	hitl?: boolean
	position?: number
}
type CtxItem = { name: string; gloss?: string; tag?: string; config?: ActorCfg }

let {
	skillId = null,
	actorName = null,
	node = null
}: {
	skillId?: string | null
	actorName?: string | null
	/** the selected flow NODE — step-level overrides (vibe/hitl) that overlay the actor config. */
	node?: { id?: string; vibe?: string; hitl?: boolean } | null
} = $props()

const actorsQuery = createQuery(() => ({
	queryKey: ['db', 'actors'],
	queryFn: () => loadContext('actors')
}))
const items = $derived<CtxItem[]>((actorsQuery.data?.items ?? []) as CtxItem[])
// match the selected node's actor within the active skill (name repeats across skills).
const item = $derived<CtxItem | null>(
	actorName
		? (items.find((x) => (x.name === actorName || x.config?.engine === actorName) && (!skillId || x.tag === skillId)) ??
				items.find((x) => x.name === actorName || x.config?.engine === actorName) ??
				null)
		: null
)
const cfg = $derived<ActorCfg | undefined>(item?.config)
// step-level node config overlays the (possibly shared) actor row — e.g. the crud steps all run
// data_crud but each renders its OWN vibe, declared on the flow node.
const vibe = $derived<string | null>(node?.vibe ?? cfg?.vibe ?? null)
const hitl = $derived<boolean>(node?.hitl ?? cfg?.hitl ?? false)

type TabId = 'overview' | 'tool' | 'code' | 'llm' | 'context' | 'json'
const tabs = $derived<{ id: TabId; label: string }[]>(
	[
		{ id: 'overview' as const, label: 'Overview', on: true },
		{ id: 'tool' as const, label: 'Tool', on: !!cfg?.mailbox },
		{ id: 'code' as const, label: 'Sandbox', on: !!cfg?.code },
		{ id: 'llm' as const, label: 'LLM', on: !!cfg?.llm },
		{ id: 'context' as const, label: 'Context', on: true },
		{ id: 'json' as const, label: 'JSON', on: !!cfg }
	]
		.filter((t) => t.on)
		.map(({ id, label }) => ({ id, label }))
)
let tab = $state<TabId>('overview')
// keep the active tab valid when the selection (and thus available tabs) changes.
$effect(() => {
	if (!tabs.some((t) => t.id === tab)) tab = 'overview'
})
const pretty = (v: unknown): string => {
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return String(v)
	}
}

// board 0119p — CONTEXT TRANSPARENCY: a declared provider key (e.g. "predicates") is not a static
// string — it resolves to the ACTUAL content injected into this actor's prompt at call time. Fetch it
// from the universal /api/context/:provider endpoint and show it, plus a plain-word explainer of what
// KIND of resource it is (a live registry query vs a static reference vs a projection recipe).
let ctxCache = $state<Record<string, NodeContextPayload | 'loading' | 'error'>>({})
async function fetchCtx(provider: string): Promise<void> {
	if (ctxCache[provider]) return
	ctxCache[provider] = 'loading'
	try {
		ctxCache[provider] = await loadContext(provider)
	} catch {
		ctxCache[provider] = 'error'
	}
}
$effect(() => {
	if (tab !== 'context') return
	for (const provider of cfg?.context ?? []) void fetchCtx(provider)
})
// the context in ORDER: the system prompt is the first thing the LLM sees, then each appended
// provider. One accordion item per piece; single-open (opening one collapses the rest).
type CtxPiece = { key: string; label: string; system: boolean }
const ctxPieces = $derived<CtxPiece[]>([
	...(cfg?.prompt ? [{ key: '__system', label: 'System prompt', system: true }] : []),
	...(cfg?.context ?? []).map((p) => ({ key: p, label: p, system: false }))
])
let openKey = $state<string | null>(null)
// default to the first piece whenever the selection (and thus the pieces) changes.
$effect(() => {
	const first = ctxPieces[0]?.key ?? null
	if (!ctxPieces.some((p) => p.key === openKey)) openKey = first
})
// a plain-word explanation of what a provider IS (falls back to the resolved kind).
function explain(provider: string, payload: NodeContextPayload | 'loading' | 'error' | undefined): string {
	const known: Record<string, string> = {
		dispatch_prompt:
			'The Tier-1 router roundtrip — this exact system prompt (skill menu resolved live from the DB) picks ONE skill for the turn. The scaffold text is HARDCODED in server code, not yet a DB config row.',
		predicates:
			'LIVE query — your current x1–x5 predicate registry (data_schema). Injected so the actor reuses/extends existing predicates instead of minting duplicates.',
		gismu: 'STATIC reference — the Lojban gismu dictionary; grounds new predicate place-structures in real roots.',
		types: 'LIVE registry — the composite types (bundle → projected fields) available to build over.',
		data_operations: 'LIVE registry — the named query/mutation ops this actor may run.'
	}
	if (known[provider]) return known[provider]
	if (provider.startsWith('type:') || provider === 'type')
		return 'A composite type\'s projection recipe — how flat fields map to predicate places.'
	if (payload && payload !== 'loading' && payload !== 'error')
		return payload.kind === 'text'
			? 'Reference TEXT appended to the prompt.'
			: 'A LIVE registry resolved at call time.'
	return 'Resolved from the universal context endpoint at call time.'
}
</script>

<div class="border-border bg-surface-cream flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border">
	{#if !actorName}
		<div class="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs leading-relaxed">
			Select a step in the flow to see its config.
		</div>
	{:else if !item}
		<div class="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs">
			No config for “{actorName}”.
		</div>
	{:else}
		<!-- header -->
		<div class="border-border/60 shrink-0 border-b px-3 py-2.5">
			<p class="text-foreground truncate font-mono text-sm font-semibold">{item.name}</p>
			<p class="text-muted-foreground mt-0.5 text-[10px]">
				{cfg?.binding === 'code' ? 'QuickJS code' : `engine · ${cfg?.engine ?? item.name}`}{#if hitl}
					· HITL{/if}{#if vibe}
					· vibe {vibe}{/if}
			</p>
		</div>
		<!-- metadata-type tabs -->
		<div class="border-border/60 flex shrink-0 flex-wrap gap-x-2 gap-y-1 border-b px-3 py-1.5 font-display text-[10px] font-bold tracking-wider uppercase">
			{#each tabs as t, i (t.id)}
				{#if i > 0}<span class="select-none opacity-25" aria-hidden="true">|</span>{/if}
				<button
					type="button"
					class="transition-opacity hover:opacity-80 {tab === t.id ? 'opacity-95' : 'opacity-40'}"
					onclick={() => (tab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
		<!-- panel -->
		<div class="min-h-0 flex-1 overflow-auto p-3">
			{#if tab === 'overview'}
				<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
					Description
				</p>
				<p class="text-foreground text-[12px] leading-relaxed">
					{cfg?.mailbox?.description ?? item.gloss ?? '—'}
				</p>
				{#if cfg?.caps?.length}
					<p class="text-muted-foreground mt-3 mb-1 text-[10px] font-semibold tracking-wide uppercase">
						Caps
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each cfg.caps as c (c)}
							<span class="border-border bg-background text-foreground rounded-full border px-2 py-0.5 font-mono text-[11px]">{c}</span>
						{/each}
					</div>
				{/if}
				{#if vibe}
					<p class="text-muted-foreground mt-3 mb-1 text-[10px] font-semibold tracking-wide uppercase">
						Vibe · {vibe}
					</p>
					{#key vibe}
						<VibeCard schema={vibe} containerName={`flow-actor-vibe-${vibe}`} />
					{/key}
				{/if}
			{:else if tab === 'tool'}
				<p class="text-muted-foreground mb-2 text-[11px] leading-relaxed">
					The attached TOOL DEFINITION — how the LLM calls this actor (name, description + the
					argument schema it must fill).
				</p>
				<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">Description</p>
				<p class="text-foreground mb-3 text-[12px] leading-relaxed">{cfg?.mailbox?.description ?? '—'}</p>
				{#if cfg?.mailbox?.parameters}
					<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">Parameters (JSON Schema)</p>
					<pre class="text-foreground border-border/60 bg-background max-h-72 overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{pretty(cfg.mailbox.parameters)}</pre>
				{/if}
			{:else if tab === 'code'}
				<p class="text-muted-foreground mb-2 text-[11px] leading-relaxed">
					The actor's code — a QuickJS module <span class="font-mono">handle(msg, caps)</span> executed
					in the locked-down sandbox (only its granted caps; listed under Overview).
				</p>
				<pre class="text-foreground border-border/60 bg-background overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{cfg?.code}</pre>
			{:else if tab === 'llm'}
				<pre class="text-foreground font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{pretty(cfg?.llm)}</pre>
			{:else if tab === 'context'}
				{#if ctxPieces.length === 0}
					<p class="text-muted-foreground text-[11px] leading-relaxed">
						This ENGINE actor runs no LLM roundtrip of its own — the dispatcher-routed chat turn
						calls it as a tool. What the LLM sees for that turn: the base system prompt (DB
						config — the `chat` actor on the Dispatch skill), the routed skill's live hint
						(manifest config), and this actor's Tool definition (see the Tool tab).
					</p>
				{:else}
				<p class="text-muted-foreground mb-2 text-[11px] leading-relaxed">
					The FULL context in the order the LLM receives it — the system prompt first, then each
					appended provider. Click a piece to expand it (one open at a time).
				</p>
				<div class="border-border overflow-hidden rounded-lg border">
					{#each ctxPieces as piece, i (piece.key)}
						{@const open = openKey === piece.key}
						{@const payload = piece.system ? undefined : ctxCache[piece.key]}
						<div class={i > 0 ? 'border-border/60 border-t' : ''}>
							<button
								type="button"
								class="bg-background hover:bg-muted/40 flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors"
								onclick={() => (openKey = open ? null : piece.key)}
							>
								<span class="text-muted-foreground w-3.5 shrink-0 text-[10px]">{open ? '▾' : '▸'}</span>
								<span class="text-muted-foreground shrink-0 font-mono text-[9px]">{i + 1}</span>
								<span class="text-foreground truncate font-mono text-[12px] font-semibold">{piece.label}</span>
								{#if piece.system}
									<span class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase">prompt</span>
									{#if cfg?.promptSource === 'hardcoded'}
										<span class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-800 uppercase">hardcoded</span>
									{:else if cfg?.promptSource === 'db'}
										<span class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase">db config</span>
									{/if}
								{:else if payload && payload !== 'loading' && payload !== 'error'}
									<span class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase">{payload.kind}</span>
									{#if payload.meta?.source === 'hardcoded'}
										<span class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-800 uppercase">hardcoded</span>
									{/if}
								{/if}
							</button>
							{#if open}
								<div class="bg-surface-cream px-2.5 pb-2.5 pt-1">
									{#if piece.system}
										<pre class="text-foreground max-h-72 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap">{cfg?.prompt}</pre>
									{:else}
										<p class="text-muted-foreground mb-1.5 text-[11px] leading-relaxed">{explain(piece.key, payload)}</p>
										{#if payload === 'loading'}
											<p class="text-muted-foreground text-[11px] italic">Resolving…</p>
										{:else if payload === 'error' || !payload}
											<p class="text-destructive text-[11px]">Could not resolve this provider.</p>
										{:else if payload.kind === 'text'}
											<pre class="text-foreground border-border/60 bg-background max-h-56 overflow-auto rounded border p-2 text-[10px] leading-relaxed whitespace-pre-wrap">{payload.text}</pre>
											{#if payload.meta}<p class="text-muted-foreground mt-1 text-[10px]">{pretty(payload.meta)}</p>{/if}
										{:else}
											<p class="text-muted-foreground mb-1 text-[10px]">{(payload.items ?? []).length} entr{(payload.items ?? []).length === 1 ? 'y' : 'ies'} injected</p>
											<div class="border-border/60 bg-background max-h-56 overflow-auto rounded border">
												{#each payload.items ?? [] as it (it.name)}
													<div class="border-border/40 flex items-baseline gap-2 border-b px-2 py-1 last:border-b-0">
														<span class="text-foreground shrink-0 font-mono text-[11px] font-semibold">{it.name}</span>
														{#if it.gloss}<span class="text-muted-foreground truncate text-[10px]">{it.gloss}</span>{/if}
													</div>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				{/if}
			{:else if tab === 'json'}
				<pre class="text-foreground font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{pretty(cfg)}</pre>
			{/if}
		</div>
	{/if}
</div>
