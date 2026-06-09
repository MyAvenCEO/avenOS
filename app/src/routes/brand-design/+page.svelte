<script lang="ts">
	import NeumorphicToggle from '$lib/brand-design/NeumorphicToggle.svelte'
	import SkeuButtons from '$lib/brand-design/SkeuButtons.svelte'
	import SkeuTodo from '$lib/brand-design/SkeuTodo.svelte'
	import { t } from '$lib/i18n'

	// The toggle drives the surrounding surface (a real dark-mode switch).
	let light = $state(false)
	type CompId = 'toggle' | 'todo' | 'buttons'
	let selected = $state<CompId>('toggle')

	const items: { id: CompId; label: string }[] = [
		{ id: 'toggle', label: 'Toggle' },
		{ id: 'todo', label: 'Todo item' },
		{ id: 'buttons', label: 'Buttons' },
	]

	const NOISE =
		"data:image/svg+xml,<svg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'><filter id='noiseFilter'><feTurbulence type='fractalNoise' baseFrequency='5' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/></svg>"
</script>

<svelte:head>
	<title>{t('nav.brandDesign')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="stage" class:is-light={light}>
	<div class="noise" style="background-image: url('{NOISE}'); opacity: {light ? 0.8 : 0.4};" aria-hidden="true"></div>

	<div class="layout">
		<!-- Skeuomorphic component selector -->
		<aside class="aside">
			<p class="aside-label">Components</p>
			<nav class="aside-nav">
				{#each items as item (item.id)}
					<button
						type="button"
						class="skeu-nav"
						class:active={selected === item.id}
						aria-current={selected === item.id ? 'page' : undefined}
						onclick={() => (selected = item.id)}
					>
						{item.label}
					</button>
				{/each}
			</nav>
		</aside>

		<main class="content">
			<header class="head">
				<h1>{t('nav.brandDesign')}</h1>
				<p>Skeuomorphism — paper-UI components. Pick one on the left; the toggle flips the surface.</p>
			</header>

			<div class="demo">
				{#if selected === 'toggle'}
					<NeumorphicToggle bind:light />
				{:else if selected === 'todo'}
					<SkeuTodo {light} />
				{:else if selected === 'buttons'}
					<SkeuButtons {light} />
				{/if}
			</div>
		</main>
	</div>
</div>

<style>
	.stage {
		position: relative;
		display: flex;
		flex: 1 1 0%;
		min-height: 30rem;
		min-width: 0;
		overflow: hidden;
		background-color: #1d2532;
		color: #dedad3;
		font-family: 'Chillax', sans-serif;
		transition: background-color 300ms ease-out, color 300ms ease-out;

		/* Shared skeuomorphic palette (same as the button grid) — mirrors the
		   toggle: BLACK shadows + WHITE highlights, not bluish. — dark */
		--surf: #1d2532;
		--sh: rgba(0, 0, 0, 0.5);
		--hl: rgba(255, 255, 255, 0.07);
		--emboss-sh: rgba(0, 0, 0, 0.48);
		--emboss-hl: rgba(255, 255, 255, 0.3);
		--nav-ink: #36435a;
		--nav-active-ink: #b3c0d2;
		--nav-glow: rgba(150, 180, 220, 0.42);
		--track-fill: rgba(0, 0, 0, 0.32);
		--track-top: rgba(0, 0, 0, 0.34);
		--track-deep: rgba(0, 0, 0, 0.24);
		--track-rim: rgba(0, 0, 0, 0.22);
		--track-glow: rgba(255, 255, 255, 0.07);
	}
	.stage.is-light {
		background-color: #dedad3;
		color: #1d2532;

		--surf: #dedad3;
		--sh: rgba(0, 0, 0, 0.16);
		--hl: rgba(255, 255, 255, 0.9);
		--emboss-sh: rgba(0, 0, 0, 0.2);
		--emboss-hl: rgba(255, 255, 255, 1);
		--nav-ink: #cec9bf;
		--nav-active-ink: #514d46;
		--nav-glow: rgba(255, 255, 255, 0.6);
		--track-fill: rgba(0, 0, 0, 0.1);
		--track-top: rgba(0, 0, 0, 0.2);
		--track-deep: rgba(0, 0, 0, 0.1);
		--track-rim: rgba(0, 0, 0, 0.12);
		--track-glow: rgba(255, 255, 255, 0.45);
	}
	.noise {
		position: absolute;
		inset: 0;
		background-repeat: repeat;
		pointer-events: none;
		transition: opacity 300ms ease-out;
	}

	.layout {
		position: relative;
		z-index: 1;
		display: flex;
		flex: 1 1 0%;
		min-width: 0;
		gap: 1.5rem;
		padding: 1.75rem;
	}

	.aside {
		flex-shrink: 0;
		width: 12rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.aside-label {
		margin: 0 0 0.25rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.5;
	}
	.aside-nav {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	/* Same skeuomorphic treatment as the general buttons: transparent surface,
	   raised neumorphic shadows, pressed-in when selected, embossed label. */
	.skeu-nav {
		appearance: none;
		border: 0;
		cursor: pointer;
		text-align: left;
		padding: 0.9rem 1.15rem;
		border-radius: 1.4rem;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		background: transparent;
		color: var(--nav-ink);
		text-shadow:
			-0.06rem -0.07rem 0.04rem var(--emboss-hl),
			0.07rem 0.08rem 0.11rem var(--emboss-sh);
		transition: box-shadow 150ms ease-out, background 150ms ease-out, color 150ms ease-out;
		box-shadow:
			0.5rem 0.5rem 1.3rem var(--sh),
			-0.45rem -0.45rem 1.1rem var(--hl),
			-0.1rem -0.1rem 0.18rem var(--hl);
	}

	/* Selected = physically pressed IN — recessed like the toggle's track.
	   The label lifts with a SOFT glow (not hard white), echoing the active
	   colour buttons. */
	.skeu-nav.active {
		color: var(--nav-active-ink);
		background: transparent;
		text-shadow: 0 0 0.5rem var(--nav-glow);
		box-shadow:
			inset 0 0 2.4rem 1.4rem var(--track-fill),
			inset 0 0.55rem 0.45rem var(--track-top),
			inset 0 1.1rem 0.7rem var(--track-deep),
			0 -0.2rem 0.2rem var(--track-rim),
			0 0.25rem 0.25rem var(--track-glow);
	}

	.content {
		display: flex;
		flex: 1 1 0%;
		min-width: 0;
		flex-direction: column;
	}
	.head h1 {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.head p {
		margin: 0.35rem 0 0;
		max-width: 34rem;
		font-size: 0.9rem;
		line-height: 1.5;
		opacity: 0.6;
	}
	.demo {
		display: flex;
		flex: 1 1 0%;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
</style>
