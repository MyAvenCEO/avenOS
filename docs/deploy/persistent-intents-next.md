# Persistent intents on `next`

No new GitHub Environment secrets or variables are required. Persistent intents use
the existing Artifact Store, Processor, database-per-customer, and Aven API credentials.

To deploy:

1. Merge the PR into `main` only after CI is green.
2. Run the `promote` workflow with `main → next`; do not merge or rebase `next` by hand.
3. Let `release-next` publish both images, deploy the stack, and build the desktop apps.

The environment worker automatically reconciles every eligible customer database to
Artifact Store schema `3` and Processor schema `4`. The rollout is additive: it installs
`intent.declaration@1` and the `aven_intents` projection without deleting existing data.

Success means `/api/health/status` reports `overall=healthy`. Then sign in with the
`next` desktop app, upload one file, and verify that its intent, File-skill stages,
derived artifacts, and chat contributions survive an app restart.

All existing Artifact Processor vision settings must remain valid. See
[GitHub deployment](../../services/aven-api/docs/github-deployment.md) for the complete
secret and variable inventory.
