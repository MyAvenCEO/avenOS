namespace Aven.DurableDelivery.Contracts.Enums;

public enum DeliveryStatus
{
    Created,
    Sending,
    Accepted,
    Rejected,
    Expired,
    Cancelled,
    Quarantined
}
