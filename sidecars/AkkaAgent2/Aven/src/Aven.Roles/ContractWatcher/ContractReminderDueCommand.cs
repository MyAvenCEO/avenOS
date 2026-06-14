namespace Aven.Roles.ContractWatcher;

public sealed record ContractReminderDueCommand(
    string ContractId,
    string ReminderText,
    DateTimeOffset DueAt,
    string Summary);
