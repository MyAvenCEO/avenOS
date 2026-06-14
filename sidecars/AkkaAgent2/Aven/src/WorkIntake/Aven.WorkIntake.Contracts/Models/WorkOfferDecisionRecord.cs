namespace Aven.WorkIntake.Contracts.Models;

public sealed record WorkOfferDecisionRecord(WorkOfferId OfferId, string PayloadHash, WorkOfferDecision Decision);
