<script lang="ts">
	import type { ActorLogRecord } from './types'
	import ActorEventLog from './ActorEventLog.svelte'
	import ContextAppendedLog from './ContextAppendedLog.svelte'
	import ActorIoInboundLog from './ActorIoInboundLog.svelte'
	import ActorIoOutboundLog from './ActorIoOutboundLog.svelte'
	import ActorIoPromptLog from './ActorIoPromptLog.svelte'
	import ActorIoShellLog from './ActorIoShellLog.svelte'
	import IntentCreatedLog from './IntentCreatedLog.svelte'
	import IntentMessageToUserLog from './IntentMessageToUserLog.svelte'
	import IntentSkillCallCompletedLog from './IntentSkillCallCompletedLog.svelte'
	import IntentSkillCallStartedLog from './IntentSkillCallStartedLog.svelte'
	import IntentStatusChangedLog from './IntentStatusChangedLog.svelte'
	import RuntimeEnvelopeClaimedLog from './RuntimeEnvelopeClaimedLog.svelte'
	import RuntimeEnvelopeCompletedLog from './RuntimeEnvelopeCompletedLog.svelte'
	import RuntimeEnvelopeFailedLog from './RuntimeEnvelopeFailedLog.svelte'
	import RuntimeEnvelopeQueuedLog from './RuntimeEnvelopeQueuedLog.svelte'
	import SkillWorkerCompletedLog from './SkillWorkerCompletedLog.svelte'
	import SkillWorkerRoutedLog from './SkillWorkerRoutedLog.svelte'
	import SkillWorkerSpawnedLog from './SkillWorkerSpawnedLog.svelte'

	let { event }: { event: ActorLogRecord } = $props()
</script>

{#if event.type === 'actor.event'}
	<ActorEventLog {event} />
{:else if event.type === 'context.appended'}
	<ContextAppendedLog {event} />
{:else if event.type === 'actor.io.inbound'}
	<ActorIoInboundLog {event} />
{:else if event.type === 'actor.io.outbound'}
	<ActorIoOutboundLog {event} />
{:else if event.type === 'actor.io.prompt'}
	<ActorIoPromptLog {event} />
{:else if event.type === 'actor.io.shell'}
	<ActorIoShellLog {event} />
{:else if event.type === 'intent.created'}
	<IntentCreatedLog {event} />
{:else if event.type === 'intent.message_to_user'}
	<IntentMessageToUserLog {event} />
{:else if event.type === 'intent.skill_call_completed'}
	<IntentSkillCallCompletedLog {event} />
{:else if event.type === 'intent.skill_call_started'}
	<IntentSkillCallStartedLog {event} />
{:else if event.type === 'intent.status_changed'}
	<IntentStatusChangedLog {event} />
{:else if event.type === 'runtime.envelope.claimed'}
	<RuntimeEnvelopeClaimedLog {event} />
{:else if event.type === 'runtime.envelope.completed'}
	<RuntimeEnvelopeCompletedLog {event} />
{:else if event.type === 'runtime.envelope.failed'}
	<RuntimeEnvelopeFailedLog {event} />
{:else if event.type === 'runtime.envelope.queued'}
	<RuntimeEnvelopeQueuedLog {event} />
{:else if event.type === 'skill.worker_completed'}
	<SkillWorkerCompletedLog {event} />
{:else if event.type === 'skill.worker_routed'}
	<SkillWorkerRoutedLog {event} />
{:else if event.type === 'skill.worker_spawned'}
	<SkillWorkerSpawnedLog {event} />
{/if}