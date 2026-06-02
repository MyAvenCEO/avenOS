import { describe, expect, it } from 'bun:test'
import { projectIntent } from './projections.ts'
import type { IntentActorState } from '../../intents/src/actors/intent/types.ts'

function baseIntentState(): IntentActorState {
  return {
    intentId: 'intent~1',
    title: 'What time is it?',
    goal: 'What time is it?',
    input: { message: 'What time is it?' },
    requiresHumanVisibleResult: true,
    durable: false,
    queuedExternalInputs: [],
    status: 'completed',
    timeline: [],
    observations: [],
    humanAnswers: [],
    shellContext: { user: 'peter', home: '/home/peter', cwd: '/tmp', platform: 'linux' },
    selectedModels: { plannerRequirements: { input: { modalities: ['text'] }, output: { modalities: ['text'] } }, toolDefaults: {} },
    plannerSettings: { maxSteps: 8, maxPromptChars: 24000, maxObservationChars: 1500, toolCatalogMode: 'compact', includeFullSchemaOnValidationError: true },
    toolSettings: { maxRuns: 8, artifactReadMaxBytes: 4096, shellInlinePreviewChars: 1024 },
    currentStep: 2,
    cycleStep: 2,
    toolRuns: 1,
    cycleToolRuns: 1,
  }
}

describe('projectIntent', () => {
  it('prefers shell stdout preview over abstract completion labels', () => {
    const intent: IntentActorState = {
      ...baseIntentState(),
      timeline: [
        { eventId: 'event~1', type: 'created', createdAt: '2026-06-02T04:47:07.973Z', summary: 'Intent created' },
        { eventId: 'event~2', type: 'started', createdAt: '2026-06-02T04:47:07.973Z', summary: 'Intent started' },
        { eventId: 'event~3', type: 'plannerRequested', createdAt: '2026-06-02T04:47:07.973Z', summary: 'Planner requested' },
        {
          eventId: 'event~4',
          type: 'toolCompleted',
          createdAt: '2026-06-02T04:47:15.742Z',
          summary: 'toolrun~1',
          data: {
            type: 'shell.execute.completion',
            toolId: 'shell.execute',
            exitCode: 0,
            stdoutPreview: 'Tue Jun  2 04:47:15 CEST 2026',
            stderrPreview: '',
            timedOut: false,
            durationMs: 41,
          },
        },
        { eventId: 'event~5', type: 'plannerActionAccepted', createdAt: '2026-06-02T04:47:19.178Z', summary: 'complete' },
        { eventId: 'event~6', type: 'completed', createdAt: '2026-06-02T04:47:19.178Z', summary: 'Current Time from Shell' },
      ],
    }

    const projection = projectIntent(intent)
    expect(projection.resultMessage).toBe('Tue Jun  2 04:47:15 CEST 2026')
    expect(projection.summary).toBe('Tue Jun  2 04:47:15 CEST 2026')
  })
})