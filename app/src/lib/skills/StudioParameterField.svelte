<script lang="ts">
import Field from './StudioParameterField.svelte'

let {
	name,
	schema,
	value,
	onchange
}: {
	name: string
	schema: Record<string, any>
	value: unknown
	onchange: (value: unknown) => void
} = $props()
const rows = $derived(Array.isArray(value) ? value : [])
const object = $derived(
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
)
const blank = (s: Record<string, any>): unknown =>
	s.type === 'object' ? {} : s.type === 'array' ? [] : s.type === 'boolean' ? false : ''
const requiredFields = $derived(
	Object.entries(schema.properties ?? {}).filter(([key]) => (schema.required ?? []).includes(key))
)
const optionalFields = $derived(
	Object.entries(schema.properties ?? {}).filter(([key]) => !(schema.required ?? []).includes(key))
)
function changeField(key: string, next: unknown) {
	const updated = { ...object }
	if (!(schema.required ?? []).includes(key) && (next === undefined || next === ''))
		delete updated[key]
	else updated[key] = next
	onchange(updated)
}
</script>

{#snippet objectField(key: string, property: unknown)}
	<div>
		<span>{key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ')}</span>
		<Field
			name={`${name} ${key}`}
			schema={property as Record<string, any>}
			value={object[key]}
			onchange={next => changeField(key, next)}
		/>
	</div>
{/snippet}

{#if schema.type === 'array'}
	<div class="collection">
		{#each rows as row, index}
			<details name={`setting-${name}`} open={index === rows.length - 1}>
				<summary>Item {index + 1}</summary>
				<Field
					name={`${name} ${index + 1}`}
					schema={schema.items}
					value={row}
					onchange={next => onchange(rows.map((v, i) => i === index ? next : v))}
				/>
				<button
					class="remove"
					type="button"
					onclick={() => onchange(rows.filter((_, i) => i !== index))}
				>
					Remove item {index + 1}
				</button>
			</details>
		{/each}
		<button
			type="button"
			disabled={rows.length >= Number(schema.maxItems ?? 16)}
			onclick={() => onchange([...rows, blank(schema.items)])}
		>
			＋ Add item
		</button>
	</div>
{:else if schema.type === 'object'}
	<div class="object">
		{#each (requiredFields.length ? requiredFields : optionalFields) as [key, property]}
			{@render objectField(key, property)}
		{/each}
		{#if requiredFields.length && optionalFields.length}
			<details>
				<summary>
					More settings · {optionalFields.filter(([key]) => object[key] !== undefined).length} set
				</summary>
				<div class="object">
					{#each optionalFields as [key, property]}
						{@render objectField(key, property)}
					{/each}
				</div>
			</details>
		{/if}
	</div>
{:else if Array.isArray(schema.enum)}
	<select
		aria-label={`Setting ${name}`}
		value={value ?? ''}
		onchange={event => onchange(schema.enum.find((choice: unknown) => String(choice) === event.currentTarget.value))}
	>
		<option value="">Choose…</option>
		{#each schema.enum as choice}
			<option value={String(choice)}>{choice === ' ' ? 'Space' : String(choice)}</option>
		{/each}
	</select>
{:else if schema.type === 'boolean'}
	<select
		aria-label={`Setting ${name}`}
		value={value === undefined ? '' : String(value)}
		onchange={event => onchange(event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'true')}
	>
		<option value="">Choose…</option>
		<option value="true">Yes</option>
		<option value="false">No</option>
	</select>
{:else if schema.type === 'integer' || schema.type === 'number'}
	<input
		type="number"
		aria-label={`Setting ${name}`}
		value={typeof value === 'number' ? value : ''}
		min={schema.minimum}
		max={schema.maximum}
		step={schema.type === 'integer' ? 1 : 'any'}
		oninput={event => onchange(event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))}
	>
{:else if Number(schema.maxLength) > 1024}
	<textarea
		aria-label={`Setting ${name}`}
		rows="3"
		maxlength={schema.maxLength}
		value={String(value ?? '')}
		oninput={event => onchange(event.currentTarget.value)}
	></textarea>
{:else}
	<input
		aria-label={`Setting ${name}`}
		value={String(value ?? '')}
		maxlength={Number(schema.maxLength ?? 1024)}
		oninput={event => onchange(event.currentTarget.value)}
	>
{/if}

<style>
input,
textarea,
select {
	font: inherit;
	width: 100%;
	min-width: 0;
	border: 1px solid var(--color-border);
	border-radius: 10px;
	padding: 10px;
	background: var(--color-surface-raised, #fffdf8);
	color: inherit;
}
textarea {
	resize: vertical;
	max-height: 220px;
}
.collection,
.object {
	display: grid;
	gap: 10px;
	min-width: 0;
}
.object > div {
	display: grid;
	gap: 5px;
}
.object span {
	font-size: 12px;
	color: var(--color-muted-foreground);
}
details {
	border: 1px solid var(--color-border);
	padding: 10px;
	border-radius: 12px;
}
summary {
	cursor: pointer;
	margin-bottom: 8px;
	font-size: 12px;
}
button {
	cursor: pointer;
	justify-self: start;
	padding: 6px 10px;
	font-size: 12px;
	border-radius: 8px;
	background: var(--color-surface-selected);
}
button:disabled {
	opacity: 0.4;
	cursor: default;
}
.remove {
	background: transparent;
	margin-top: 6px;
}
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
button:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 2px;
}
</style>
