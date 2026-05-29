<script lang="ts">
	import { Canvas } from '@threlte/core'
	import AvenCityScene from './AvenCityScene.svelte'
</script>

<div class="avencity-root">
	<Canvas>
		<AvenCityScene />
	</Canvas>
</div>

<style>
	.avencity-root {
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
		background: var(--color-surface-cream, #f8f6ef);
	}
</style>
