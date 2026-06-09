<script lang="ts">
	/**
	 * Skeuomorphic / neumorphic icon-button grid — third Brand Design component.
	 * Soft "extruded" buttons on OUR brand surface (dark #1d2532 / light #dedad3),
	 * press IN when active and light up their accent colour. Adapts to the
	 * surrounding light/dark via the `light` prop. Svelte-scoped styles.
	 */
	let { light = false }: { light?: boolean } = $props()

	const COLORS: Record<string, string> = {
		red: '#F56565',
		blue: '#4299E1',
		green: '#48BB78',
		orange: '#ED8936',
		yellow: '#D69E2E',
		teal: '#38B2AC',
		indigo: '#667EEA',
		purple: '#9F7AEA',
		pink: '#ED64A6',
	}

	// feather-style icon paths (stroke, currentColor)
	const ICONS: Record<string, string> = {
		moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
		bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
		'bar-chart': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
		wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
		'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
		power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
		cast: '<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/>',
		send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
		phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
	}

	const BUTTONS = [
		{ label: 'Sleep', icon: 'moon', type: 'red' },
		{ label: 'Alarm', icon: 'bell', type: 'blue' },
		{ label: 'Data', icon: 'bar-chart', type: 'green' },
		{ label: 'Wifi', icon: 'wifi', type: 'orange' },
		{ label: 'Alerts', icon: 'alert-circle', type: 'yellow' },
		{ label: 'Power', icon: 'power', type: 'teal' },
		{ label: 'Cast', icon: 'cast', type: 'indigo' },
		{ label: 'Send', icon: 'send', type: 'purple' },
		{ label: 'Phone', icon: 'phone', type: 'pink' },
	]

	// A couple active by default so the demo shows both states.
	let active = $state<boolean[]>(BUTTONS.map((_, i) => i === 2 || i === 5))
</script>

<div class="grid" class:is-light={light}>
	{#each BUTTONS as b, i (b.label)}
		<button
			type="button"
			class="c-button"
			class:active={active[i]}
			aria-pressed={active[i]}
			style="--accent: {COLORS[b.type]};"
			onclick={() => (active[i] = !active[i])}
		>
			<svg class="c-button__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				{@html ICONS[b.icon]}
			</svg>
			<span class="c-button__label">{b.label}</span>
		</button>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2rem;

		/* Master palette mirrors the toggle: BLACK shadows + WHITE highlights
		   (reads creamish/warm on the light surface, not bluish). 3D offsets
		   are unchanged — only the shadow colours. */
		--surf: #1d2532;
		/* The button IS the toggle's knob: solid fill + the exact knob box-shadow. */
		--knob-bg: #263142;
		--knob-shadow:
			inset 0 0.25rem 0.25rem rgba(255, 255, 255, 0.08),
			inset 0 -0.25rem 0.25rem rgba(0, 0, 0, 0.2),
			0 0.6rem 0.4rem rgba(0, 0, 0, 0.5),
			0 1.25rem 1rem rgba(0, 0, 0, 0.5);
		/* Pressed = the toggle's empty TRACK (knob gone) — the recessed groove,
		   stamped in. Same shadow recipe as the toggle track, scaled to the
		   button so the groove keeps its depth. */
		--knob-press:
			inset 0 0 2.4rem 1.6rem rgba(0, 0, 0, 0.36),
			inset 0 0.85rem 0.6rem rgba(0, 0, 0, 0.45),
			inset 0 2.2rem 1.1rem rgba(0, 0, 0, 0.3),
			0 -0.2rem 0.2rem rgba(0, 0, 0, 0.2),
			0 0.22rem 0.22rem rgba(255, 255, 255, 0.09);
		/* Text/icon is CUT into the knob (engraved, off). */
		--ink-engrave: #1a2330;
		--emboss-sh: rgba(0, 0, 0, 0.6);
		--emboss-hl: rgba(255, 255, 255, 0.12);
	}
	.grid.is-light {
		--surf: #dedad3;
		--knob-bg: #d5d0c7;
		--knob-shadow:
			inset 0 0.25rem 0.25rem rgba(255, 255, 255, 0.4),
			inset 0 -0.25rem 0.25rem rgba(0, 0, 0, 0.15),
			0 0.6rem 0.4rem rgba(0, 0, 0, 0.25),
			0 1.25rem 1rem rgba(0, 0, 0, 0.25);
		--knob-press:
			inset 0 0 2.4rem 1.6rem rgba(0, 0, 0, 0.16),
			inset 0 0.85rem 0.6rem rgba(0, 0, 0, 0.28),
			inset 0 2.2rem 1.1rem rgba(0, 0, 0, 0.13),
			0 -0.2rem 0.2rem rgba(0, 0, 0, 0.13),
			0 0.22rem 0.22rem rgba(255, 255, 255, 0.55);
		--ink-engrave: #c0bbb0;
		--emboss-sh: rgba(0, 0, 0, 0.25);
		--emboss-hl: rgba(255, 255, 255, 0.85);
	}

	.c-button {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 6rem;
		width: 6rem;
		padding: 0;
		border: 0;
		border-radius: 1.4rem;
		cursor: pointer;
		background: var(--knob-bg);
		transition: box-shadow 150ms ease-out, background 150ms ease-out;
		box-shadow: var(--knob-shadow);
	}

	/* Active = the knob is gone; only the empty toggle TRACK remains (transparent
	   surface + recessed groove). The cut-out text's light switches on. */
	.c-button.active {
		background: transparent;
		box-shadow: var(--knob-press);
	}

	/* Icon + label are CUT into the knob — engraved (inverse of a raised bump:
	   shadow top-left, highlight bottom-right), reading as the switched-OFF
	   inside. When pressed, they light up (the knob's lamp turns on). */
	.c-button__icon {
		width: 1.65rem;
		height: 1.65rem;
		color: var(--ink-engrave);
		filter: drop-shadow(-0.07rem -0.07rem 0.13rem var(--emboss-sh))
			drop-shadow(0.07rem 0.07rem 0.12rem var(--emboss-hl));
		transition: filter 150ms ease-out, color 150ms ease-out;
	}
	.c-button__label {
		display: block;
		margin-top: 0.5rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--ink-engrave);
		filter: drop-shadow(-0.07rem -0.07rem 0.13rem var(--emboss-sh))
			drop-shadow(0.07rem 0.07rem 0.12rem var(--emboss-hl));
		transition: filter 150ms ease-out, color 150ms ease-out;
	}

	/* Active -> light source ON: the cut-out fills with its accent and glows. */
	.c-button.active .c-button__icon {
		color: var(--accent);
		filter: drop-shadow(0 0 0.5rem color-mix(in srgb, var(--accent) 65%, transparent))
			drop-shadow(0 0 0.18rem color-mix(in srgb, var(--accent) 60%, transparent));
	}
	.c-button.active .c-button__label {
		color: var(--accent);
		filter: drop-shadow(0 0 0.5rem color-mix(in srgb, var(--accent) 55%, transparent))
			drop-shadow(0 0 0.18rem color-mix(in srgb, var(--accent) 50%, transparent));
	}
</style>
