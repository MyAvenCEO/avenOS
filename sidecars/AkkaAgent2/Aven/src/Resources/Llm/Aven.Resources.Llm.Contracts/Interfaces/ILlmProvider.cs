namespace Aven.Resources.Llm.Contracts.Interfaces;

public interface ILlmProvider
{
    string Name { get; }

    LlmProviderHealth GetHealth();

    Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default);
}
