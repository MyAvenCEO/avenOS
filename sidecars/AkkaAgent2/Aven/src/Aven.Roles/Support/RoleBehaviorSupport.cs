using System.Text.Json;
using Aven.Resources.Artifacts.Contracts;

namespace Aven.Roles.Support;

public static class RoleBehaviorSupport
{
    public static RoleOperation LlmExtraction(string requestId, CorrelationId correlationId, LlmGenerateOperationPayload payload) =>
        CreateOperation(ResourceKinds.Llm, requestId, correlationId, ResourceOperationTypes.LlmGenerate, payload);

    public static RoleOperation LlmStructuredGeneration(string requestId, CorrelationId correlationId, LlmStructuredGenerateOperationPayload payload) =>
        CreateOperation(ResourceKinds.Llm, requestId, correlationId, ResourceOperationTypes.LlmStructuredGenerate, payload);

    public static RoleOperation MetadataWrite(string requestId, CorrelationId correlationId, MetadataWriteOperationPayload payload) =>
        CreateOperation(ResourceKinds.Metadata, requestId, correlationId, ResourceOperationTypes.MetadataCreate, payload);

    public static RoleOperation MetadataQuery(string requestId, CorrelationId correlationId, MetadataQueryOperationPayload payload) =>
        CreateOperation(ResourceKinds.Metadata, requestId, correlationId, ResourceOperationTypes.MetadataQuery, payload);

    public static RoleOperation ArtifactCreate(string requestId, CorrelationId correlationId, ArtifactWriteOperationPayload payload)
    {
        if (payload.Append)
        {
            throw new InvalidOperationException("Artifact create operations require Append=false.");
        }

        return CreateOperation(ResourceKinds.Artifact, requestId, correlationId, ResourceOperationTypes.ArtifactCreate, payload);
    }

    public static RoleOperation ArtifactAppend(string requestId, CorrelationId correlationId, ArtifactWriteOperationPayload payload)
    {
        if (!payload.Append)
        {
            throw new InvalidOperationException("Artifact append operations require Append=true.");
        }

        return CreateOperation(ResourceKinds.Artifact, requestId, correlationId, ResourceOperationTypes.ArtifactAppend, payload);
    }

    public static RoleOperation HumanPrompt(string requestId, CorrelationId correlationId, HumanPromptOperationPayload payload) =>
        CreateOperation(ResourceKinds.Human, requestId, correlationId, ResourceOperationTypes.HumanApprove, payload);

    public static RoleOperation Schedule(string requestId, CorrelationId correlationId, ScheduledWorkOperationPayload payload) =>
        CreateOperation(ResourceKinds.Schedule, requestId, correlationId, ResourceOperationTypes.ScheduleCreate, payload);

    public static RoleOperation ShellExecute(string requestId, CorrelationId correlationId, ShellExecuteOperationPayload payload) =>
        CreateOperation(ResourceKinds.Shell, requestId, correlationId, ResourceOperationTypes.ShellExecute, payload);

    public static RoleOperation CreateOperation(string providerKind, string requestId, CorrelationId correlationId, string operationType, object payload) =>
        new(providerKind, requestId, correlationId, operationType, PersistedCommandPayload.FromInlineJson(JsonSerializer.Serialize(payload)));

    public static T Deserialize<T>(string json, string errorMessage) =>
        JsonSerializer.Deserialize<T>(json) ?? throw new InvalidOperationException(errorMessage);

    public static T StateOrDefault<T>(string? json, T fallback)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return fallback;
        }

        return JsonSerializer.Deserialize<T>(json) ?? fallback;
    }

    public static string ExtractInvoiceNumber(string json)
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.TryGetProperty("header", out var header)
            && header.ValueKind == JsonValueKind.Object
            && header.TryGetProperty("invoice_number", out var invoiceNumber)
            && invoiceNumber.ValueKind == JsonValueKind.String)
        {
            return invoiceNumber.GetString() ?? "INV-UNKNOWN";
        }

        return document.RootElement.TryGetProperty("invoiceNumber", out var property)
            ? property.GetString() ?? "INV-UNKNOWN"
            : "INV-UNKNOWN";
    }

    public static bool OfferMatchesRole(RoleRegistration role, string proposedIntent, string contentSummary, IReadOnlyList<SchemaRef> requiredSchemas)
    {
        if (requiredSchemas.Count > 0 && role.Inputs.Any(input => input.RequiredSchemas.Count == 0 || input.RequiredSchemas.Intersect(requiredSchemas).Any()))
        {
            return true;
        }

        var haystack = $"{proposedIntent} {contentSummary}";
        var roleTokens = Tokenize(role.Profile.RoleName)
            .Concat(Tokenize(role.Profile.ResponsibilityScope))
            .Concat(Tokenize(role.Profile.RoutingDescription))
            .Concat(role.Profile.ExamplesOfRelevantInput?.SelectMany(Tokenize) ?? Array.Empty<string>())
            .Concat(role.Profile.PrimarySchemas.SelectMany(schema => Tokenize(schema.Value)))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Tokenize(haystack).Any(token => roleTokens.Contains(token));
    }

    private static IEnumerable<string> Tokenize(string value) =>
        value
            .Split([' ', '.', ',', ':', ';', '/', '-', '_', '(', ')'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(static token => token.Length >= 4)
            .Select(static token => token.ToLowerInvariant());
}
