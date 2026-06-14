namespace Aven.Contracts.Capabilities;

public sealed record CapabilityGrant(
    CapabilityId Id,
    ActorAddress Holder,
    ActorAddress Target,
    IReadOnlySet<string> AllowedMessageTypes,
    Aven.Toolkit.Capabilities.CapabilityConstraints Constraints,
    bool CanDelegate,
    CapabilityId? ParentCapabilityId,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? RevokedAt);
