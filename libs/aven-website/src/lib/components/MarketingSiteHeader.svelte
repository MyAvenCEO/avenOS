<script lang="ts">
type NavActive = 'skills' | 'pricing'

let {
	active = null,
	maxWidth = '5xl'
}: {
	active?: NavActive | null
	maxWidth?: '5xl' | '6xl'
} = $props()

const maxW = maxWidth === '6xl' ? 'max-w-6xl' : 'max-w-5xl'

function linkCls(isActive: boolean) {
	return isActive ? 'opacity-100 transition-opacity' : 'transition-opacity hover:opacity-100'
}
</script>

<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
	<div
		class="mx-auto flex {maxW} flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8"
	>
		<a href="/" class="text-[17px] font-light tracking-[-0.01em] opacity-85 hover:opacity-100">
			avenCEO
		</a>
		<nav
			class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70"
		>
			<a href="/skills" class={linkCls(active === 'skills')}>Skills</a>
			<a href="/pricing" class={linkCls(active === 'pricing')}>Preise</a>
			<a
				href="/waitlist"
				class="rounded-full bg-primary px-4 py-1.5 normal-case font-semibold text-primary-foreground transition-opacity hover:opacity-90"
			>
				Sichere dir deinen Aven
			</a>
		</nav>
	</div>
</header>
