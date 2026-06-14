namespace Aven.Resources.Runtime.Inbox;

public sealed record ResourceOperationInboxOptions(
    int MaxPayloadBytes = 256 * 1024);