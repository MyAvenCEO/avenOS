namespace Aven.Roles.Accounting.Matching;

internal sealed record AccountingMatchPlan(
    IReadOnlyList<RoleOperation> Operations,
    IReadOnlyList<AccountingPendingHumanReview> PendingHumanReviews,
    string LastResult);
