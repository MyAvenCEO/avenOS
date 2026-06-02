# intents-contracts

Public intent-routing contracts for the tree-explorer backend.

## Purpose

This package exposes the public message contracts and shared runtime types used to
communicate with the `intents` actor surface.

Examples:

- `CreateIntentMessage`
- `ConfigureIntentRuntimeMessage`
- `GetRoutingCardMessage`
- `HumanReplyReceived`
- `IntentRuntimeConfig`

## Boundary

This package should contain only:

- public router-facing messages
- shared intent runtime config/value objects needed across package boundaries

It should **not** contain:

- intent actor behavior
- planner/tool execution logic
- internal self-messages
- runtime composition

## Intended consumers

- human actor implementation
- API/backend adapters
- runtime/composition package
- future external callers that need to create or route intents

## Rule of thumb

Only mailbox surface that external code is allowed to send to the intent system
should live here. Internal orchestration messages should remain in implementation
packages.