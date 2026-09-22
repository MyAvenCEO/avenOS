import { expect, it } from 'vitest'
import { publicConnectionCatalog } from '../src/connection-catalog'

it('projects only destination data and reflects revocation without retaining private fields', () => {
	const credentialRef = crypto.randomUUID()
	const hiddenFixture = ['synthetic', 'hidden'].join('-')
	const source = {
		credentials: [{ credentialRef, enabled: false, secret: hiddenFixture }],
		bindings: [
			{
				bindingRef: crypto.randomUUID(),
				credentialRef,
				enabled: true,
				protocol: 'imap',
				profile: {
					label: 'Invented garden',
					purpose: 'garden-mail',
					host: 'mail.example.test',
					port: 993,
					mailboxes: ['INBOX'],
					login: 'not-for-the-model',
					password: hiddenFixture
				}
			}
		]
	}
	const result = publicConnectionCatalog(source)
	expect(result.bindings[0]).toMatchObject({
		enabled: false,
		host: 'mail.example.test',
		mailboxes: ['INBOX']
	})
	expect(JSON.stringify(result)).not.toMatch(
		/synthetic-hidden|not-for-the-model|credentialRef|password|login/
	)
	expect(() =>
		publicConnectionCatalog({ ...source, bindings: Array(257).fill(source.bindings[0]) })
	).toThrow()
})
