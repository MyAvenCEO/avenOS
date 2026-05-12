export class FlueBrainError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'FlueBrainError';
    }
}
export class FlueBrainValidationError extends FlueBrainError {
    constructor(message, options) {
        super(message, options);
        this.name = 'FlueBrainValidationError';
    }
}
export class FlueBrainModelError extends FlueBrainError {
    constructor(message, options) {
        super(message, options);
        this.name = 'FlueBrainModelError';
    }
}
export function isFlueBrainValidationError(error) {
    return error instanceof Error && error.name === 'FlueBrainValidationError';
}
export function toFlueBrainModelError(message, error) {
    if (isFlueBrainValidationError(error)) {
        return error;
    }
    return new FlueBrainModelError(`${message}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error instanceof Error ? error : undefined
    });
}
