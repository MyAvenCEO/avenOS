import 'dotenv/config'
import { loadServerConfig } from '../src/lib/server/config.js'
import { openDatabase } from '../src/lib/server/db.js'
import { EnvironmentService } from '../src/lib/server/environments/service.js'

const [command, name] = process.argv.slice(2)
if (!command) throw new Error('Expected status, retry, or reconcile.')
const config = loadServerConfig()
const database = openDatabase(config.DATABASE_URL, { max: 1 })
const service = new EnvironmentService(database.pool)
try {
	if (command === 'status') {
		if (!name) throw new Error('Expected a name.')
		process.stdout.write(`${JSON.stringify(await service.status(name), null, 2)}\n`)
	} else if (command === 'retry') {
		if (!name) throw new Error('Expected a name.')
		await service.retry(name)
		process.stdout.write('Queued.\n')
	} else if (command === 'reconcile') {
		process.stdout.write(`${await service.reconcile()} job(s) reconciled.\n`)
	} else {
		throw new Error('Expected status, retry, or reconcile.')
	}
} finally {
	await database.pool.end()
}
