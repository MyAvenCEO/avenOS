namespace Aven.Capabilities.Contracts.Events;

public sealed record CapabilityGrantRegisteredOrUpdated(
    CapabilityId Id,
    ActorAddress Holder,
    ActorAddress Target,
    string[] AllowedMessageTypes,
    decimal? MaxCost,
    int? MaxUses,
    IReadOnlyDictionary<string, string>? Metadata,
    TimeSpan? MaxDuration,
    bool CanDelegate,
    CapabilityId? ParentCapabilityId,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? RevokedAt) : IAvenEvent;
