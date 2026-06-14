using Microsoft.Extensions.Configuration;

namespace Aven.Sidecar;

/// <summary>
/// Builds the runtime configuration for the sidecar, mirroring the conventions in
/// <c>Aven.Api/Program.cs</c> (milestone plan M2 step 2): optional
/// <c>appsettings.Local.json</c> and <c>appsettings.OpenAI.local.json</c> from the
/// solution directory, plus environment variables (so a Tauri parent can inject config
/// without files). The runtime supplies its own defaults for any missing key, so a
/// missing provider config yields a structured health/error rather than a crash.
/// </summary>
public static class SidecarConfiguration
{
    public static IConfiguration Build(SidecarLogger logger)
    {
        var configDir = ResolveConfigDirectory();
        var builder = new ConfigurationBuilder();

        if (configDir is not null)
        {
            builder
                .AddJsonFile(Path.Combine(configDir, "appsettings.Local.json"), optional: true, reloadOnChange: false)
                .AddJsonFile(Path.Combine(configDir, "appsettings.OpenAI.local.json"), optional: true, reloadOnChange: false);
            logger.Info($"config dir: {configDir}");
        }
        else
        {
            logger.Warn("no solution config dir found; relying on environment variables and runtime defaults");
        }

        // Supports Aven__Llm__Provider style overrides from the Tauri parent's spawn env.
        builder.AddEnvironmentVariables();
        return builder.Build();
    }

    private static string? ResolveConfigDirectory()
    {
        // Explicit override wins (set by the Tauri spawn in production builds).
        var overrideDir = Environment.GetEnvironmentVariable("AVEN_SIDECAR_CONFIG_DIR");
        if (!string.IsNullOrWhiteSpace(overrideDir) && Directory.Exists(overrideDir))
        {
            return overrideDir;
        }

        // Otherwise walk up from the executable looking for the solution root (where the
        // appsettings live), so `dotnet run` and a packaged binary both find config.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Aven.sln")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return null;
    }
}
