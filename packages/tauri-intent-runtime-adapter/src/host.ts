import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createAvenSystem, ActorKind } from 'runtime'
import { ActorId, openAvenSqliteDatabase, SqliteActorPersistence } from 'typed-actors'
import { SqliteArtifactStorage } from 'artifacts'
import type { AvenSystem } from 'runtime'
import type { JsonValue } from 'typed-actors'
import type { RequestResult } from 'runtime'
import type { IntentsRouterState, IntentActorState } from '../../intents/src/actors/intent/types.ts'
import type { HumanActorState } from '../../human/src/actors/human/types.ts'
import {
  projectIntent,
  projectSnapshot,
  type IntentProjection,
  type IntentRuntimeSnapshot,
} from './projections.ts'

export type AdapterEvent =
  | { kind: 'intents'; snapshot: IntentRuntimeSnapshot }
  | { kind: 'intent'; intentId: string; detail: IntentProjection }

export type AttachmentInput = {
  filename: string
  mediaRole?: string
  mimeType?: string
  bytesBase64: string
}

type PersistedActorRecord = {
  id?: string
  kind?: string
  state?: Record<string, unknown>
}

function persistedActorById(sqlitePath: string, actorId: string): PersistedActorRecord | undefined {
  if (!existsSync(sqlitePath)) return undefined
  const db = openAvenSqliteDatabase(sqlitePath)
  try {
    const row = db.prepare('SELECT data FROM actors WHERE id = ?').get(actorId) as { data?: string } | undefined
    if (!row?.data) return undefined
    return JSON.parse(row.data) as PersistedActorRecord
  } finally {
    db.close()
  }
}

function persistedLlmsChildCount(sqlitePath: string): number {
  if (!existsSync(sqlitePath)) return 0
  const db = openAvenSqliteDatabase(sqlitePath)
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM actors WHERE id LIKE '/aven/system/llms/%'")
      .get() as { count?: number } | undefined
    return typeof row?.count === 'number' ? row.count : 0
  } finally {
    db.close()
  }
}

export function shouldResetPersistedIntentRuntimeState(stateDir: string): boolean {
  const sqlitePath = join(stateDir, 'aven-runtime.db')
  if (!existsSync(sqlitePath)) return false

  try {
    const intents = persistedActorById(sqlitePath, '/aven/intents')
    const llms = persistedActorById(sqlitePath, '/aven/system/llms')
    const llmChildCount = persistedLlmsChildCount(sqlitePath)

    const runtimeConfig = intents?.state?.configuration
      && typeof intents.state.configuration === 'object'
      ? (intents.state.configuration as Record<string, unknown>).runtime
      : undefined
    const catalog = Array.isArray(llms?.state?.catalog) ? llms?.state?.catalog : undefined

    return intents !== undefined
      && llms !== undefined
      && runtimeConfig === undefined
      && catalog?.length === 0
      && llmChildCount === 0
  } catch {
    return false
  }
}

export class IntentRuntimeHost {
  private system!: AvenSystem
  private artifactStorage!: SqliteArtifactStorage
  private readonly stateDir: string

  constructor(stateDir: string) {
    this.stateDir = stateDir
  }

  private debug(message: string, extra?: unknown) {
    const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
    process.stderr.write(`[intent-runtime-host] ${message}${suffix}\n`)
  }

  async start(): Promise<void> {
    this.debug('start', { stateDir: this.stateDir, envConfig: process.env.AVEN_LLM_CONFIG ?? null })
    mkdirSync(this.stateDir, { recursive: true })
    if (shouldResetPersistedIntentRuntimeState(this.stateDir)) {
      this.debug('resetting broken persisted runtime state', { stateDir: this.stateDir })
      rmSync(this.stateDir, { recursive: true, force: true })
      mkdirSync(this.stateDir, { recursive: true })
    }
    const sqlitePath = join(this.stateDir, 'aven-runtime.db')
    const sqliteDb = openAvenSqliteDatabase(sqlitePath)
    this.artifactStorage = new SqliteArtifactStorage(sqliteDb)
    this.system = await createAvenSystem({
      sqliteDb,
      artifactStorage: this.artifactStorage,
      persistence: new SqliteActorPersistence(sqliteDb),
    })
    this.debug('system started')
  }

  async stop(): Promise<void> {
    this.debug('stop requested')
    if (this.system) {
      await this.system.stop()
    }
  }

  private async runAndReadRequestResult(requestId: string): Promise<RequestResult | undefined> {
    await this.system.runUntilIdle()
    const detail = await this.system.inspector.getActor(ActorId.parse('/aven/system/request-results'))
    const state = detail?.actor.state as { resultsByRequestId?: Record<string, RequestResult> } | undefined
    return state?.resultsByRequestId?.[requestId]
  }

  private async readHumanState(): Promise<HumanActorState | undefined> {
    const detail = await this.system.inspector.getActor(ActorId.parse('/aven/system/human'))
    return detail?.actor.state as HumanActorState | undefined
  }

  private async readRouterState(): Promise<IntentsRouterState> {
    const detail = await this.system.inspector.getActor(ActorId.parse('/aven/intents'))
    if (!detail) {
      throw new Error('Router actor /aven/intents not found')
    }
    return detail.actor.state as IntentsRouterState
  }

  private async readIntentState(intentId: string): Promise<IntentActorState | undefined> {
    const detail = await this.system.inspector.getActor(ActorId.parse(`/aven/intents/${intentId}`))
    return detail?.actor.state as IntentActorState | undefined
  }

