<script setup lang="ts">
const { email } = useConfig()
</script>

<template>
	<AvenEmail :preheader="`Continue securing ${email.name}.aven.ceo`">
		<Heading class="m-0 text-2xl font-semibold leading-8 text-slate-950">
			Your avenID is ready
		</Heading>
		<Text class="mt-4 text-base leading-6 text-slate-600">
			Continue to checkout to secure <strong>{{ email.name }}.aven.ceo</strong>.
		</Text>
		<Button
			:href="email.claimUrl"
			class="mt-6 box-border rounded-lg bg-slate-950 px-6 py-4 text-base font-semibold text-white no-underline"
		>
			Continue to checkout
		</Button>
		<Text class="mt-6 text-sm leading-5 text-slate-500">
			This link expires {{ email.expiresAt }}.
		</Text>
	</AvenEmail>
</template>
