using System.Diagnostics;
using System.Text;

namespace Aven.Resources.Shell.Execution;

internal sealed class ShellCommandExecutor(ShellGatewayOptions options)
{
    public async Task<ShellExecuteOperationResult> ExecuteAsync(ShellExecuteOperationPayload payload, CancellationToken cancellationToken = default)
    {
        if (!options.Enabled)
        {
            throw new InvalidOperationException("Host shell execution is disabled. Set Aven:Shell:Enabled=true to enable the prototype shell gateway.");
        }

        var startedAt = DateTimeOffset.UtcNow;
        var workingDirectory = ResolveWorkingDirectory(payload.WorkingDirectory);
        var timeoutSeconds = payload.TimeoutSeconds > 0 ? payload.TimeoutSeconds : options.DefaultTimeoutSeconds;
        var maxOutputBytes = payload.MaxOutputBytes > 0 ? Math.Min(payload.MaxOutputBytes, options.MaxOutputBytes) : options.MaxOutputBytes;

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

        var startInfo = new ProcessStartInfo
        {
            FileName = "/bin/bash",
            Arguments = "-lc " + QuoteForBash(payload.Command),
            WorkingDirectory = workingDirectory,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (payload.Environment is not null)
        {
            foreach (var pair in payload.Environment)
            {
                startInfo.Environment[pair.Key] = pair.Value;
            }
        }

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.Start();

        if (!string.IsNullOrEmpty(payload.Stdin))
        {
            await process.StandardInput.WriteAsync(payload.Stdin.AsMemory(), timeoutCts.Token).ConfigureAwait(false);
        }

        process.StandardInput.Close();
        var stdoutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);

        var timedOut = false;
        try
        {
            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            timedOut = true;
            TryKill(process);
            await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        }

        var stdout = await ReadTaskOrEmptyAsync(stdoutTask, tolerateCancellation: timedOut).ConfigureAwait(false);
        var stderr = await ReadTaskOrEmptyAsync(stderrTask, tolerateCancellation: timedOut).ConfigureAwait(false);
        var truncated = false;
        var truncatedStdout = TruncateUtf8(stdout, maxOutputBytes, out var stdoutBytes, ref truncated);
        var truncatedStderr = TruncateUtf8(stderr, maxOutputBytes, out var stderrBytes, ref truncated);

        return new ShellExecuteOperationResult(
            payload.RequestId,
            timedOut || !process.HasExited ? -1 : process.ExitCode,
            truncatedStdout,
            truncatedStderr,
            timedOut,
            truncated,
            stdoutBytes,
            stderrBytes,
            startedAt,
            DateTimeOffset.UtcNow,
            workingDirectory);
    }

    private string ResolveWorkingDirectory(string? requested)
    {
        var directory = string.IsNullOrWhiteSpace(requested)
            ? options.DefaultWorkingDirectory
            : requested;

        if (string.IsNullOrWhiteSpace(directory))
        {
            directory = Directory.GetCurrentDirectory();
        }

        Directory.CreateDirectory(directory!);
        return Path.GetFullPath(directory!);
    }

    private static string QuoteForBash(string command) =>
        "'" + command.Replace("'", "'\\''", StringComparison.Ordinal) + "'";

    private static void TryKill(Process process)
    {
        if (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
        }
    }

    private static async Task<string> ReadTaskOrEmptyAsync(Task<string> task, bool tolerateCancellation)
    {
        try
        {
            return await task.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (tolerateCancellation)
        {
            return string.Empty;
        }
    }

    private static string TruncateUtf8(string value, int maxBytes, out int byteCount, ref bool truncated)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        byteCount = bytes.Length;
        if (bytes.Length <= maxBytes)
        {
            return value;
        }

        truncated = true;
        return Encoding.UTF8.GetString(bytes.AsSpan(0, Math.Max(0, maxBytes))) + "\n[truncated]";
    }
}
