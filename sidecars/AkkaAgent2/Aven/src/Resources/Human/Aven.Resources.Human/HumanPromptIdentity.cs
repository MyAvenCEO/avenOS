using System.Security.Cryptography;
using System.Text;

namespace Aven.Resources.Human;

public static class HumanPromptIdentity
{
    public static PromptId FromOperationKey(OperationKey key)
    {
        var material = string.Join("|", key.Caller.Protocol, key.Caller.Value, key.RequestId.Value, key.OperationType);
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return new PromptId(Convert.ToHexString(bytes).ToLowerInvariant());
    }
}