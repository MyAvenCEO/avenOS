using Aven.Contracts.Identifiers;
using Aven.Contracts.Operations;

namespace Aven.Resources.Contracts.Descriptors;

public sealed record ResourceExecutionContext(
    OperationKey OperationKey,
    CapabilityId? ResolvedCapabilityId,
    ActorAddress ReplyTo,
    ActorAddress Sender);