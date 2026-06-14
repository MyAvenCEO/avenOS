using Akka.Actor;

namespace Aven.WorkIntake.Actors.Messages;

internal sealed record WorkIntakeDeliveryCompleted(DeliveryId DeliveryId, DeliveryState Terminal, IActorRef ReplyTo);
