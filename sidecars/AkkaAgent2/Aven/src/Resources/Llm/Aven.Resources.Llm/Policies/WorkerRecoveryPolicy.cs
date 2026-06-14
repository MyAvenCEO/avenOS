namespace Aven.Resources.Llm.Policies;

internal static class WorkerRecoveryPolicy
{
    public static bool CanRecoverUnknownExternalCall(bool recoverableAfterRestart, bool supportsRecoveryPolling)
        => recoverableAfterRestart || supportsRecoveryPolling;
}
