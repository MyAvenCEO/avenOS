<script lang="ts">
import type { SocialProfile } from '$lib/social'

/** One Phosphor-duotone social glyph, colored via currentColor, sized via class. */
let { profile, class: cls = 'size-4' }: { profile: SocialProfile; class?: string } = $props()
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 256 256"
	fill="currentColor"
	aria-hidden="true"
	class={cls}
>
	<path d={profile.dim} opacity=".2" />
	<path d={profile.solid} />
</svg>
