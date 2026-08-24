<script lang="ts">
import type { SocialProfile } from '$lib/social'

/** One Phosphor-duotone social glyph, colored via currentColor. */
let { profile, size = 16 }: { profile: SocialProfile; size?: number } = $props()
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 256 256"
	fill="currentColor"
	aria-hidden="true"
>
	<path d={profile.dim} opacity=".2" />
	<path d={profile.solid} />
</svg>
