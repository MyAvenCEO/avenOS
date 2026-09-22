<script lang="ts">
/**
 * CHAT DEBUG — the latest answer request prepared by the chat core.
 *
 * `chat.lastRequest` is captured in `Chat.#round` at send time (system
 * prompt + live context, bounded message history, tool set). This is not
 * a reconstruction, but excludes gateway/provider transformations and separate
 * verification requests. The view updates per answer round, including tool rounds.
 */
import { chatActor } from '$lib/actors/chat.actor.svelte'
import type { ChatMessage } from './redpill'

const chat = chatActor.core
const request = $derived(chat.lastRequest)

const ROLE_TONE: Record<string, string> = {
	system: 'bg-progress/15 text-progress',
	user: 'bg-success/15 text-success',
	assistant: 'bg-primary/15 text-primary',
	tool: 'bg-warning/15 text-warning'
}

function toolCallsOf(message: ChatMessage) {
	return message.tool_calls ?? []
}
</script>

<div class="flex flex-col gap-4">
	<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="font-semibold text-lg leading-tight">Chat debug</h1>
		{#if request}
			<p class="font-mono text-[length:var(--fs-eyebrow)] text-foreground/50">
				{request.session}
				· {new Date(request.at).toLocaleString()} ·
				{request.messages.length}
				messages · {request.tools.length} tools
			</p>
		{/if}
	</header>

	{#if !request}
		<p class="text-foreground/65 text-sm">
			No answer request captured yet. Send a message to inspect the prepared system context,
			included messages and available tools.
		</p>
	{:else}
		<p class="text-foreground/65 text-sm">
			Latest answer round only: included context and tools, not the entire saved conversation.
			Separate verification requests and provider-specific transformations are not shown here.
		</p>
		<!-- SYSTEM: prompt + live context, the part you cannot see anywhere else. -->
		{@const system = request.messages[0]}
		{#if system}
			<section>
				<p
					class="pb-1 font-mono text-[length:var(--fs-eyebrow)] uppercase tracking-wide text-foreground/50"
				>
					system · prompt + live context
				</p>
				<pre
					class="border-border border-foreground/8 overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-surface-sunken px-4 py-3 font-mono text-[length:var(--fs-eyebrow)] leading-relaxed text-foreground/80"
				>{system.content}</pre>
			</section>
		{/if}

		<!-- HISTORY: every message of the wire, in order, tool lane included. -->
		<section>
			<p
				class="pb-1 font-mono text-[length:var(--fs-eyebrow)] uppercase tracking-wide text-foreground/50"
			>
				messages · {request.messages.length - 1}
			</p>
			<div class="flex flex-col gap-2">
				{#each request.messages.slice(1) as message, index (index)}
					<div class="surface surface--sunken" data-request-message-index={index}>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-full px-2 py-0.5 font-mono text-[length:var(--fs-nano)] {ROLE_TONE[message.role] ?? 'bg-foreground/8 text-foreground'}"
							>
								{message.role}
							</span>
							{#if message.tool_call_id}
								<span class="font-mono text-[length:var(--fs-nano)] text-foreground/40"
									>→ {message.tool_call_id}</span
								>
							{/if}
						</div>
						{#if message.content !== ''}
							<pre
								class="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--fs-eyebrow)] leading-relaxed text-foreground/80"
							>{message.content}</pre>
						{/if}
						{#each toolCallsOf(message) as call (call.id)}
							<div
								class="border-border border-foreground/8 mt-2 rounded-md bg-surface-raised px-3 py-2"
							>
								<p class="font-mono text-[length:var(--fs-eyebrow)] text-foreground">
									{call.function.name}
									<span class="text-foreground/40">· {call.id}</span>
								</p>
								<pre
									class="mt-1 whitespace-pre-wrap break-words font-mono text-[length:var(--fs-nano)] leading-relaxed text-foreground/65"
								>{call.function.arguments}</pre>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</section>

		<!-- TOOLS: the exact specs the model was told about. -->
		<section>
			<p
				class="pb-1 font-mono text-[length:var(--fs-eyebrow)] uppercase tracking-wide text-foreground/50"
			>
				tools · {request.tools.length}
			</p>
			<div class="flex flex-col gap-2">
				{#each request.tools as tool (tool.name)}
					<div class="surface surface--sunken">
						<p class="font-mono text-[length:var(--fs-eyebrow)] text-foreground">{tool.name}</p>
						<p class="pt-1 text-foreground/65 text-xs">{tool.description}</p>
						<pre
							class="border-border border-foreground/8 mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-raised px-3 py-2 font-mono text-[length:var(--fs-nano)] leading-relaxed text-foreground/65"
						>{JSON.stringify(tool.parameters, null, 2)}</pre>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
