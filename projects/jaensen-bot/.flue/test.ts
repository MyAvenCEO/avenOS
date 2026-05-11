import { rm } from 'fs/promises'
import { createMemoryStorage, loadSkillDocs, MockSandboxFactory, runJaensenTurn } from './jaensen.js'

async function runTests() {
	console.log('🧪 Testing lean Jaensen bot\n')

	const testDir = '/tmp/jaensen-test'
	await rm(testDir, { recursive: true, force: true })
	const storage = createMemoryStorage()
	const skillDocs = await loadSkillDocs('/home/daniel/src/oMaiaCity/AvenOS/projects/jaensen-bot')

	const prompts: string[] = []
	const result = await runJaensenTurn(
		{
			from: 'customer@client.com',
			message:
				'Customer says order #12345 is delayed. Please remember the case and review https://example.com/orders/12345.'
		},
		{
			storage,
			sandboxFactory: new MockSandboxFactory(() => ({ stdout: 'ok', exitCode: 0 })),
			skillDocs,
			generate: async (prompt) => {
				prompts.push(prompt)
				if (prompt.includes('DISPATCHER_ROUTING_DECISION')) {
					return JSON.stringify({
						relevantIntentIds: [],
						createIntent: {
							title: 'Order #12345 support case',
							summary: 'Customer asked about a delayed shipment for order #12345.'
						}
					})
				}
				if (prompt.includes('INTENT_DECISION')) {
					return JSON.stringify({
						summary: 'Customer asked about a delayed shipment for order #12345.',
						status: 'pending',
						replyDraft: 'I will review the order and keep track of the case.',
						contextUpdates: { orderId: '12345' },
						actions: [
							{
								skill: 'memory',
								operation: 'remember',
								input: { topic: 'Order #12345 support case', note: 'Customer reported a delayed shipment for order #12345.' }
							}
						],
						humanLoop: {
							needed: true,
							reason: 'shipment delayed',
							message: 'Human follow-up may be needed if the shipment remains delayed.'
						}
					})
				}

				return JSON.stringify({
					reply:
						'I have logged the delayed-shipment case for order #12345 and noted that human follow-up may be needed.'
				})
			}
		}
	)

	const memoryContent = (await storage.memory.readTopic('Order #12345 support case')) ?? ''

	console.log('Response:', result.response)
	console.log('Primary intent:', result.primaryIntent.title)
	console.log('Prompts used:', prompts.length)
	console.log('Memory written:', memoryContent.includes('delayed shipment') ? '✅' : '❌')
	console.log('Human notify:', result.humanNotification ? '✅' : '❌')

	await rm(testDir, { recursive: true, force: true })
	console.log('\n🎉 Lean Jaensen test completed!')
}

runTests().catch((error) => {
	console.error(error)
	process.exitCode = 1
})