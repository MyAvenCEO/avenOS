namespace Aven.Scheduling.Contracts;

public sealed record ScheduledWorkOperationPayload(
    string RequestId,
    string ScheduleId,
    ActorAddress TargetAgent,
    string TargetOperationType,
    string CommandPayloadJson,
    DateTimeOffset DueAt,
    CorrelationId CorrelationId,
    string Summary,
    string? CapabilityId = null,
    string MissedRunPolicy = "RunImmediately",
    string? Recurrence = null);