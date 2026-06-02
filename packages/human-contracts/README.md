# human-contracts

Public human-communication contracts for the tree-explorer backend.

## Purpose

This package defines the public message and data shapes for the `human` actor surface.
Other actors should import these contracts instead of importing `human-subsystem.ts`
directly.

Examples:

- `CreateCommunicationMessage`
- `AnswerCommunicationMessage`
- `HumanReplyHint`
- `HumanCommunication`

## Boundary

This package should contain only the public mailbox and shared value types for human
interaction.

It should **not** contain:

- actor behavior
- tree presentation
- validation flow implementation
- app adapters or runtime wiring

## Intended consumers

- intent orchestration
- API/backend adapters
- future UI/backend integration layers
- human actor implementation package

## Rule of thumb

If another actor needs to talk to the human actor, it should be able to do so by
importing this package alone.