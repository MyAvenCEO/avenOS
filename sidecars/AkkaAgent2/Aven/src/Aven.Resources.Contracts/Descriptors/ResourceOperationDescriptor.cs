using System.ComponentModel.DataAnnotations;
using Aven.Contracts.Identifiers;
using Aven.Contracts.Operations;

namespace Aven.Resources.Contracts.Descriptors;

public sealed record ResourceOperationDescriptor<TPayload>(
    string ResourceKind,
    Func<TPayload, string> MessageType,
    Func<ActorAddress, TPayload, OperationKey> OperationKey,
    Func<TPayload, CapabilityId?> PayloadCapabilityId,
    Func<TPayload, ValidationResult> Validate);