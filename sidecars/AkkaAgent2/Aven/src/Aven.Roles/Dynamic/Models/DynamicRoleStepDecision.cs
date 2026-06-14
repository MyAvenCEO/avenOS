using System.Text.Json;

namespace Aven.Roles.Dynamic.Models;

public sealed record DynamicRoleStepDecision(
    string Status,
    string? RationaleSummary = null,
    string? FinalAnswer = null,
    string? FailureReason = null,
    string? HumanPrompt = null,
    DynamicRoleAction? Action = null);

public sealed record DynamicRoleAction(
    string Kind,
    string SkillId,
    JsonElement? Input = null);
