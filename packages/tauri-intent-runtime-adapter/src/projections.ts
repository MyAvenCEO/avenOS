import type { JsonValue } from 'typed-actors'
import type { ActorInspectionRecord } from 'typed-actors/introspection/actor-inspector.js'
import type { IntentActorState, IntentsRouterState } from '../../intents/src/actors/intent/types.ts'
import type { HumanActorState } from '../../human/src/actors/human/types.ts'

export type IntentRuntimeStatus = 'working' | 'hitl' | 'success' | 'archived' | 'error'

export type HumanCommunicationProjection = {
  communicationId: string
  kind: string
  title?: string
  body?: string
  open: boolean
  payload: JsonValue
}

export type ActivityProjection = {
  id: string
  atMs: number
  skillName: string
  text: string
  data?: JsonValue
}

export type IntentListProjection = {
  id: string
  title: string
  summary: string
  resultMessage?: string
  status: IntentRuntimeStatus
  updatedAtMs: number
  lastWorkDurationMs?: number
  openCommunicationCount: number
}

export type IntentProjection = IntentListProjection & {
  body?: string
  openCommunication?: HumanCommunicationProjection
  artifactRefs: unknown[]
  logs: ActivityProjection[]
}

export type IntentRuntimeSnapshot = {
  intents: IntentListProjection[]
}

function isoToMs(value?: string): number {
  if (!value) return Date.now()
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : Date.now()
}

function toUiStatus(status: IntentActorState['status']): IntentRuntimeStatus {
  switch (status) {
    case 'waitingForHuman':
      return 'hitl'
    case 'completed':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'error'
    default:
      return 'working'
  }
}

function summarize(intent: IntentActorState): string {
  const resultMessage = successResultMessage(intent)
  if (resultMessage) return resultMessage
  const lastEvent = intent.timeline[intent.timeline.length - 1]
  if (lastEvent?.summary) return lastEvent.summary
  const input = intent.input as Record<string, unknown> | undefined
  const message = typeof input?.message === 'string' ? input.message.trim() : ''
  if (message) return message.length > 96 ? `${message.slice(0, 96)}…` : message
  return intent.goal.length > 96 ? `${intent.goal.slice(0, 96)}…` : intent.goal
}

function shellStdoutResultMessage(intent: IntentActorState): string | undefined {
  for (let index = intent.timeline.length - 1; index >= 0; index -= 1) {
    const data = intent.timeline[index]?.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue
    const record = data as Record<string, JsonValue>
    if (record.toolId !== 'shell.execute') continue
    const stdoutPreview = typeof record.stdoutPreview === 'string' ? record.stdoutPreview.trim() : ''
    if (stdoutPreview) return stdoutPreview
  }
  return undefined
}

function successResultMessage(intent: IntentActorState): string | undefined {
  if (intent.status !== 'completed') return undefined
  const shellStdout = shellStdoutResultMessage(intent)
  if (shellStdout) return shellStdout
  const genericSummaries = new Set([
    'Intent created',
    'Intent started',
    'Planner requested',
    'complete',
    'Intent completed',
  ])
  for (let index = intent.timeline.length - 1; index >= 0; index -= 1) {
    const summary = intent.timeline[index]?.summary?.trim()
    if (!summary || genericSummaries.has(summary) || summary.startsWith('toolrun~')) continue
    return summary
  }
  return undefined
}

function bodyFromInput(intent: IntentActorState): string | undefined {
  const input = intent.input as Record<string, unknown> | undefined
  const message = typeof input?.message === 'string' ? input.message.trim() : ''
  return message || undefined
}

function extractArtifactRefs(intent: IntentActorState): unknown[] {
  const input = intent.input as Record<string, unknown> | undefined
  const attachments = input?.attachments
  return Array.isArray(attachments) ? attachments : []
}

function actorNameFromTimelineEntry(entry: IntentActorState['timeline'][number]): string {
  const data = entry.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, JsonValue>
    if (typeof record.toolId === 'string') return record.toolId
    if (typeof record.communicationKind === 'string') return 'human'
  }
  return 'orchestrator'
}

function logsFromTimeline(intent: IntentActorState): ActivityProjection[] {
  return intent.timeline.map((entry) => ({
    id: entry.eventId,
    atMs: isoToMs(entry.createdAt),
    skillName: actorNameFromTimelineEntry(entry),
    text: entry.summary,
    ...(entry.data === undefined ? {} : { data: entry.data }),
  }))
}

function openCommunicationProjection(human: HumanActorState | undefined, communicationId?: string): HumanCommunicationProjection | undefined {
  if (!human || !communicationId) return undefined
  const communication = human.communicationsById[communicationId]
  if (!communication) return undefined
  return {
    communicationId: communication.communicationId,
    kind: communication.kind,
    title: communication.title,
    body: communication.body,
    open: communication.status === 'open',
    payload: communication as unknown as JsonValue,
  }
}

export function projectIntent(
  intent: IntentActorState,
  human?: HumanActorState,
): IntentProjection {
  const updatedAtMs = isoToMs(intent.timeline[intent.timeline.length - 1]?.createdAt)
  const openCommunication = openCommunicationProjection(human, intent.openCommunicationId)
  const resultMessage = successResultMessage(intent)
  return {
    id: intent.intentId,
    title: intent.title,
    summary: summarize(intent),
    ...(resultMessage === undefined ? {} : { resultMessage }),
    body: bodyFromInput(intent),
    status: toUiStatus(intent.status),
    updatedAtMs,
    openCommunicationCount: openCommunication?.open ? 1 : 0,
    openCommunication,
    artifactRefs: extractArtifactRefs(intent),
    logs: logsFromTimeline(intent),
  }
}

export function projectSnapshot(
  router: IntentsRouterState,
  actors: readonly ActorInspectionRecord[],
  human?: HumanActorState,
): IntentRuntimeSnapshot {
  const byId = new Map<string, IntentActorState>()
  for (const actor of actors) {
    if (actor.kind !== 'intent') continue
    byId.set(actor.id.split('/').at(-1) ?? actor.id, actor.state as IntentActorState)
  }
  const intents = router.intentIds.map((intentId) => {
    const actorState = byId.get(intentId)
    if (actorState) {
      const projection = projectIntent(actorState, human)
      return {
        id: projection.id,
        title: projection.title,
        summary: projection.summary,
        ...(projection.resultMessage === undefined ? {} : { resultMessage: projection.resultMessage }),
        status: projection.status,
        updatedAtMs: projection.updatedAtMs,
        openCommunicationCount: projection.openCommunicationCount,
        ...(projection.lastWorkDurationMs == null ? {} : { lastWorkDurationMs: projection.lastWorkDurationMs }),
      }
    }
    const card = router.routingCardsByIntentId[intentId]
    const updatedAtMs = isoToMs(card?.updatedAt)
    return {
      id: intentId,
      title: card?.title ?? intentId,
      summary: card?.routingSummary ?? 'Intent created',
      status: 'working' as const,
      updatedAtMs,
      openCommunicationCount: card?.openCommunicationId ? 1 : 0,
    }
  })
  return { intents }
}
