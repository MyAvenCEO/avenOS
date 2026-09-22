import { z } from 'zod'
import { admissionReceiptSchema, type InputAdmission, inputAdmissionSchema } from './admission'
import {
	type TurnPageInput,
	type TurnStopCommand,
	turnPageInputSchema,
	turnPageSchema,
	turnStopCommandSchema,
	turnStopReceiptSchema
} from './turn-status'

/** One authenticated customer environment, supplied by the host. No caller URL,
 * bearer, model execution or retry policy belongs in the work controller. */
export type IntentWorkTransport = (
	method: 'GET' | 'POST',
	path: string,
	body?: unknown
) => Promise<unknown>

export class IntentWorkRequestError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number | undefined
	) {
		super(message)
	}
}

/** Admission is not completion. Callers retain the exact input until its bound
 * receipt is known; a transport failure never authorizes a fresh input ID. */
export class RemoteIntentWork {
	constructor(private readonly request: IntentWorkTransport) {}

	async admit(raw: InputAdmission) {
		const input = inputAdmissionSchema.parse(raw)
		const receipt = admissionReceiptSchema.parse(await this.request('POST', '/input', input))
		if (
			receipt.inputId !== input.inputId ||
			receipt.revision !== input.revision ||
			(input.target.kind === 'existing' && receipt.intentId !== input.target.id)
		)
			throw Error(
				'The admission receipt does not match this message. Check its saved receipt before resending.'
			)
		return receipt
	}

	async receipt(inputId: string, revision: number) {
		const id = z.uuid().parse(inputId)
		const version = inputAdmissionSchema.shape.revision.parse(revision)
		let value: unknown
		try {
			value = await this.request('GET', `/input/${id}/${version}`)
		} catch (error) {
			if (
				error instanceof IntentWorkRequestError &&
				error.status === 404 &&
				error.code === 'INTENT_NOT_FOUND'
			)
				return null
			throw error
		}
		const receipt = admissionReceiptSchema.parse(value)
		if (receipt.inputId !== id || receipt.revision !== version)
			throw Error('The saved admission receipt belongs to a different message.')
		return receipt
	}

	async turns(intentId: string, raw: TurnPageInput = {}) {
		const id = z.uuid().parse(intentId)
		const query = turnPageInputSchema.parse(raw)
		const params = new URLSearchParams(
			Object.entries(query).map(([key, value]) => [key, String(value)])
		)
		const page = turnPageSchema.parse(
			await this.request('GET', `/${id}/turns${params.size ? `?${params}` : ''}`)
		)
		if (
			page.turns.some((turn) => turn.intentId !== id) ||
			new Set(page.turns.map((turn) => turn.turnId)).size !== page.turns.length
		)
			throw Error('The work status does not match this Intent. Reload before using it.')
		return page
	}

	async stop(intentId: string, turnId: string, raw: TurnStopCommand) {
		const intent = z.uuid().parse(intentId),
			turn = z.uuid().parse(turnId)
		const command = turnStopCommandSchema.parse(raw)
		const receipt = turnStopReceiptSchema.parse(
			await this.request('POST', `/${intent}/turns/${turn}/stop`, command)
		)
		if (receipt.intentId !== intent || receipt.turnId !== turn)
			throw Error(
				'The stop receipt belongs to a different response. Check its status before trying again.'
			)
		return receipt
	}
}
