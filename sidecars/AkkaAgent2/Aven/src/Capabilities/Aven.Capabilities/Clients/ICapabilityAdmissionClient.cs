namespace Aven.Capabilities.Clients;

public interface ICapabilityAdmissionClient
{
    Task UpsertGrantAsync(CapabilityGrant grant);
    Task<object> AdmitAsync(CapabilityAdmissionRequest request);
    void UpsertGrant(CapabilityGrant grant);
    object Admit(CapabilityAdmissionRequest request);
}