namespace Aven.Resources.Contracts.Descriptors;

public sealed record ValidationResult(bool IsValid, string? ErrorCode = null, string? ErrorMessage = null)
{
    public static ValidationResult Success { get; } = new(true);

    public static ValidationResult Failure(string errorCode, string errorMessage)
        => new(false, errorCode, errorMessage);
}