<script lang="ts">
import StatusCard from '$lib/intents/StatusCard.svelte'
import type { CardStatus } from '$lib/intents/types'

// board 0118f — the LEFT ASIDE: the latest skills utilized (one row per skill, newest first) in the
// intents design language (left-strip StatusCards). Clicking a row pins that skill's flow into the
// right aside. Overlay — the main stage stays centered.

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

const label = (s: string): string => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const timeOf = (at: number): string =>
	new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const statusOf = (u: SkillUse): CardStatus =>
	u.status === 'running' ? 'running' : u.status === 'error' ? 'error' : 'success'
</script>

{#if uses.length > 0}
	<aside
		class="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-60 flex-col pt-3 pb-40 pl-2 md:flex"
	>
		<div class="flex items-center gap-1.5 px-1 pb-1.5">
			<span class="text-foreground/40 text-[8px] font-bold tracking-[0.18em] uppercase">
				Skills
			</span>
		</div>
		<div class="pointer-events-auto flex min-h-0 flex-col gap-1.5 overflow-y-auto">
			{#each uses as u (u.skill)}
				<StatusCard
					status={statusOf(u)}
					totalSeconds={0}
					title={label(u.skill)}
					description={u.detail ? u.detail : timeOf(u.at)}
					selected={selectedSkill === u.skill}
					archived={u.status !== 'running' && selectedSkill !== u.skill}
					onclick={() => onSelect(u.skill)}
					skillRow={true}
					extraClass="w-full"
				/>
			{/each}
		</div>
	</aside>
{/if}
