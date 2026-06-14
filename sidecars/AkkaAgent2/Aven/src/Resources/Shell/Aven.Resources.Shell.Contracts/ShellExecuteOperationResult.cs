namespace Aven.Resources.Shell.Contracts;

public sealed record ShellExecuteOperationResult(
    string RequestId,
    int ExitCode,
    string Stdout,
    string Stderr,
    bool TimedOut,
    bool OutputTruncated,
    int StdoutBytes,
    int StderrBytes,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    string WorkingDirectory);
