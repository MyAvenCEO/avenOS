using System.Reflection;
using System.Runtime.CompilerServices;
using Aven.Roles.Support;

namespace Aven.Tests.RoleAgents;

public sealed class RoleCapabilityCatalogTests
{
    [Fact]
    public void RoleCapabilityCatalog_HasUniqueLocalIdsPerRole()
    {
        var definitions = RoleCapabilityCatalog.All;

        Assert.NotEmpty(definitions);
        Assert.Equal(definitions.Count, definitions.Select(static definition => (definition.RoleName, definition.LocalName)).Distinct().Count());

        foreach (var definition in definitions)
        {
            Assert.False(string.IsNullOrWhiteSpace(definition.RoleName));
            Assert.False(string.IsNullOrWhiteSpace(definition.LocalName));
            Assert.False(string.IsNullOrWhiteSpace(definition.ResourceKind));
            Assert.False(string.IsNullOrWhiteSpace(definition.MessageType));
        }
    }

    [Fact]
    public void RoleCapabilityCatalog_HasNoLegacyCompatibilityFields()
    {
        var propertyNames = typeof(RoleCapabilityDefinition)
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Select(static property => property.Name)
            .ToArray();

        Assert.DoesNotContain("Legacy" + "CapabilityId", propertyNames, StringComparer.Ordinal);
        Assert.DoesNotContain("LegacyRole" + "CapabilityId", propertyNames, StringComparer.Ordinal);

        var repoRoot = FindRepoRoot();
        var srcRoot = Path.Combine(repoRoot, "Aven", "src");
        var bannedTexts = new[]
        {
            "LegacyRole" + "Capability",
            "Legacy" + "CapabilityId",
            "Seed" + "LegacyStaticRoleCapabilityAliases",
            "llm-extract" + "-cap",
            "ledger-create" + "-cap",
            "human-review" + "-cap",
            "contract-reminder" + "-cap",
            "research-metadata" + "-cap"
        };

        var offenders = Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Select(path => (path, content: File.ReadAllText(path)))
            .SelectMany(x => bannedTexts
                .Where(text => x.content.Contains(text, StringComparison.Ordinal))
                .Select(text => $"{Path.GetRelativePath(repoRoot, x.path)}:{text}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Legacy role capability compatibility markers remain in src: " + string.Join(", ", offenders));
    }

    private static string FindRepoRoot([CallerFilePath] string sourceFilePath = "")
    {
        var directory = new FileInfo(sourceFilePath).Directory;
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Aven.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException("Could not locate repository root from test source file path.");
    }
}
