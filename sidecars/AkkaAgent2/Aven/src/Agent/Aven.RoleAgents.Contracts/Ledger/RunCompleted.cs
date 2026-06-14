namespace Aven.RoleAgents.Contracts.Ledger;

public sealed record RunCompleted(
    RunId RunId,
    string Summary,
    string? RoleMemoryPatchJson,
    DateTimeOffset CompletedAt) : IAvenEvent;