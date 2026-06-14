namespace Aven.Resources.Shell.Execution;

public sealed record ShellGatewayOptions(
    bool Enabled = false,
    string? DefaultWorkingDirectory = null,
    int DefaultTimeoutSeconds = 10,
    int MaxOutputBytes = 65536);
