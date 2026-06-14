namespace Aven.Resources.Llm.Contracts.Interfaces;

public interface ILlmExecutionStrategyProvider
{
    LlmExecutionStrategy DescribeExecutionStrategy(LlmRequest request);
}