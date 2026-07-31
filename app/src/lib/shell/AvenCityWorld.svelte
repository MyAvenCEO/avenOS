<script lang="ts">
import { AvenCityGame } from '@avenos/aven-city'
import { t } from '$lib/i18n'
import { clearNetwork } from '$lib/settings/network-store'

/**
 * avenCITY as an avenOS world.
 *
 * The game renders full-screen and owns everything inside it, so this wrapper
 * adds exactly one thing: the way out. Abagana and Alberobello reach the Select
 * Network intro through their logout, but avenCITY has no session to end —
 * without this button the world would be a one-way door.
 *
 * It sits under the game's own "avenCITY / world N" pill and borrows the HUD
 * styling so it reads as part of the world rather than app chrome bolted on.
 */
</script>

<AvenCityGame />

<button
	type="button"
	class="hud-pill hud-btn hud-label pointer-events-auto fixed top-[4.25rem] left-5 z-[110] md:top-[4.75rem] md:left-7"
	onclick={() => clearNetwork()}
>
	← {t('networkSelect.kicker')}
</button>
