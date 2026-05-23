# App Store provisioning (local only)

Never commit provisioning profiles (`*.provisionprofile`). The macOS TrackFlight helper script expects your **Mac App Store Connect** profile at:

```
profiles/mac-app-store.provisionprofile
```

…it copies from `AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS` automatically when you run `bun run release:app:mac <N>`.
