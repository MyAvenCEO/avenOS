<script lang="ts">
	import NeumorphicToggle from '$lib/brand-design/NeumorphicToggle.svelte'
	import { t } from '$lib/i18n'

	// Toggle drives the SURROUNDING surface (a real dark-mode switch).
	// Default = dark; checkbox checked = light "paper".
	let light = $state(false)

	const NOISE =
		"data:image/svg+xml,<svg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'><filter id='noiseFilter'><feTurbulence type='fractalNoise' baseFrequency='5' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/></svg>"
</script>

<svelte:head>
	<title>{t('nav.brandDesign')}{t('common.titleSuffix')}</title>
</svelte:head>

<div
	class="relative flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden transition-colors duration-300 ease-out"
	style="background-color: {light ? '#dedad3' : '#1d2532'};"
>
	<!-- Noise paper texture, stronger on the light surface (matches the reference) -->
	<div
		class="pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out"
		style="background-image: url('{NOISE}'); background-repeat: repeat; opacity: {light ? 0.8 : 0.4};"
		aria-hidden="true"
	></div>

	<header
		class="relative z-10 px-6 py-6 transition-colors duration-300 ease-out sm:px-8"
		style="color: {light ? '#1d2532' : '#dedad3'};"
	>
		<h1 class="text-2xl font-semibold tracking-tight">{t('nav.brandDesign')}</h1>
		<p class="mt-1 max-w-xl text-sm leading-relaxed" style="opacity: 0.65;">
			Skeuomorphism — paper-UI toggle. Tap the switch to flip the surrounding surface dark ↔ light.
		</p>
	</header>

	<div class="relative z-10 flex min-h-0 flex-1 items-center justify-center p-6">
		<NeumorphicToggle bind:light />
	</div>
</div>
