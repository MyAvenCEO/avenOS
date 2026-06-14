namespace Aven.Roles.Catalogs;

using Aven.Roles.Accounting.Schemas;
using Aven.Roles.ContractWatcher.Schemas;
using Aven.Roles.ResearchWatch.Schemas;

public static class BuiltInRoleDefinitionCatalog
{
    public static RoleRegistration Accounting { get; } = new(
        new RoleProfile(
            "accountant",
            "Accountant",
            "Invoices, statements, payments, ledger records, and bookkeeping evidence.",
            ["pdf", "image", "text"],
            [
                AccountingSchemaRefs.InvoiceV3,
                AccountingSchemaRefs.AccountStatementV3,
                AccountingSchemaRefs.StatementTransactionV3,
                AccountingSchemaRefs.PaymentMatchV3
            ],
            "Accepts invoices and account statements; extracts schema-grounded facts, indexes statement transactions, and matches payments deterministically.",
            "monthly",
            "Tracks invoice and statement metadata with deterministic payment status.",
            ["invoice pdf", "bank statement image", "payment question"],
            ["lease renewal", "research paper"]),
        [
            new RoleInputContract(AccountingOperationTypes.IngestDocument, "Ingest accounting document and extract trusted facts.", [AccountingSchemaRefs.InvoiceV3]),
            new RoleInputContract(AccountingOperationTypes.IngestDocument, "Ingest statement document and extract trusted facts.", [AccountingSchemaRefs.AccountStatementV3])
        ],
        [
            new RoleOutputContract(ResourceOperationTypes.MetadataCreate, [AccountingSchemaRefs.InvoiceV3, AccountingSchemaRefs.AccountStatementV3, AccountingSchemaRefs.StatementTransactionV3, AccountingSchemaRefs.PaymentMatchV3], false, false)
        ],
        new RoleAgentPolicy("accountant", true, true, true));

    public static RoleRegistration ContractWatcher { get; } = new(
        new RoleProfile(
            "contract_watcher",
            "Contract Watcher",
            "Contracts, leases, obligations, renewal windows, notice dates, and reminders.",
            ["pdf", "image", "text"],
            [
                ContractWatcherSchemaRefs.ContractSummaryV1,
                ContractWatcherSchemaRefs.ObligationV1,
                ContractWatcherSchemaRefs.RenewalTermV1
            ],
            "Accepts contracts and leases; extracts obligations and renewal/notice dates; creates reminders.",
            "reminder-driven",
            "Tracks upcoming notice and renewal dates.",
            ["lease agreement", "contract notice period", "renewal reminder"],
            ["invoice payment", "bank statement"]),
        [
            new RoleInputContract("contracts.ingest_document", "Ingest contract or lease and extract obligations and dates.", [ContractWatcherSchemaRefs.ContractSummaryV1]),
            new RoleInputContract("contracts.reminder_due", "Process a scheduled contract reminder.", [ContractWatcherSchemaRefs.ReminderFiredV1])
        ],
        [
            new RoleOutputContract(ResourceOperationTypes.MetadataCreate, [ContractWatcherSchemaRefs.ContractSummaryV1, ContractWatcherSchemaRefs.ObligationV1, ContractWatcherSchemaRefs.RenewalTermV1], true, true),
            new RoleOutputContract(ResourceOperationTypes.ScheduleCreate, [ContractWatcherSchemaRefs.RenewalTermV1], true, true)
        ],
        new RoleAgentPolicy("contract_watcher", true, true, true));

    public static RoleRegistration ResearchWatch { get; } = new(
        new RoleProfile(
            "research_watch",
            "Research Watch",
            "Research papers, digests, claim summaries, and recurring review schedules.",
            ["pdf", "image", "text"],
            [
                ResearchWatchSchemaRefs.DocumentSummaryV1,
                ResearchWatchSchemaRefs.DigestV1
            ],
            "Accepts research documents, summarizes them, and can schedule recurring digests.",
            "weekly",
            "Tracks recent research inputs and digest cadence.",
            ["research paper", "paper summary", "weekly digest"],
            ["invoice", "lease renewal"]),
        [
            new RoleInputContract("research.ingest_document", "Ingest research document and extract summary facts.", [ResearchWatchSchemaRefs.DocumentSummaryV1]),
            new RoleInputContract("research.run_digest", "Run a scheduled research digest.", [ResearchWatchSchemaRefs.DigestV1])
        ],
        [
            new RoleOutputContract(ResourceOperationTypes.MetadataCreate, [ResearchWatchSchemaRefs.DocumentSummaryV1, ResearchWatchSchemaRefs.DigestV1], true, true),
            new RoleOutputContract(ResourceOperationTypes.ScheduleCreate, [ResearchWatchSchemaRefs.DigestV1], true, true)
        ],
        new RoleAgentPolicy("research_watch", true, true, true));

    public static IReadOnlyList<RoleRegistration> All { get; } = [Accounting, ContractWatcher, ResearchWatch];

    public static RoleRegistration Get(string roleName) => All.First(x => string.Equals(x.Profile.RoleName, roleName, StringComparison.OrdinalIgnoreCase));
}
