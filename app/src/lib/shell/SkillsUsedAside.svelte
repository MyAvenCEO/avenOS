<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import type { Flow } from '@avenos/aven-skills'
import { listFlows } from '$lib/data/client'
import StatusCard from '$lib/intents/StatusCard.svelte'

// board 0118f/0119c — the LEFT ASIDE: ALL available skills, always (the flows read-model IS the
// skill list), in the intents design language. Recently used skills float to the top carrying
// their live status (running/success/error + time); the rest sit quiet below. Clicking a row pins
// that skill's flow into the right aside AND enters its default view (the manifest).

export type SkillUse = {
	skill: string
	at: number
	status: 'running' | 'success' | 'error'
	detail?: string
}

let {
	uses,
	selectedSkill,
	onSelect
}: {
	uses: SkillUse[]
	selectedSkill: string | null
	onSelect: (skill: string) => void
} = $props()

const flowsQuery = createQuery(() => ({ queryKey: ['flows'], queryFn: listFlows }))
const allSkills = $derived<Flow[]>((flowsQuery.data ?? []) as Flow[])

type Row = { skill: string; name: string; use: SkillUse | null }
const rows = $derived.by((): Row[] => {
	const byId = new Map(allSkills.map((f) => [f.id, f]))
	const used: Row[] = uses
		.filter((u) => byId.has(u.skill))
		.map((u) => ({ skill: u.skill, name: String(byId.get(u.skill)?.name ?? u.skill), use: u }))
	const usedIds = new Set(used.map((r) => r.skill))
	const rest: Row[] = allSkills
		.filter((f) => !usedIds.has(f.id))
		.map((f) => ({ skill: f.id, name: String(f.name ?? f.id), use: null }))
	return [...used, ...rest]
})

const timeOf = (at: number): string =>
	new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

{#if rows.length > 0}
	<aside
		class="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-60 flex-col pt-3 pb-40 pl-2 md:flex"
	>
		<div class="flex items-center gap-1.5 px-1 pb-1.5">
			<span class="text-foreground/40 text-[8px] font-bold tracking-[0.18em] uppercase">
				Skills
			</span>
		</div>
		<div class="pointer-events-auto flex min-h-0 flex-col gap-1.5 overflow-y-auto">
			{#each rows as r (r.skill)}
				<StatusCard
					status={'archived'}
					totalSeconds={0}
					title={r.name}
					description={r.use ? (r.use.detail ?? timeOf(r.use.at)) : ''}
					selected={selectedSkill === r.skill}
					showTimer={true}
					onclick={() => onSelect(r.skill)}
					skillRow={true}
					extraClass="w-full"
				/>
			{/each}
		</div>
	</aside>
{/if}
