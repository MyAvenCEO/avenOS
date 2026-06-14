namespace Aven.Resources.Shell.Contracts;

public sealed record ShellExecuteOperationPayload(
    string RequestId,
    string Command,
    string? WorkingDirectory = null,
    IReadOnlyDictionary<string, string>? Environment = null,
    string? Stdin = null,
    int TimeoutSeconds = 10,
    int MaxOutputBytes = 65536,
    string? CapabilityId = null);
