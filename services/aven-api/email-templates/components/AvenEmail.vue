<script setup lang="ts">
defineProps({
	preheader: { type: String, default: '' }
})
</script>

<template>
	<Layout lang="en" body-class="m-0 bg-slate-100 py-8 font-sans text-slate-900">
		<Preheader v-if="preheader">{{ preheader }}</Preheader>
		<Container class="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<Section class="border-b border-solid border-slate-200 px-8 py-6">
				<Text class="m-0 text-xl font-semibold tracking-tight text-slate-950">avenCEO</Text>
			</Section>
			<Section class="px-8 py-8">
				<slot />
			</Section>
			<Section class="border-t border-solid border-slate-200 px-8 py-5">
				<Text class="m-0 text-xs leading-5 text-slate-500">
					This is a service message from avenCEO.
				</Text>
			</Section>
		</Container>
	</Layout>
</template>
