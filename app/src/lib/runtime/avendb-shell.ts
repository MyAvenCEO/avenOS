import { writable } from 'svelte/store'
import type { AvenDbSessionReply, AvenDbStatusReply } from '$lib/avendb/api'

export type AvenDbShellState = {
	ready: boolean
	tables: string[]
	session: AvenDbSessionReply | undefined
	message: string | undefined
}

const initial: AvenDbShellState = {
	ready: false,
	tables: [],
	session: undefined,
	message: undefined,
}

/** Single UI source for avenDB bootstrap session + table list (bootstrap IPC + runtime events). */
export const avendbShell = writable<AvenDbShellState>(initial)

export function resetAvenDbShell(): void {
	avendbShell.set(initial)
}

export function applyBootstrapReply(reply: AvenDbStatusReply): void {
	avendbShell.update((s) => ({
		ready: reply.ready,
		tables: reply.tables ?? s.tables,
		session: reply.session ?? s.session,
		message: reply.message ?? (reply.ready ? undefined : s.message),
	}))
}

export function applyRuntimeSession(payload: {
	avendbReady?: boolean
	signerDid?: string
	defaultSparkUrn?: string
	message?: string
	tables?: string[]
}): void {
	avendbShell.update((s) => {
		const ready =
			typeof payload.avendbReady === 'boolean' ? payload.avendbReady : s.ready
		const session: AvenDbSessionReply | undefined =
			payload.signerDid && payload.defaultSparkUrn
				? {
						signerDid: payload.signerDid,
						signerDidShort: shortSignerDid(payload.signerDid),
						defaultSparkUrn: payload.defaultSparkUrn,
					}
				: s.session
		return {
			ready,
			tables: payload.tables ?? s.tables,
			session,
			message: payload.message ?? (ready ? undefined : s.message),
		}
	})
}

/** LockGate: bootstrap reply is authoritative; syncs shell before `avendbSessionReady`. */
export function markAvenDbShellReadyAfterUnlock(reply: AvenDbStatusReply): void {
	applyBootstrapReply(reply)
}

function shortSignerDid(did: string): string {
	const t = did.trim()
	if (t.length <= 20) return t
	return `${t.slice(0, 12)}…${t.slice(-6)}`
}
