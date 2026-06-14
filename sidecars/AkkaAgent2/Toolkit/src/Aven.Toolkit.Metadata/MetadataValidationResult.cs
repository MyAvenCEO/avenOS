namespace Aven.Toolkit.Metadata;

public record MetadataValidationResult(
    bool Succeeded,
    IReadOnlyList<string> Errors)
{
    public static MetadataValidationResult Success { get; } = new(true, Array.Empty<string>());

    public static MetadataValidationResult Failure(params string[] errors) => new(false, errors);
}
