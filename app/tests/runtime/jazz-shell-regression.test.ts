import { describe, expect, it } from 'bun:test'
import {
	applyBootstrapReply,
	applyRuntimeSession,
	jazzShell,
	markJazzShellReadyAfterUnlock,
	resetJazzShell,
} from '../../src/lib/runtime/jazz-shell'
import { get } from 'svelte/store'

describe('jazz-shell regression', () => {
	it('bootstrap reply fills session and ready', () => {
		resetJazzShell()
		markJazzShellReadyAfterUnlock({
			ready: true,
			tables: ['sparks', 'messages'],
			session: {
				signerDid: 'did:key:z6Mk',
				signerDidShort: 'did:key:z6Mk',
				defaultSparkUrn: 'urn:aven:spark:00000000-0000-0000-0000-000000000001',
			},
		})
		const s = get(jazzShell)
		expect(s.ready).toBe(true)
		expect(s.session?.signerDid).toBe('did:key:z6Mk')
		expect(s.tables).toContain('sparks')
	})

	it('runtime session event updates shell without clearing tables', () => {
		resetJazzShell()
		applyBootstrapReply({
			ready: true,
			tables: ['todos'],
			session: {
				signerDid: 'did:key:aaa',
				signerDidShort: 'aaa',
				defaultSparkUrn: 'urn:aven:spark:1',
			},
		})
		applyRuntimeSession({
			grooveReady: false,
			message: 'rehydrating',
		})
		const s = get(jazzShell)
		expect(s.ready).toBe(false)
		expect(s.message).toBe('rehydrating')
		expect(s.tables).toEqual(['todos'])
		expect(s.session?.signerDid).toBe('did:key:aaa')
	})

	it('reset clears shell on lock path', () => {
		applyBootstrapReply({
			ready: true,
			tables: ['sparks'],
			session: {
				signerDid: 'did:key:x',
				signerDidShort: 'x',
				defaultSparkUrn: 'urn:aven:spark:1',
			},
		})
		resetJazzShell()
		const s = get(jazzShell)
		expect(s.ready).toBe(false)
		expect(s.session).toBeUndefined()
	})
})
