namespace Aven.ActorKernel.State;

public sealed record TerminalSetResult<TValue>(
    TerminalSetStatus Status,
    TValue? ExistingValue,
    TValue? AttemptedValue);
