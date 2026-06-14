namespace Aven.Resources.Llm.Contracts.Models;

public sealed record LlmArtifactPreparationResult(
    PreparedLlmInput? Prepared,
    OperationError? Error)
{
    public bool IsSuccess => Prepared is not null && Error is null;

    public static LlmArtifactPreparationResult Success(PreparedLlmInput prepared) => new(prepared, null);

    public static LlmArtifactPreparationResult Rejected(OperationError error) => new(null, error);
}
