namespace Aven.Toolkit.Core.Operations;

public sealed record OperationError(
    string Code,
    string Message,
    bool Retryable,
    string? DetailsJson = null);
