import type { Readable } from 'svelte/store'
import type { HoldOrigin, MetaInfo, NameAvailability, NameHoldResult } from '$lib/types.js'

export interface AppSession {
	authenticated: boolean
	user?: { name: string; email: string }
}

export interface NameSearchView {
	name: string
	busy: boolean
	result: NameAvailability | null
	error: string
}

export interface SecureNameView {
	name: string
	email: string
	info: NameAvailability | null
	hold: NameHoldResult | null
	loading: boolean
	error: string
}

export interface SimpleActionView {
	busy: boolean
	error: string
}

export interface LoginView extends SimpleActionView {
	message: string
}

export interface DeviceView {
	signedIn: boolean
	busy: boolean
	approved: boolean
	message: string
}

export type CheckoutState = 'loading' | 'ready' | 'paying' | 'confirming'

export interface CheckoutView {
	state: CheckoutState
	error: string
}

export interface AppRuntime {
	session(url: URL): Readable<AppSession>
	initial: {
		nameSearch(url: URL): NameSearchView
		secureName(url: URL): SecureNameView
		login(url: URL): LoginView
		device(url: URL): DeviceView
		passkey(url: URL): SimpleActionView & { name: string }
		checkout(url: URL): CheckoutView
		payment(url: URL): SimpleActionView
	}
	names: {
		check(name: string): Promise<NameAvailability>
		loadInfo(name: string, current: NameAvailability | null): Promise<NameAvailability | null>
		hold(name: string, email: string, origin?: HoldOrigin): Promise<NameHoldResult>
		/** The signed-in user's own names — used to name a passkey after them. */
		mine(): Promise<string[]>
	}
	auth: {
		signIn(): Promise<void>
		signOut(): Promise<void>
		createPasskey(name: string, firefoxLinux: boolean): Promise<void>
		passkeyWarning(url: URL): boolean
	}
	device: {
		approve(userCode: string): Promise<void>
	}
	dashboard: {
		load(url: URL): Promise<{ downloadUrl: string; needsPasskey: boolean }>
	}
	billing: {
		pay(input: Record<string, string>): Promise<{ redirect: string }>
	}
	purchase: {
		waitForSession(token: string, url: URL): Promise<boolean>
	}
	meta(): Promise<MetaInfo>
}
