namespace Aven.Roles.Dynamic.Runtime;

public sealed record DynamicRoleOptions(
    int MaxStepsPerRun = 8,
    int MaxObservationChars = 6000,
    int MaxRecentObservations = 8,
    int MaxMetadataQueryLimit = 500,
    int DefaultShellTimeoutSeconds = 10,
    int DefaultShellMaxOutputBytes = 65536);
