import type { RuntimeLogger } from './types'

export function logDebug(logger: RuntimeLogger | undefined, message: string, metadata?: Record<string, unknown>): void {
	logger?.debug?.(message, metadata)
}

export function logInfo(logger: RuntimeLogger | undefined, message: string, metadata?: Record<string, unknown>): void {
	logger?.info?.(message, metadata)
}

export function logWarn(logger: RuntimeLogger | undefined, message: string, metadata?: Record<string, unknown>): void {
	logger?.warn?.(message, metadata)
}

export function logError(logger: RuntimeLogger | undefined, message: string, metadata?: Record<string, unknown>): void {
	logger?.error?.(message, metadata)
}