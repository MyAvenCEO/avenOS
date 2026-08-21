export interface PasskeyClientError {
	code?: unknown
	message?: unknown
	status?: unknown
	statusText?: unknown
}

export interface PasskeyDiagnosticContext {
	firefoxLinux: boolean
	android: boolean
}

export interface PasskeyTraceDetails {
	platform?: 'android' | 'firefox-linux' | 'other'
	webAuthnAvailable?: boolean
	prfRequired?: boolean
	prfEnabled?: boolean
	credentialReturned?: boolean
	endpoint?: 'registration-options' | 'registration-verification' | 'enrollment-finalization'
	method?: 'GET' | 'POST'
	status?: number
	durationMs?: number
	errorName?: string
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function status(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function passkeyPlatform(
	context: PasskeyDiagnosticContext
): PasskeyTraceDetails['platform'] {
	return context.android ? 'android' : context.firefoxLinux ? 'firefox-linux' : 'other'
}

export function passkeyProcessTrace(stage: string, details: PasskeyTraceDetails = {}): void {
	console.info(`[passkey] ${stage}`, details)
}

function guidance(code: string, context: PasskeyDiagnosticContext, httpStatus?: number): string {
	switch (code) {
		case 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY':
			if (context.firefoxLinux) {
				return 'Firefox oder der Sicherheitsschlüssel hat die Passkey-Anfrage abgebrochen, abgelehnt oder nicht rechtzeitig bestätigt. Die PIN-Abfrage bestätigt, dass Firefox den Schlüssel gefunden hat. Gib die PIN ein und berühre den YubiKey anschließend, sobald Firefox dazu auffordert.'
			}
			if (context.android) {
				return 'Androids Passkey-Dienst hat die Anfrage abgebrochen, abgelehnt oder nicht rechtzeitig abgeschlossen. Öffne den ursprünglichen Link direkt in Chrome statt in einem eingebetteten Browser und prüfe, ob Displaysperre und Passkey-Anbieter aktiv sind.'
			}
			return 'Der Browser oder Passkey-Anbieter hat die Anfrage abgebrochen, abgelehnt oder nicht rechtzeitig bestätigt.'
		case 'ERROR_CEREMONY_ABORTED':
			return 'Die Passkey-Anfrage wurde abgebrochen, möglicherweise weil eine zweite Anfrage gestartet wurde. Versuche es erneut und schließe nur die aktuelle Abfrage ab.'
		case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
			return 'Dieser Passkey ist für dieses Aven-Konto bereits registriert. Verwende einen anderen Passkey oder melde dich mit dem vorhandenen an.'
		case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
			return 'Der gewählte Sicherheitsschlüssel unterstützt keine auffindbaren FIDO2-Anmeldedaten oder sein Speicher ist nicht verfügbar. Für die Anmeldung in avenOS wird ein discoverable credential benötigt.'
		case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
			return 'Der gewählte Passkey-Anbieter unterstützt die erforderliche Benutzerbestätigung per PIN oder Biometrie nicht.'
		case 'ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE':
			return 'Der Passkey-Anbieter konnte die erforderliche Bestätigung per PIN oder Biometrie nicht durchführen.'
		case 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG':
			return 'Der gewählte Sicherheitsschlüssel unterstützt keinen der vom Identitätsdienst angebotenen Signaturalgorithmen.'
		case 'ERROR_AUTHENTICATOR_GENERAL_ERROR':
			return 'Der Sicherheitsschlüssel oder Passkey-Anbieter konnte die Registrierung nicht verarbeiten. Prüfe insbesondere freien Passkey-Speicher, PIN und die abschließende Berührung des Schlüssels.'
		case 'ERROR_INVALID_DOMAIN':
		case 'ERROR_INVALID_RP_ID':
			return 'Browser und Identitätsdienst verwenden nicht dieselbe Passkey-Domain. Das ist ein Konfigurationsfehler des Dienstes.'
		case 'ERROR_INVALID_USER_ID_LENGTH':
		case 'ERROR_MALFORMED_PUBKEYCREDPARAMS':
			return 'Der Identitätsdienst hat ungültige WebAuthn-Registrierungsdaten geliefert.'
	}

	if (httpStatus === 401 || httpStatus === 403) {
		return 'Der Identitätsdienst hat die Registrierung abgelehnt. Der Einrichtungslink oder die Anmeldung ist möglicherweise nicht mehr gültig.'
	}
	if (httpStatus === 429) {
		return 'Zu viele Passkey-Versuche in kurzer Zeit. Warte einen Moment und versuche es erneut.'
	}
	if (httpStatus && httpStatus >= 500) {
		return 'Der Identitätsdienst konnte die Passkey-Registrierung nicht abschließen.'
	}
	return 'Die Passkey-Registrierung ist fehlgeschlagen.'
}

export function passkeyRegistrationDiagnostic(
	error: PasskeyClientError,
	context: PasskeyDiagnosticContext
): Error {
	const code = text(error.code) ?? 'UNKNOWN_PASSKEY_ERROR'
	const message = text(error.message)
	const httpStatus = status(error.status)
	const diagnostic = [code, httpStatus ? `HTTP ${httpStatus}` : undefined]
		.filter(Boolean)
		.join(', ')
	const detail = message ? ` Browsermeldung: ${message}` : ''
	return new Error(`${guidance(code, context, httpStatus)}${detail} [Diagnose: ${diagnostic}]`)
}

export function passkeyDiagnosticLog(
	error: PasskeyClientError,
	context: PasskeyDiagnosticContext
): Record<string, unknown> {
	return {
		stage: 'webauthn-registration',
		code: text(error.code) ?? 'UNKNOWN_PASSKEY_ERROR',
		message: text(error.message),
		status: status(error.status),
		statusText: text(error.statusText),
		platform: passkeyPlatform(context)
	}
}