  private async snapshot(): Promise<IntentRuntimeSnapshot> {
    const router = await this.readRouterState()
    const human = await this.readHumanState()
    const snapshot = await this.system.inspector.getSnapshot()
    return projectSnapshot(router, snapshot.actors, human)
  }

  private async intentDetail(intentId: string): Promise<IntentProjection | undefined> {
    const state = await this.readIntentState(intentId)
    if (!state) return undefined
    const human = await this.readHumanState()
    return projectIntent(state, human)
  }

  private async buildAttachmentRefs(attachments: AttachmentInput[] | undefined) {
    const refs: Array<Record<string, unknown>> = []
    for (const attachment of attachments ?? []) {
      const bytes = Buffer.from(attachment.bytesBase64, 'base64')
      const descriptor = await this.artifactStorage.putArtifact({
        bytes,
        filename: attachment.filename,
        declaredMimeType: attachment.mimeType,
      })
      refs.push({
        filename: attachment.filename,
        mediaRole: attachment.mediaRole ?? 'attachment',
        effectiveMimeType: descriptor.effectiveMimeType,
        ref: descriptor,
      })
    }
    return refs
  }

  async intentStatus() {
    return { ready: true }
  }

  async intentList() {
    return this.snapshot()
  }

  async intentGet(intentId: string) {
    return (await this.intentDetail(intentId)) ?? null
  }

  async intentStart(payload: {
    message: string
    attachments?: AttachmentInput[]
  }): Promise<{ result: JsonValue; events: AdapterEvent[] }> {
    this.debug('intentStart', { message: payload.message, attachmentCount: payload.attachments?.length ?? 0 })
    const requestId = `tauri-intent-start~${randomUUID()}`
    const attachments = await this.buildAttachmentRefs(payload.attachments)
    await this.system.send(
      { id: ActorId.parse('/aven/intents'), kind: ActorKind.Intents },
      {
        type: 'routeHumanMessage',
        requestId,
        replyTo: { actorId: '/aven/system/request-results', actorKind: ActorKind.RequestResults },
        message: payload.message,
        ...(attachments.length > 0 ? { attachments } : {}),
      } as never,
    )
    const result = await this.runAndReadRequestResult(requestId)
    if (!result) throw new Error('No request result recorded for intentStart')
    if (result.type === 'error') throw new Error(result.error.message)
    const value = result.value as Record<string, JsonValue>
    const intentId = typeof value.intentId === 'string' ? value.intentId : undefined
    if (intentId) {
      const recordRequestId = `tauri-record-started-intent~${randomUUID()}`
      await this.system.send(
        { id: ActorId.parse('/aven/system/human'), kind: ActorKind.Human },
        {
          type: 'recordStartedIntent',
          requestId: recordRequestId,
          replyTo: { actorId: '/aven/system/request-results', actorKind: ActorKind.RequestResults },
          intentId,
          decision: value.decision === 'matchedExisting' ? 'matchedExisting' : 'createdNew',
          message: payload.message,
          attachmentRefs: attachments.map((attachment) => ({
            filename: String(attachment.filename ?? 'attachment'),
            mediaRole: String(attachment.mediaRole ?? 'attachment'),
            ref: attachment.ref as JsonValue,
          })),
        } as never,
      )
      await this.runAndReadRequestResult(recordRequestId)
    }
    const snapshot = await this.snapshot()
    const detail = intentId ? await this.intentDetail(intentId) : undefined
    this.debug('intentStart completed', { requestId, intentId: intentId ?? null })
    return {
      result,
      events: [
        { kind: 'intents', snapshot },
        ...(intentId && detail ? [{ kind: 'intent' as const, intentId, detail }] : []),
      ],
    }
  }

  async intentRetrain(payload: {
    intentId: string
    communicationId: string
    feedback: string
    attachments?: AttachmentInput[]
  }): Promise<{ result: JsonValue; events: AdapterEvent[] }> {
    this.debug('intentRetrain', {
      intentId: payload.intentId,
      communicationId: payload.communicationId,
      feedbackPreview: payload.feedback.slice(0, 120),
      attachmentCount: payload.attachments?.length ?? 0,
    })
    const requestId = `tauri-intent-retrain~${randomUUID()}`
    const attachments = await this.buildAttachmentRefs(payload.attachments)
    const answer: Record<string, unknown> = { text: payload.feedback }
    if (attachments.length > 0) answer.attachments = attachments
    await this.system.send(
      { id: ActorId.parse('/aven/system/human'), kind: ActorKind.Human },
      {
        type: 'answerCommunication',
        requestId,
        replyTo: { actorId: '/aven/system/request-results', actorKind: ActorKind.RequestResults },
        communicationId: payload.communicationId,
        answer,
      } as never,
    )
    const result = await this.runAndReadRequestResult(requestId)
    if (!result) throw new Error('No request result recorded for intentRetrain')
    if (result.type === 'error') throw new Error(result.error.message)
    const snapshot = await this.snapshot()
    const detail = await this.intentDetail(payload.intentId)
    this.debug('intentRetrain completed', { requestId, intentId: payload.intentId })
    return {
      result,
      events: [
        { kind: 'intents', snapshot },
        ...(detail ? [{ kind: 'intent' as const, intentId: payload.intentId, detail }] : []),
      ],
    }
  }
}
