using Aven.Roles.Dynamic.Models;

namespace Aven.Roles.Catalogs;

public static class BuiltInRoleBehaviorCatalog
{
    private static readonly IReadOnlyDictionary<string, string[]> AcceptedInputCommands =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["accountant"] = [AccountingOperationTypes.IngestDocument],
            ["contract_watcher"] = ["contracts.ingest_document", "contracts.reminder_due"],
            ["research_watch"] = ["research.ingest_document", "research.run_digest"]
        };

    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> AcceptedInputCommandAliases =
        new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["accountant"] = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [AccountingOperationTypes.Invoice] = AccountingOperationTypes.IngestDocument,
                [AccountingOperationTypes.Statement] = AccountingOperationTypes.IngestDocument,
                [AccountingOperationTypes.AccountStatement] = AccountingOperationTypes.IngestDocument
            }
        };

    private static readonly IReadOnlyDictionary<string, IRoleBehaviorHandler> Handlers =
        new Dictionary<string, IRoleBehaviorHandler>(StringComparer.OrdinalIgnoreCase)
        {
            ["accountant"] = new AccountingRoleBehaviorHandler(),
            ["contract_watcher"] = new ContractWatcherRoleBehaviorHandler(),
            ["research_watch"] = new ResearchWatchRoleBehaviorHandler()
        };

    public static IRoleBehaviorHandler? GetHandler(string roleName) =>
        Handlers.TryGetValue(roleName, out var handler) ? handler : null;

    public static string? CreateInitialStateJson(string roleName) => GetHandler(roleName)?.CreateInitialStateJson();

    public static bool IsAcceptedInputCommand(string roleName, string operationType) =>
        AcceptedInputCommands.TryGetValue(roleName, out var commands)
            ? commands.Contains(operationType, StringComparer.Ordinal)
            : string.Equals(operationType, $"{roleName}.ingest_document", StringComparison.Ordinal)
              || string.Equals(operationType, "dynamic.ingest_document", StringComparison.Ordinal);

    public static bool TryResolveAcceptedInputCommand(
        string roleName,
        string operationType,
        out string acceptedOperationType)
    {
        var dynamicCommandType = $"{roleName}.ingest_document";
        if (!AcceptedInputCommands.ContainsKey(roleName)
            && string.Equals(operationType, "dynamic.ingest_document", StringComparison.Ordinal))
        {
            acceptedOperationType = dynamicCommandType;
            return true;
        }

        if (IsAcceptedInputCommand(roleName, operationType))
        {
            acceptedOperationType = operationType;
            return true;
        }

        if (AcceptedInputCommandAliases.TryGetValue(roleName, out var aliases)
            && aliases.TryGetValue(operationType, out var canonicalOperationType)
            && IsAcceptedInputCommand(roleName, canonicalOperationType))
        {
            acceptedOperationType = canonicalOperationType;
            return true;
        }

        if (!AcceptedInputCommands.ContainsKey(roleName)
            && string.Equals(operationType, dynamicCommandType, StringComparison.Ordinal))
        {
            acceptedOperationType = operationType;
            return true;
        }

        acceptedOperationType = string.Empty;
        return false;
    }

    public static object CreateCommittedCommand(string expectedCommandType, RoleCommittedInput input)
    {
        var normalizedExpectedCommandType = ResolveKnownCommittedCommandType(expectedCommandType);
        var role = AllHandlers().FirstOrDefault(x => x.CommandTypes.Contains(normalizedExpectedCommandType, StringComparer.Ordinal));
        if (role.Handler is not null)
        {
            return role.Handler.CreateCommittedCommand(normalizedExpectedCommandType, input);
        }

        var roleName = normalizedExpectedCommandType.EndsWith(".ingest_document", StringComparison.Ordinal)
            ? normalizedExpectedCommandType[..^".ingest_document".Length]
            : "dynamic";

        return new DynamicRoleInputCommand(
            roleName,
            normalizedExpectedCommandType,
            input.ProposedIntent ?? input.ContentSummary ?? $"Handle {input.ClaimId.Value}",
            input.ContentSummary,
            input.ProposedIntent,
            input.IncomingItemRef,
            input.AttachmentRefs,
            input.RequiredSchemas,
            input.CorrelationId.Value);
    }

    private static string ResolveKnownCommittedCommandType(string expectedCommandType)
    {
        foreach (var aliases in AcceptedInputCommandAliases.Values)
        {
            if (aliases.TryGetValue(expectedCommandType, out var canonicalOperationType))
            {
                return canonicalOperationType;
            }
        }

        return expectedCommandType;
    }

    private static IEnumerable<(IRoleBehaviorHandler Handler, string[] CommandTypes)> AllHandlers()
    {
        yield return (Handlers["accountant"], [AccountingOperationTypes.IngestDocument]);
        yield return (Handlers["contract_watcher"], ["contracts.ingest_document", "contracts.reminder_due"]);
        yield return (Handlers["research_watch"], ["research.ingest_document", "research.run_digest"]);
    }
}
