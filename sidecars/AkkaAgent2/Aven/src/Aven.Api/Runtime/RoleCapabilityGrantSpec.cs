namespace Aven.Api.Runtime;

internal sealed record RoleCapabilityGrantSpec(
    string LocalName,
    ActorAddress Target,
    string MessageType);
