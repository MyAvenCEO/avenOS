<script lang="ts">
import { SPARKS, STATUS_LABEL, type WorkItemStatus, type WorkItemsActor } from './workitems.svelte'

/**
 * The todo list, hand-operable, in two shapes.
 *
 * The reference cards' layout on the brand's palette: warm-white rounded
 * cards with soft shadows floating on eggshell wells, the status drawn as a
 * shape inside tinted pills, board cards carrying the Linear grammar — id
 * line, title, chip row — all in the app's cream world rather than the
 * reference's gray one.
 */
const { actor }: { actor: WorkItemsActor } = $props()

let newWorkItem = $state('')
/** Card id in flight during a drag, so columns know what is being dropped. */
let dragging = $state<string | null>(null)

const COLUMNS: { status: WorkItemStatus; label: string }[] = [
	{ status: 'open', label: 'Offen' },
	{ status: 'doing', label: 'In Arbeit' },
	{ status: 'done', label: 'Erledigt' }
]

/** Pill colors per status, sampled from the reference. */
const PILL: Record<WorkItemStatus, string> = {
	open: 'bg-foreground/5 text-foreground/45',
	doing: 'bg-status-info/20 text-[#a06818]',
	done: 'bg-status-success/10 text-status-success'
}

const done = $derived(actor.visible.filter((t) => t.status === 'done').length)
const pct = $derived(
	actor.visible.length === 0 ? 0 : Math.round((done / actor.visible.length) * 100)
)

function addWorkItem(event: SubmitEvent) {
	event.preventDefault()
	if (newWorkItem.trim() === '') return
	actor.create(newWorkItem)
	newWorkItem = ''
}

function drop(status: WorkItemStatus) {
	if (dragging) actor.update(dragging, { status })
	dragging = null
}

/** One step left or right through the columns, for mouse-less moves. */
function shift(id: string, by: -1 | 1) {
	const todo = actor.byId(id)
	if (!todo) return
	const at = COLUMNS.findIndex((c) => c.status === todo.status)
	const next = COLUMNS[at + by]
	if (next) actor.update(id, { status: next.status })
}
</script>

