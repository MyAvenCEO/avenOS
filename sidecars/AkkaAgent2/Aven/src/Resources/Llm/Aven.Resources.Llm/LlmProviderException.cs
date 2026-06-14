namespace Aven.Resources.Llm;

public sealed class LlmProviderException : Exception
{
    public LlmProviderException(OperationError error)
        : base(error.Message)
    {
        Error = error;
    }

    public OperationError Error { get; }
}