<script lang="ts">
/**
 * Shared status card primitive.
 *
 * Renders a colored-strip + timer cell + title/summary pane used by both
 * intent rows (left aside) and skill chips (mobile horizontal scroller +
 * desktop right aside). Keeps the eggshell card surface, hover/selected
 * fills, and mirrored (right-strip) layout in one place so both lists
 * always look identical.
 *
 * Pure presentational — all click + state come in via props.
 */
import {
	type CardStatus,
	formatDurationStrip,
	STATUS_LEFT_FRAME,
	STATUS_RIGHT_FRAME,
	STATUS_STRIP_TEXT,
	STATUS_STRIP_TEXT_HOVER,
	STATUS_STRIP_TEXT_ON_FILL,
	STATUS_TIMER_BG_HOVER,
	STATUS_TIMER_BG_REST,
	STATUS_TIMER_BG_SELECTED
} from './types'

let {
	status,
	totalSeconds,
	title,
	description,
	selected,
	archived = false,
	onclick = null,
	ariaPressed = null,
	ariaLabel = null,
	extraClass = '',
	/** Skills scroller only — single-line clamp so selected state cannot grow the row. */
	skillRow = false,
	/**
	 * When `true`, render the card mirrored: status strip painted on the
	 * right edge, timer cell on the right (DOM-order swap via
	 * `flex-row-reverse`), title + summary right-aligned. Used by the
	 * desktop right-aside skill list so it visually mirrors the
	 * left-aligned intent rows. The mobile horizontal skills scroller
	 * keeps the default (left-strip) layout.
	 */
	mirror = false
}: {
	status: CardStatus
	totalSeconds: number
	title: string
	description: string
	selected: boolean
	archived?: boolean
	onclick?: (() => void) | null
	ariaPressed?: boolean | null
	ariaLabel?: string | null
	extraClass?: string
	skillRow?: boolean
	mirror?: boolean
} = $props()

const dur = $derived(formatDurationStrip(totalSeconds))
const frameClass = $derived(mirror ? STATUS_RIGHT_FRAME[status] : STATUS_LEFT_FRAME[status])
const frameSidesClass = $derived(mirror ? 'border-y-0 border-l-0' : 'border-y-0 border-r-0')
</script>

<button
	type="button"
	title={ariaLabel ?? undefined}
	aria-label={ariaLabel ?? undefined}
	aria-pressed={ariaPressed ?? undefined}
	onclick={onclick ?? undefined}
	class="group cursor-pointer overflow-hidden rounded-[var(--radius-lg)] {frameSidesClass} border-solid {frameClass} {mirror
		? 'text-right'
		: 'text-left'} transition-all duration-200 ease-out {archived
		? 'bg-muted/12'
		: selected
			? 'bg-surface-card-selected'
			: 'bg-surface-card hover:bg-surface-card-hover'} {extraClass}"
>
	<div class="flex items-stretch {mirror ? '' : 'flex-row-reverse'}">
		<div
			class="-m-px flex min-w-[2.75rem] shrink-0 flex-col items-center justify-center gap-px self-stretch {mirror
				? 'rounded-l-[var(--radius-lg)]'
				: 'rounded-r-[var(--radius-lg)]'} px-1 py-1 font-mono leading-none font-semibold tracking-tight transition-colors duration-200 ease-out {archived
				? 'bg-transparent text-driftwood-foreground'
				: selected
					? `${STATUS_TIMER_BG_SELECTED[status]} ${STATUS_STRIP_TEXT_ON_FILL[status]}`
					: `${STATUS_TIMER_BG_REST[status]} ${STATUS_TIMER_BG_HOVER[status]} ${STATUS_STRIP_TEXT[status]} ${STATUS_STRIP_TEXT_HOVER[status]}`}"
			aria-hidden="true"
		>
			<span class="text-[12px] tabular-nums">{dur.main}</span>
			<span class="text-[7px] font-medium uppercase">{dur.unit}</span>
		</div>
		<div
			class="min-w-0 flex-1 space-y-0 py-1.5 pr-2 pl-2 {mirror ? 'text-right' : ''} {archived
				? 'bg-transparent opacity-70'
				: 'bg-surface-card'} {skillRow ? 'min-h-0' : ''}"
		>
			<p
				class="text-[12px] leading-tight font-semibold tracking-tight text-foreground {skillRow
					? 'truncate'
					: 'line-clamp-1'}"
			>
				{title}
			</p>
			<p
				class="text-[9px] leading-tight text-foreground {skillRow
					? 'truncate'
					: 'line-clamp-1'} {selected ? 'opacity-55' : 'opacity-50'}"
			>
				{description}
			</p>
		</div>
	</div>
</button>
