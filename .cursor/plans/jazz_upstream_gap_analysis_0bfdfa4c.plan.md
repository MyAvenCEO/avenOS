---
name: Jazz upstream gap analysis
overview: "SUPERSEDED by jazz_upstream_re-vendor_2560abaa.plan.md. Phase 1 (client-p2p) done. Next: refresh jazz2-upstream to alpha.50, strip dead vendor files, iOS RocksDB spike, full re-vendor."
todos:
  - id: doc-gap-matrix
    content: Document keep vs remove checklist in third_party/jazz-tools/README (AvenOS fork boundary)
    status: cancelled
  - id: trim-fork-features
    content: "Phase 1: client-p2p feature, gate HTTP/CLI — DONE in ed80d2b"
    status: completed
  - id: cherry-pick-audit
    content: "Option A2: diff upstream vs _published_groove for cherry-picks"
    status: cancelled
  - id: ios-rocksdb-spike
    content: "Before re-vendor: iOS RocksDB spike on upstream alpha.50 — mandatory, no SQLite fallback"
    status: pending
  - id: full-revendor-spike
    content: "Re-vendor jazz2 main alpha.50 + re-port peer-transport; RocksDB both; wipe groove.surrealkv"
    status: pending
  - id: npm-bump-eval
    content: Out of scope — aven-ceo / npm jazz-tools
    status: cancelled
isProject: false
---

# Jazz vendored vs upstream — gap analysis (archived)

**This plan is superseded.** Use the execution plan:

**[jazz_upstream_re-vendor_2560abaa.plan.md](/Users/samuelandert/.cursor/plans/jazz_upstream_re-vendor_2560abaa.plan.md)**

## Quick status (May 28, 2026)

- **Phase 1 done:** `client-p2p` feature (commit `ed80d2b`) — compile-time trim, no HTTP deps in Tauri builds
- **Upstream mirror stale:** local `jazz2-upstream` at alpha.**49** / `2517141`; `origin/main` is alpha.**50** / `232a9933`
- **Next:** refresh mirror → physical strip-down of dead vendor files → iOS RocksDB spike → full re-vendor

See superseding plan for strip-down tables (delete vs keep vs cfg-gate) and phased execution.
