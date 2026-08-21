<script setup lang="ts">
const { email } = useConfig()
</script>

<template>
	<AvenEmail :preheader="`${email.name}.aven.ceo is yours`">
		<Heading class="m-0 text-2xl font-semibold leading-8 text-slate-950">
			Welcome to {{ email.name }}.aven.ceo
		</Heading>
		<Text class="mt-4 text-base leading-6 text-slate-600"> Your purchase is complete. </Text>
		<template v-if="email.accessUrl">
			<Text class="mt-4 text-base leading-6 text-slate-600">
				Create your passkey to sign in to avenOS without a password.
			</Text>
			<Button
				:href="email.accessUrl"
				class="mt-6 box-border rounded-lg bg-slate-950 px-6 py-4 text-base font-semibold text-white no-underline"
			>
				Create passkey
			</Button>
			<Text class="mt-6 text-sm leading-5 text-slate-500">
				This link works until a passkey is created.
			</Text>
		</template>
	</AvenEmail>
</template>
