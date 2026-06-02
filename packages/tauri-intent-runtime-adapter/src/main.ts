import { IntentRuntimeHost } from './host.ts'

type RequestEnvelope = {
  id: string
  op: 'intentStatus' | 'intentList' | 'intentGet' | 'intentStart' | 'intentRetrain'
  payload?: Record<string, unknown>
}

const stateDirArgIndex = process.argv.indexOf('--state-dir')
const stateDir = stateDirArgIndex >= 0 ? process.argv[stateDirArgIndex + 1] : '.avenos-intent-runtime'
const host = new IntentRuntimeHost(stateDir)

function emit(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function debug(message: string, extra?: unknown) {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
  process.stderr.write(`[intent-runtime-adapter] ${message}${suffix}\n`)
}

async function handle(request: RequestEnvelope) {
  debug('handle request', { id: request.id, op: request.op })
  switch (request.op) {
    case 'intentStatus':
      return { result: await host.intentStatus() }
    case 'intentList':
      return { result: await host.intentList() }
    case 'intentGet':
      return { result: await host.intentGet(String(request.payload?.intentId ?? '')) }
    case 'intentStart':
      return host.intentStart({
        message: String(request.payload?.message ?? ''),
        attachments: Array.isArray(request.payload?.attachments) ? (request.payload?.attachments as never) : undefined,
      })
    case 'intentRetrain':
      return host.intentRetrain({
        intentId: String(request.payload?.intentId ?? ''),
        communicationId: String(request.payload?.communicationId ?? ''),
        feedback: String(request.payload?.feedback ?? ''),
        attachments: Array.isArray(request.payload?.attachments) ? (request.payload?.attachments as never) : undefined,
      })
  }
}

async function main() {
  debug('startup', { argv: process.argv.slice(2), envConfig: process.env.AVEN_LLM_CONFIG ?? null })
  await host.start()
  debug('host started')
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        const request = JSON.parse(line) as RequestEnvelope
        const response = await handle(request)
        debug('request succeeded', { id: request.id, op: request.op })
        emit({ id: request.id, ok: true, result: response.result })
        for (const event of response.events ?? []) {
          debug('emit event', event)
          emit({ event })
        }
      } catch (error) {
        debug('request failed', { line, error: error instanceof Error ? error.message : String(error) })
        emit({
          id: (() => {
            try {
              return (JSON.parse(line) as RequestEnvelope).id
            } catch {
              return 'unknown'
            }
          })(),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })
  process.stdin.on('end', async () => {
    debug('stdin end received, stopping host')
    await host.stop()
    process.exit(0)
  })
}

void main().catch((error) => {
  debug('startup failed', { error: error instanceof Error ? error.stack ?? error.message : String(error) })
  emit({ id: 'startup', ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) })
  process.exit(1)
})
