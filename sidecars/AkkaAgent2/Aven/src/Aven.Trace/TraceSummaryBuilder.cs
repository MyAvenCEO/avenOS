using System.Reflection;

namespace Aven.Trace;

public static class TraceSummaryBuilder
{
    public static string Build(string eventType, string actorKind, object data) => eventType switch
    {
        "DeliveryInitialized" => $"Delivery created for {Value(data, "MessageType") ?? "message"} to {Value(data, "Recipient") ?? "recipient"}.",
        "DeliveryAttemptStarted" => $"Delivery attempt {Value(data, "AttemptNumber") ?? "?"} planned.",
        "DeliveryAcceptedByRecipient" => "Recipient durably accepted delivery.",
        "DeliveryRejectedByRecipient" => "Recipient rejected delivery.",
        "RoutingCommitted" => $"Router committed input to agent {Value(data, "SelectedRoleAgentId") ?? Value(data, "RoleAgentId") ?? "unknown"}.",
        "RoleInputRecorded" => "Agent durably accepted routed input.",
        "LlmRequestRegistered" => $"LLM request registered using {Value(data, "Provider") ?? "provider"}/{Value(data, "Model") ?? "model"}.",
        "LlmRequestSucceeded" => $"LLM request completed using {Value(data, "Provider") ?? "provider"}/{Value(data, "Model") ?? "model"}.",
        "LlmRequestFailed" => "LLM request failed.",
        "LlmStructuredOutputValidated" => $"Structured output validation {Value(data, "Valid") ?? "completed"}.",
        "MetadataRecordCreated" => $"Metadata record created for {Value(data, "SchemaRef") ?? "schema"}.",
        "ScheduleRegistered" => $"Schedule registered for {Value(data, "DueAt") ?? "due time"}.",
        "ScheduleOccurrenceRecorded" => $"Schedule occurrence recorded for delivery {Value(data, "DeliveryId") ?? "unknown"}.",
        "ScheduledRoleDeliveryAccepted" => "Scheduled role delivery accepted downstream.",
        _ => $"{eventType} on {actorKind}"
    };

    private static string? Value(object data, string propertyName)
    {
        var value = data.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public)?.GetValue(data);
        if (value is null) return null;
        var valueProperty = value.GetType().GetProperty("Value", BindingFlags.Instance | BindingFlags.Public);
        return valueProperty?.GetValue(value)?.ToString() ?? value.ToString();
    }
}