import { expect, test } from 'bun:test'
import { ConnectionManagement, type ConnectionTransport } from '../src/lib/connections/management'

const context = () => ({ environmentId: crypto.randomUUID(), subjectId: crypto.randomUUID() })
test('an unconfirmed write retains only its command ID; checking does not resend its secret', async () => {
	const calls: unknown[] = []
	const transport: ConnectionTransport = async <T>(args: Parameters<ConnectionTransport>[0]) => {
		calls.push(args)
		if (args.action === 'command') throw Error('connection lost')
		return { receipt: { secretVersion: 1 } } as T
	}
	const manager = new ConnectionManagement(context(), transport)
	await expect(
		manager.command({ action: 'create', value: 'invented-test-value' })
	).rejects.toThrow()
	const id = manager.pendingCommand
	expect(id).toBeTruthy()
	expect(JSON.stringify(manager)).not.toContain('invented-test-value')
	await expect(manager.command({ action: 'create', value: 'second-value' })).rejects.toThrow(
		'PENDING'
	)
	await manager.checkReceipt()
	expect(calls).toHaveLength(2)
	expect(calls[1]).toMatchObject({ action: 'receipt', commandId: id })
	expect(calls[1]).not.toHaveProperty('command')
	expect(manager.pendingCommand).toBeNull()
})
test('a missing receipt is not proof of an unapplied in-flight command', async () => {
	const manager = new ConnectionManagement(context(), async () => {
		throw { message: 'unavailable', status: 404 }
	})
	// A command-level rejection is definitive, unlike a receipt lookup.
	await expect(manager.command({ action: 'revoke' })).rejects.toBeDefined()
	expect(manager.pendingCommand).toBeNull()
	let command = true
	const uncertain = new ConnectionManagement(context(), async () => {
		if (command) {
			command = false
			throw Error('timeout')
		}
		throw { message: 'not found', status: 404 }
	})
	await expect(uncertain.command({ action: 'revoke' })).rejects.toThrow()
	const pending = uncertain.pendingCommand
	await expect(uncertain.checkReceipt()).rejects.toBeDefined()
	expect(uncertain.pendingCommand).toBe(pending)
})
test('closing a workspace invalidates late results and cannot retarget an admitted write', async () => {
	const scope = context(),
		original = { ...scope },
		wait = Promise.withResolvers<unknown>()
	const calls: unknown[] = []
	const manager = new ConnectionManagement(scope, async <T>(args: unknown) => {
		calls.push(args)
		return (await wait.promise) as T
	})
	scope.environmentId = crypto.randomUUID()
	const write = manager.command({ action: 'revoke' })
	manager.close()
	wait.resolve({ receipt: {} })
	await expect(write).rejects.toThrow('CONTEXT_CLOSED')
	expect(calls[0]).toMatchObject(original)
	await expect(manager.metadata()).rejects.toThrow('CONTEXT_CLOSED')
	await expect(manager.command({})).rejects.toThrow('CONTEXT_CLOSED')
	expect(calls).toHaveLength(1)
})
test('double submit performs only one write; success allows a new command identity', async () => {
	let release = Promise.withResolvers<unknown>()
	const calls: Array<Parameters<ConnectionTransport>[0]> = []
	const manager = new ConnectionManagement(
		context(),
		async <T>(args: Parameters<ConnectionTransport>[0]) => {
			calls.push(args)
			return (await release.promise) as T
		}
	)
	const first = manager.command({ action: 'revoke' })
	await expect(manager.command({ action: 'revoke' })).rejects.toThrow('PENDING')
	release.resolve({ receipt: {} })
	await first
	release = Promise.withResolvers<unknown>()
	const second = manager.command({ action: 'binding-revoke' })
	release.resolve({ receipt: {} })
	await second
	expect(calls).toHaveLength(2)
	expect(calls[0]!.commandId).not.toBe(calls[1]!.commandId)
})
