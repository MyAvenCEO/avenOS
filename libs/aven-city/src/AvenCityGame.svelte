<script lang="ts">
import { Canvas } from '@threlte/core'
import AvenCityHud from './AvenCityHud.svelte'
import AvenCityScene from './AvenCityScene.svelte'
import { HeartsLedger } from './ledger.svelte'

let { player = 'Alice' }: { player?: string } = $props()

const ledger = new HeartsLedger(player)
</script>

<div class="avencity-root">
	<Canvas>
		<AvenCityScene />
	</Canvas>
	<AvenCityHud {ledger} />
</div>

<style>
.avencity-root {
	position: relative;
	width: 100%;
	height: 100%;
	min-height: 0;
	min-width: 0;
	background: var(--color-surface-cream, #f8f6ef);
}
</style>
