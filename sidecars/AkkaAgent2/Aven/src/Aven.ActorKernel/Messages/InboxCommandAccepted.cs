namespace Aven.ActorKernel.Messages;

public sealed record InboxCommandAccepted(
    CommandId CommandId,
    string PayloadHash,
    DateTimeOffset AcceptedAt,
    string ResultKind) : IAvenEvent;
