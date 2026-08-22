<script lang="ts">
import SkillLanding from '$lib/components/SkillLanding.svelte'

let { data } = $props()
</script>

<SkillLanding skill={data.skill} />
