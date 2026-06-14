namespace Aven.DurableDelivery.Contracts.Models;

public sealed record DeliveryPolicy(
    TimeSpan RetryDelay,
    int MaxAttempts,
    DateTimeOffset? ExpiresAt = null);
