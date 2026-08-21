import { describe, expect, it, vi } from 'vitest'
import {
	passkeyDiagnosticLog,
	passkeyProcessTrace,
	passkeyRegistrationDiagnostic
} from '../src/lib/passkey-diagnostics.js'

describe('passkey registration diagnostics', () => {
	it('does not claim Firefox missed a provider after a NotAllowedError', () => {
		const diagnostic = passkeyRegistrationDiagnostic(
			{
				code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
				message: 'The operation either timed out or was not allowed.',
				status: 400
			},
			{ firefoxLinux: true, android: false }
		)

		expect(diagnostic.message).toContain('PIN-Abfrage bestätigt')
		expect(diagnostic.message).toContain('berühre den YubiKey')
		expect(diagnostic.message).toContain('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY')
		expect(diagnostic.message).not.toContain('keinen Passkey-Anbieter')
	})

	it('gives Android-specific provider guidance while preserving the original detail', () => {
		const diagnostic = passkeyRegistrationDiagnostic(
			{
				code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
				message: 'The service could not complete the request',
				status: 400
			},
			{ firefoxLinux: false, android: true }
		)

		expect(diagnostic.message).toContain('direkt in Chrome')
		expect(diagnostic.message).toContain('The service could not complete the request')
	})

	it.each([
		['ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', 'bereits registriert'],
		['ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT', 'auffindbaren FIDO2'],
		['ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT', 'PIN oder Biometrie'],
		['ERROR_AUTHENTICATOR_GENERAL_ERROR', 'freien Passkey-Speicher'],
		['ERROR_INVALID_RP_ID', 'Konfigurationsfehler']
	])('explains %s', (code, expected) => {
		expect(
			passkeyRegistrationDiagnostic({ code }, { firefoxLinux: false, android: false }).message
		).toContain(expected)
	})

	it('records structured, non-credential diagnostic context', () => {
		expect(
			passkeyDiagnosticLog(
				{ code: 'ERROR_AUTHENTICATOR_GENERAL_ERROR', message: 'failed', status: 400 },
				{ firefoxLinux: false, android: true }
			)
		).toEqual({
			stage: 'webauthn-registration',
			code: 'ERROR_AUTHENTICATOR_GENERAL_ERROR',
			message: 'failed',
			status: 400,
			statusText: undefined,
			platform: 'android'
		})
	})

	it('emits a process trace containing only explicitly safe fields', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		passkeyProcessTrace('HTTP response', {
			endpoint: 'registration-verification',
			method: 'POST',
			status: 200,
			durationMs: 42
		})

		expect(info).toHaveBeenCalledWith('[passkey] HTTP response', {
			endpoint: 'registration-verification',
			method: 'POST',
			status: 200,
			durationMs: 42
		})
		info.mockRestore()
	})
})
