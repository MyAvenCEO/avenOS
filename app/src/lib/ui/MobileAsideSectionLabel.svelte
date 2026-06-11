<script lang="ts">
import type { Snippet } from 'svelte'
import { mobileAsideSectionLabelClass, mobileAsideTextAlignClass } from './mobile-aside'

type Props = {
	align?: 'left' | 'right'
	class?: string
	children: Snippet
}

let { align = 'left', class: className = '', children }: Props = $props()
</script>

<p
	class="{mobileAsideSectionLabelClass} max-md:text-center {mobileAsideTextAlignClass(align)} {className}"
>
	{@render children()}
</p>