{#snippet glyph(status: WorkItemStatus)}
	<!-- The status as a shape, not just a word: dashed ring = offen, half-filled
	     ring = in Arbeit, filled check = erledigt. -->
	{#if status === 'open'}
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none">
			<circle
				cx="8"
				cy="8"
				r="6"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-dasharray="2.6 2.4"
			/>
		</svg>
	{:else if status === 'doing'}
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0">
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path d="M8 2 a 6 6 0 0 1 0 12 Z" fill="currentColor" />
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" class="size-3.5 shrink-0">
			<circle cx="8" cy="8" r="7" fill="currentColor" />
			<path
				d="M4.8 8.4 L7 10.6 L11.2 5.8"
				fill="none"
				stroke="#fff"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet check(todo: { id: string; status: WorkItemStatus })}
	<!-- The reference checklist's control: a ring that fills near-black with a
	     white check when done. -->
	<button
		type="button"
		onclick={() => actor.toggle(todo.id)}
		aria-label={todo.status === 'done' ? 'Wieder öffnen' : 'Abhaken'}
		class="flex size-5 shrink-0 items-center justify-center rounded-full transition-colors {todo.status ===
		'done'
			? 'bg-primary'
			: 'border-[1.5px] border-foreground/20 hover:border-foreground/40'}"
	>
		{#if todo.status === 'done'}
			<svg viewBox="0 0 16 16" class="size-3" fill="none">
				<path
					d="M4 8.4 L6.8 11 L12 5.4"
					stroke="#fff"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
	</button>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-4 text-foreground">
	<div class="flex items-center justify-between gap-3">
		<h2 class="font-semibold text-[15px]">Aufgaben</h2>

		{#if actor.visible.length > 0}
			<!-- The reference card's progress grammar: check, count, bar, percent. -->
			<span
				class="flex items-center gap-2.5 rounded-full bg-[#fffdf7] px-3.5 py-1.5 text-[13px] shadow-[0_1px_3px_rgba(30,41,59,0.08)]"
			>
				<svg viewBox="0 0 16 16" class="size-4 text-foreground/30" fill="none">
					<circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M5.4 8.2 L7.2 10 L10.8 6.2"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span class="font-medium">{done} von {actor.visible.length}</span>
				<span class="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10">
					<span
						class="block h-full rounded-full bg-status-success transition-[width]"
						style="width: {pct}%"
					></span>
				</span>
				<span class="text-foreground/40">{pct}%</span>
			</span>
		{/if}
		<span class="flex-1"></span>

		<!-- Which spark and shape are on screen. Read-only on purpose: switching
		     is a conversation move — "zeig mir das Board", "zeig die Team-Liste" —
		     handled by the workitem_show tool, never by a button. -->
		<span
			class="rounded-full bg-[#fffdf7] px-3 py-1.5 text-foreground/40 text-xs shadow-[0_1px_3px_rgba(30,41,59,0.08)]"
		>
			{SPARKS.find((s) => s.id === actor.active)?.name}
			·
			{actor.view === 'board' ? 'Board' : 'Liste'}
		</span>
	</div>

	<form onsubmit={addWorkItem}>
		<input
			bind:value={newWorkItem}
			placeholder="Aufgabe hinzufügen…"
			class="w-full rounded-xl border border-foreground/5 bg-[#fffdf7] px-4 py-2.5 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] outline-none transition-shadow placeholder:text-foreground/30 focus:shadow-[0_1px_3px_rgba(30,41,59,0.07),0_0_0_3px_rgba(30,41,59,0.06)]"
		>
	</form>

	{#if actor.view === 'list'}
		<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
			{#each actor.visible as todo (todo.id)}
				<li
					class="group flex items-center gap-3 rounded-2xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.06),0_4px_12px_rgba(30,41,59,0.04)] transition-shadow hover:shadow-[0_2px_6px_rgba(30,41,59,0.08),0_8px_20px_rgba(30,41,59,0.06)]"
				>
					{@render check(todo)}
					<span
						class="flex-1 font-medium leading-snug {todo.status === 'done'
							? 'text-foreground/30 line-through'
							: ''}"
					>
						{todo.title}
					</span>
					<!-- The status as a badge, and the badge as the control: a click is
					     one step around open → doing → done. -->
					<button
						type="button"
						onclick={() => actor.cycle(todo.id)}
						title="Status weiterschalten"
						class="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-transform active:scale-95 {PILL[
							todo.status
						]}"
					>
						{@render glyph(todo.status)}
						{STATUS_LABEL[todo.status]}
					</button>
					<button
						type="button"
						onclick={() => actor.remove(todo.id)}
						class="shrink-0 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
						aria-label="Löschen"
					>
						×
					</button>
				</li>
			{:else}
				<li class="pt-8 text-center text-[13px] text-foreground/30">
					Noch nichts. Sag zum Beispiel „setz Milch kaufen auf die Liste“.
				</li>
			{/each}
		</ul>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-3 gap-3">
			{#each COLUMNS as column (column.status)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-foreground/5 bg-surface-soft/60 p-2.5 transition-colors {dragging
						? 'bg-surface-soft'
						: ''}"
					ondragover={(e) => e.preventDefault()}
					ondrop={() => drop(column.status)}
				>
					<div class="flex items-center gap-2 px-1.5 pt-0.5">
						<span
							class={column.status === 'open'
								? 'text-foreground/35'
								: column.status === 'doing'
									? 'text-[#a06818]'
									: 'text-status-success'}
						>
							{@render glyph(column.status)}
						</span>
						<h3 class="font-medium text-[13px] text-foreground/60">{column.label}</h3>
						<span class="ml-auto text-foreground/30 text-xs">
							{actor.visible.filter((t) => t.status === column.status).length}
						</span>
					</div>

					<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
						{#each actor.visible.filter((t) => t.status === column.status) as todo (todo.id)}
							{@const spark = SPARKS.find((sp) => sp.id === todo.spark)}
							<li
								draggable="true"
								ondragstart={() => {
									dragging = todo.id
								}}
								ondragend={() => {
									dragging = null
								}}
								class="group cursor-grab rounded-xl border border-foreground/5 bg-[#fffdf7] px-3.5 py-3 active:cursor-grabbing"
							>
								<!-- The reference card grammar: id line, then title, then chips. -->
								<div class="flex items-center gap-1.5 text-foreground/35 text-xs">
									{@render glyph(todo.status)}
									<span class="font-mono uppercase">{todo.id.slice(0, 6)}</span>
									<button
										type="button"
										onclick={() => actor.remove(todo.id)}
										class="ml-auto opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
										aria-label="Löschen"
									>
										×
									</button>
								</div>

								<div
									class="py-1.5 font-medium text-sm leading-snug {todo.status === 'done'
										? 'text-foreground/30 line-through'
										: ''}"
								>
									{todo.title}
								</div>

								<div class="flex items-center gap-1.5">
									<span
										class="flex items-center gap-1.5 rounded-md border border-foreground/10 px-1.5 py-0.5 text-foreground/60 text-xs"
									>
										<span class="size-1.5 rounded-full" style="background: {spark?.color}"></span>
										{spark?.name}
									</span>
									<!-- Arrows for mouse-less moves; drag works too. -->
									<span
										class="ml-auto flex gap-0.5 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
									>
										<button
											type="button"
											onclick={() => shift(todo.id, -1)}
											disabled={column.status === 'open'}
											class="px-1 hover:text-foreground disabled:invisible"
											aria-label="Nach links"
										>
											‹
										</button>
										<button
											type="button"
											onclick={() => shift(todo.id, 1)}
											disabled={column.status === 'done'}
											class="px-1 hover:text-foreground disabled:invisible"
											aria-label="Nach rechts"
										>
											›
										</button>
									</span>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
</div>
