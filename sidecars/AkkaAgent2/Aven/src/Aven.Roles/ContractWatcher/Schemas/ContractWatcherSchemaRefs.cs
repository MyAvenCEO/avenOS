namespace Aven.Roles.ContractWatcher.Schemas;

public static class ContractWatcherSchemaRefs
{
    public static readonly SchemaRef ContractSummaryV1 = new("schema://contracts/contract-summary@1");
    public static readonly SchemaRef ObligationV1 = new("schema://contracts/obligation@1");
    public static readonly SchemaRef RenewalTermV1 = new("schema://contracts/renewal-term@1");
    public static readonly SchemaRef ReminderFiredV1 = new("schema://contracts/reminder-fired@1");
}