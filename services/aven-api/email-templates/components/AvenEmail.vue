<script setup lang="ts">
defineProps({
	preheader: { type: String, default: '' }
})
</script>

<template>
	<Layout lang="en" body-class="m-0 bg-[#f8f6ef] py-10 font-sans text-[#1f2a3d]">
		<Preheader v-if="preheader">{{ preheader }}</Preheader>
		<Container class="mx-auto max-w-xl">
			<Section class="px-8 pb-4">
				<Text class="m-0 text-[15px] font-semibold tracking-[-0.02em] text-[#1e293b]">avenCEO</Text>
			</Section>
			<Section class="overflow-hidden rounded-3xl border border-solid border-[#e2ddd0] bg-[#fffdf7] px-8 py-8">
				<slot />
			</Section>
			<Section class="px-8 pt-5">
				<Text class="m-0 text-[11px] uppercase leading-4 tracking-[0.08em] text-[#76808f]">
					A service message from avenCEO
				</Text>
			</Section>
			<AvenFooter />
		</Container>
	</Layout>
</template>
