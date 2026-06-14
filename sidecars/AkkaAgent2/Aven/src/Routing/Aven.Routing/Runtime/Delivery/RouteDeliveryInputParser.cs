using System.Text.Json;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Routing.Runtime.Delivery;

internal static class RouteDeliveryInputParser
{
    public abstract record RouteDeliveryInputParseResult
    {
        public sealed record Parsed(RouteInput Input) : RouteDeliveryInputParseResult;

        public sealed record Invalid(OperationError Error) : RouteDeliveryInputParseResult;
    }

    public static RouteDeliveryInputParseResult Parse(DeliveryAttemptOffer offer)
    {
        try
        {
            var input = JsonSerializer.Deserialize<RouteInput>(offer.Envelope.Payload, CanonicalJsonSerializer.DefaultOptions)
                ?? throw new InvalidOperationException("RouteInput payload was empty.");

            return new RouteDeliveryInputParseResult.Parsed(input);
        }
        catch (Exception ex)
        {
            return new RouteDeliveryInputParseResult.Invalid(new OperationError("invalid_route_payload", ex.Message, false));
        }
    }
}
