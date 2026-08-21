<script lang="ts">
import { skillDetailHref, skillLabel } from '$lib/skills/loader'
import type { AvenosSkill } from '$lib/skills/types'

type Props = {
	skill: AvenosSkill
	variant?: 'default' | 'spotlight'
}

let { skill, variant = 'default' }: Props = $props()

const cardClass = $derived.by(() =>
	skill.comingSoon
		? 'group flex min-w-0 flex-col rounded-2xl border-2 border-dashed border-quiet/55 bg-surface-soft/70 p-5 opacity-85 transition-all hover:border-quiet/80 hover:opacity-100 sm:p-6'
		: variant === 'spotlight'
			? 'group flex min-w-0 flex-col rounded-2xl border-2 border-accent/35 bg-surface-raised p-6 ring-1 ring-accent/15 shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all hover:border-accent/55  sm:p-7'
			: 'group flex min-w-0 flex-col rounded-2xl border border-border/40 bg-surface-raised p-5 transition-all hover:border-border/70 hover:bg-surface-soft  sm:p-6'
)

const chainLabels: Record<string, string> = {
	'email-manager': 'E‑Mail',
	'docs-organizer': 'Dokumente',
	'brain-memorizer': 'Gedächtnis',
	'book-keeper': 'Buchhaltung',
	'human-reviewer': 'HITL',
	'blog-writer': 'Content',
	'calendar-organizer': 'Kalender',
	'todo-shuffler': 'Aufgaben',
	'inbox-router': 'Eingang',
	'bookmark-champion': 'Links'
}
</script>

<a
	href={skillDetailHref(skill.slug, 'de')}
	class={cardClass}
	aria-label={`${skillLabel(skill.slug)} — ${skill.oneLineCopy}`}
>
	<div class="flex items-start justify-between gap-3">
		<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
			{skill.publisher.displayName}
		</p>
		<span
			class="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] {skill.comingSoon
				? 'border-quiet/35 bg-quiet/10 text-quiet-ink'
				: 'border-accent/40 bg-accent/20 text-accent-ink'}"
		>
			{skill.comingSoon ? 'Bald' : 'Skill'}
		</span>
	</div>

	<h3 class="mt-3 text-[15px] font-bold tracking-[0.06em] text-foreground sm:text-[16px]">
		{skillLabel(skill.slug)}
	</h3>

	<p class="mt-2 text-[14px] font-medium leading-snug text-foreground/82 sm:text-[15px]">
		{skill.oneLineCopy}
	</p>

	<p class="mt-3 text-[13px] italic leading-snug text-foreground/58 sm:text-[14px]">
		"{skill.founderScenario.timestamp}
		— {skill.founderScenario.story.slice(0, 100)}&hellip;"
	</p>

	<div class="mt-4 flex flex-wrap gap-1.5">
		{#each skill.playsWith as { slug } (slug)}
			<span
				class="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-2 py-0.5 text-[9px] font-semibold text-foreground/50"
			>
				→ {chainLabels[slug] ?? slug}
			</span>
		{/each}
	</div>

	<div class="mt-5 flex items-center justify-between border-t border-border/30 pt-4">
		<div>
			<p class="text-[9px] font-bold uppercase tracking-[0.2em] text-accent-ink">
				{skill.hero.promiseHoursPerWeek}
				gespart
			</p>
		</div>
		<span
			class="text-[12px] font-semibold text-foreground/55 transition-colors group-hover:text-foreground/80"
		>
			Skill ansehen →
		</span>
	</div>
</a>
