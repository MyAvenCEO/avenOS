using Akka.Actor;

namespace Aven.WorkIntake.Actors.Messages;

internal sealed record WorkIntakeDeliveryFailed(DeliveryId DeliveryId, OperationError Error, IActorRef ReplyTo);
