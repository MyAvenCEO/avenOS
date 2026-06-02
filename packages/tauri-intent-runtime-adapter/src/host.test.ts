import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAvenSqliteDatabase } from 'typed-actors'
import { shouldResetPersistedIntentRuntimeState } from './host.ts'

function seedActorsDb(stateDir: string, actors: Array<{ id: string; kind: string; state: Record<string, unknown> }>) {
  mkdirSync(stateDir, { recursive: true })
  const db = openAvenSqliteDatabase(join(stateDir, 'aven-runtime.db'))
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        parent_id TEXT,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const now = new Date().toISOString()
    const statement = db.prepare(
      'INSERT INTO actors (id, kind, parent_id, status, version, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const actor of actors) {
      statement.run(
        actor.id,
        actor.kind,
        actor.id.includes('/') ? actor.id.split('/').slice(0, -1).join('/') || null : null,
        'running',
        1,
        JSON.stringify({
          id: actor.id,
          kind: actor.kind,
          status: 'running',
          version: 1,
          state: actor.state,
        }),
        now,
        now,
      )
    }
  } finally {
    db.close()
  }
}

describe('shouldResetPersistedIntentRuntimeState', () => {
  it('detects the broken persisted bootstrap snapshot', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'tauri-intent-runtime-broken-'))
    try {
      seedActorsDb(stateDir, [
        {
          id: '/aven/intents',
          kind: 'intents',
          state: {
            nextIntentNumber: 1,
            nextRouteClarificationNumber: 1,
            nextSemanticRouteRequestNumber: 1,
            intentIds: [],
            routingCardsByIntentId: {},
            pendingRouteClarificationsById: {},
            pendingSemanticRouteRequestsById: {},
            configuration: {},
          },
        },
        {
          id: '/aven/system/llms',
          kind: 'llms',
          state: {
            ready: true,
            catalog: [],
            usageByCallerActorId: {},
            pendingRequests: {},
          },
        },
      ])

      expect(shouldResetPersistedIntentRuntimeState(stateDir)).toBe(true)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it('keeps healthy persisted state', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'tauri-intent-runtime-healthy-'))
    try {
      seedActorsDb(stateDir, [
        {
          id: '/aven/intents',
          kind: 'intents',
          state: {
            configuration: {
              runtime: {
                planner: {
                  requirements: {
                    input: { modalities: ['text'] },
                    output: { modalities: ['text'] },
                  },
                },
              },
            },
          },
        },
        {
          id: '/aven/system/llms',
          kind: 'llms',
          state: {
            ready: true,
            catalog: [{ providerId: 'openai', modelId: 'gpt-4.1' }],
            usageByCallerActorId: {},
            pendingRequests: {},
          },
        },
        {
          id: '/aven/system/llms/openai',
          kind: 'llmProvider',
          state: {
            providerId: 'openai',
            modelIds: ['gpt-4.1'],
          },
        },
      ])

      expect(shouldResetPersistedIntentRuntimeState(stateDir)).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})