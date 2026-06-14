namespace Aven.WorkIntake.Contracts.Support;

public static class InputTypeNormalizer
{
    public static readonly string[] SupportedInputTypes = ["pdf", "image", "text"];

    public static string NormalizeOrInfer(string? inputType, string incomingItemRef)
    {
        var normalized = Normalize(inputType);
        return normalized ?? InferFromIncomingItemRef(incomingItemRef);
    }

    public static string? Normalize(string? inputType)
    {
        if (string.IsNullOrWhiteSpace(inputType))
        {
            return null;
        }

        var value = inputType.Trim().ToLowerInvariant();
        return value switch
        {
            "pdf" or "application/pdf" => "pdf",
            "image" or "img" or "png" or "jpg" or "jpeg" or "webp" or "gif" => "image",
            "text" or "txt" or "plain" or "application/json" or "json" => "text",
            _ => null
        };
    }

    public static string InferFromIncomingItemRef(string incomingItemRef)
    {
        if (incomingItemRef.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            return "pdf";
        }

        if (incomingItemRef.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            || incomingItemRef.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase)
            || incomingItemRef.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase)
            || incomingItemRef.EndsWith(".webp", StringComparison.OrdinalIgnoreCase)
            || incomingItemRef.EndsWith(".gif", StringComparison.OrdinalIgnoreCase))
        {
            return "image";
        }

        return "text";
    }
}