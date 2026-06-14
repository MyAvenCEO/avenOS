namespace Aven.RoleAgents;

public sealed class RoleAgentLedgerProjectionBufferOverflowException : InvalidOperationException
{
    public RoleAgentLedgerProjectionBufferOverflowException(string message) : base(message)
    {
    }
}
