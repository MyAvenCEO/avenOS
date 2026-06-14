using Aven.Sidecar;

// Private Tauri stdio sidecar entry point. See SidecarHost for the protocol loop.
// stdout is protocol-only; logs go to stderr.
return await SidecarHost.RunAsync(args);
