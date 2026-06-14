namespace Aven.Sidecar;

/// <summary>
/// All human-readable logs go to <c>stderr</c> (STDIO_RPC_SPEC.md §14.1). stdout is
/// reserved exclusively for protocol frames. Secrets must never be logged (§16.2).
/// </summary>
public sealed class SidecarLogger(TextWriter stderr)
{
    private readonly TextWriter _stderr = stderr;
    private readonly object _gate = new();

    public void Info(string message) => Write("info", message);

    public void Warn(string message) => Write("warn", message);

    public void Error(string message) => Write("error", message);

    public void Error(string message, Exception ex) => Write("error", $"{message}: {ex.GetType().Name}: {ex.Message}");

    private void Write(string level, string message)
    {
        lock (_gate)
        {
            _stderr.WriteLine($"[{level}] {message}");
            _stderr.Flush();
        }
    }
}
