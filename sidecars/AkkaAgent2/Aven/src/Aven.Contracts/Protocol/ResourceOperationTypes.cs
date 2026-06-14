namespace Aven.Contracts.Protocol;

public static class ResourceOperationTypes
{
    public const string ArtifactCreate = "artifact.create";
    public const string ArtifactAppend = "artifact.append";
    public const string LlmGenerate = "llm.generate";
    public const string LlmStructuredGenerate = "llm.structured_generate";
    public const string MetadataCreate = "metadata.create";
    public const string MetadataQuery = "metadata.query";
    public const string HumanApprove = "human.approve";
    public const string HumanAnswer = "human.answer";
    public const string ScheduleCreate = "schedule.create";
    public const string ShellExecute = "shell.execute";
    public const string ScheduleSkipped = "schedule.skipped";
    public const string RoutingRank = "routing.rank";
}
