<script lang="ts">
import { skillDetailHref } from '$lib/skills/loader'
import type { AvenosSkill } from '$lib/skills/types'

type Props = {
	skill: AvenosSkill
	variant?: 'default' | 'spotlight'
}

let { skill, variant = 'default' }: Props = $props()

const cardClass =
	variant === 'spotlight'
		? 'group flex min-w-0 flex-col rounded-2xl border-2 border-tuscan-sun/35 bg-linear-to-br from-white/90 via-white/72 to-white/58 p-6 ring-1 ring-tuscan-sun/15 shadow-[0_14px_40px_-24px_rgb(0_0_0/0.35)] transition-all hover:border-tuscan-sun/55 hover:shadow-[0_18px_44px_-22px_rgb(0_0_0/0.4)] sm:p-7'
		: 'group flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 transition-all hover:border-border/70 hover:bg-white/70 hover:shadow-[0_8px_28px_-12px_rgb(0_0_0/0.22)] sm:p-6'

const chainLabels: Record<string, string> = {
	'email-ingestor': 'E‑Mail',
	'document-extractor': 'Dokumente',
	'brain-memorizer': 'Gedächtnis',
	'book-keeper': 'Buchhaltung',
	'human-reviewer': 'HITL',
	'blog-writer': 'Content',
	'golden-offer': 'Angebote'
}
</script>

<a
	href={skillDetailHref(skill.slug, 'de')}
	class={cardClass}
	aria-label={`${skill.slug} — ${skill.oneLineCopy}`}
>
	<div class="flex items-start justify-between gap-3">
		<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
			{skill.publisher.displayName}
		</p>
		<span
			class="inline-flex items-center rounded-full border border-tuscan-sun/40 bg-tuscan-sun/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-tuscan-sun"
		>
			Skill
		</span>
	</div>

	<h3 class="mt-3 font-mono text-[15px] font-bold tracking-[0.06em] text-foreground sm:text-[16px]">
		{skill.slug}
	</h3>

	<p class="mt-2 text-[14px] font-medium leading-snug text-foreground/82 sm:text-[15px]">
		{skill.oneLineCopy}
	</p>

	<p class="mt-3 font-serif text-[13px] italic leading-snug text-foreground/58 sm:text-[14px]">
		"{skill.founderScenario.timestamp}
		— {skill.founderScenario.story.slice(0, 100)}&hellip;"
	</p>

	<div class="mt-4 flex flex-wrap gap-1.5">
		{#each skill.playsWith as { slug } (slug)}
			<span
				class="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-2 py-0.5 font-mono text-[9px] font-semibold text-foreground/50"
			>
				→ {chainLabels[slug] ?? slug}
			</span>
		{/each}
	</div>

	<div class="mt-5 flex items-center justify-between border-t border-border/30 pt-4">
		<div>
			<p class="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-tuscan-sun">
				{skill.hero.promiseHoursPerWeek}
				gespart
			</p>
		</div>
		<span
			class="font-mono text-[12px] font-semibold text-foreground/55 transition-colors group-hover:text-foreground/80"
		>
			Skill ansehen →
		</span>
	</div>
</a>
