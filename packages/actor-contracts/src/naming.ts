/**
 * Builds a stable intent actor key from an intent id.
 */
export function intentActorKey(intentId: string): string {
  return `intent~${intentId}`;
}

/**
 * Builds a stable communication key from a communication id.
 */
export function communicationKey(communicationId: string): string {
  return `communication~${communicationId}`;
}

/**
 * Builds a stable dispatcher key from a dispatcher config id.
 */
export function dispatcherKey(configId: string): string {
  return configId;
}

/**
 * Builds a stable model key from a hashed model id.
 */
export function modelKey(modelHash: string): string {
  return `model~${modelHash}`;
}

/**
 * Builds a stable request worker key from a request id.
 */
export function requestWorkerKey(requestId: string): string {
  return requestId;
}
