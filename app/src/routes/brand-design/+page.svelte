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

		/* Shared skeuomorphic shadow palette (same as the button grid) — dark */
		--surf: #1d2532;
		--sh: rgba(9, 14, 26, 0.55);
		--hl: rgba(120, 140, 180, 0.1);
		--sh-in: rgba(0, 0, 0, 0.55);
		--hl-in: rgba(255, 255, 255, 0.05);
		--emboss-sh: rgba(8, 13, 26, 0.85);
		--emboss-hl: rgba(125, 145, 185, 0.22);
		--nav-ink: #93a2b8;
	}
	.stage.is-light {
		background-color: #dedad3;
		color: #1d2532;

		--surf: #dedad3;
		--sh: rgba(163, 177, 198, 0.55);
		--hl: rgba(255, 255, 255, 0.92);
		--sh-in: rgba(0, 0, 0, 0.2);
		--hl-in: rgba(255, 255, 255, 0.7);
		--emboss-sh: rgba(163, 177, 198, 0.75);
		--emboss-hl: rgba(255, 255, 255, 0.95);
		--nav-ink: #6f6c63;
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
			-0.04rem -0.04rem 0.03rem var(--emboss-hl),
			0.07rem 0.07rem 0.08rem var(--emboss-sh);
		transition: box-shadow 150ms ease-out, background 150ms ease-out, color 150ms ease-out;
		box-shadow:
			0.5rem 0.5rem 1.3rem var(--sh),
			-0.45rem -0.45rem 1.1rem var(--hl),
			-0.1rem -0.1rem 0.18rem var(--hl);
	}

	/* Selected = pressed-in (recessed); label brightens to full contrast */
	.skeu-nav.active {
		color: inherit;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.03));
		box-shadow:
			inset 0.16rem 0.16rem 0.6rem var(--sh-in),
			inset 0.5rem 0.5rem 1.2rem var(--sh-in),
			inset -0.3rem -0.3rem 0.6rem var(--hl-in),
			0.1rem 0.1rem 0.4rem var(--sh);
	}
	.stage.is-light .skeu-nav.active {
		background: linear-gradient(to top, rgba(163, 177, 198, 0.1), rgba(255, 255, 255, 0.4));
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
