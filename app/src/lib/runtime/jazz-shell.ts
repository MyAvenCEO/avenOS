import { writable } from 'svelte/store'
import type { JazzSessionReply, JazzStatusReply } from '$lib/jazz/api'

export type JazzShellState = {
	ready: boolean
	tables: string[]
	session: JazzSessionReply | undefined
	message: string | undefined
}

const initial: JazzShellState = {
	ready: false,
	tables: [],
	session: undefined,
	message: undefined,
}

/** Single UI source for Groove bootstrap session + table list (bootstrap IPC + runtime events). */
export const jazzShell = writable<JazzShellState>(initial)

export function resetJazzShell(): void {
	jazzShell.set(initial)
}

export function applyBootstrapReply(reply: JazzStatusReply): void {
	jazzShell.update((s) => ({
		ready: reply.ready,
		tables: reply.tables ?? s.tables,
		session: reply.session ?? s.session,
		message: reply.message ?? (reply.ready ? undefined : s.message),
	}))
}

export function applyRuntimeSession(payload: {
	grooveReady?: boolean
	signerDid?: string
	defaultSparkUrn?: string
	message?: string
	tables?: string[]
}): void {
	jazzShell.update((s) => {
		const ready =
			typeof payload.grooveReady === 'boolean' ? payload.grooveReady : s.ready
		const session: JazzSessionReply | undefined =
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

/** LockGate: bootstrap reply is authoritative; syncs shell before `grooveSessionReady`. */
export function markJazzShellReadyAfterUnlock(reply: JazzStatusReply): void {
	applyBootstrapReply(reply)
}

function shortSignerDid(did: string): string {
	const t = did.trim()
	if (t.length <= 20) return t
	return `${t.slice(0, 12)}…${t.slice(-6)}`
}
