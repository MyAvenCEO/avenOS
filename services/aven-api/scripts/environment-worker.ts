import 'dotenv/config'
import pino from 'pino'
import { loadEnvironmentWorkerConfig } from '../src/lib/server/config.js'
import { openDatabase } from '../src/lib/server/db.js'
import { EnvironmentWorker } from '../src/lib/server/environments/worker.js'

const config = loadEnvironmentWorkerConfig()
const logger = pino({ level: config.LOG_LEVEL })
const database = openDatabase(config.ENVIRONMENT_WORKER_DATABASE_URL ?? config.DATABASE_URL, {
	max: 2
})
const worker = new EnvironmentWorker(database.pool, config, logger)
worker.start()

await new Promise<void>((resolve) => {
	process.once('SIGINT', resolve)
	process.once('SIGTERM', resolve)
})
worker.stop()
await database.pool.end()
