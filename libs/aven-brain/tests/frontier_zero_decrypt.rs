//! Board 0026 (M2): cross-turn decrypt-once. A SECOND `assemble_context` with no writes since
//! the first opens ZERO sealed cells (served from the process-global mirror, validated by
//! aven-db's `frontier_epoch()`) and returns the identical hit set.
//!
//! Its own integration binary on purpose: the store epoch is process-global, so isolating this
//! test in its own process means no parallel test can bump the epoch between the two assembles —
//! the brain itself holds NO frontier logic (it purely consumes aven-db's epoch).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use aven_brain::{
    brain_schema, Brain, ContextBundle, ContextOptions, KeySealer, RememberOptions, Sealer,
    StubEmbedder, EMBED_DIM,
};
use aven_db::{AppContext, AppId, AvenDbClient, NullSyncTransport, ObjectId};

/// Counts `open()` (decrypt) calls; delegates everything else to a real `KeySealer`.
struct CountingSealer {
    inner: KeySealer,
    opens: Arc<AtomicUsize>,
}
impl Sealer for CountingSealer {
    fn seal(&self, t: &str, c: &str, r: uuid::Uuid, p: &str) -> Result<String, String> {
        self.inner.seal(t, c, r, p)
    }
    fn open(&self, t: &str, c: &str, r: uuid::Uuid, s: &str) -> Result<String, String> {
        self.opens.fetch_add(1, Ordering::SeqCst);
        self.inner.open(t, c, r, s)
    }
    fn dedup_mac(&self, content: &str) -> Vec<u8> {
        self.inner.dedup_mac(content)
    }
    fn name(&self) -> &'static str {
        "counting"
    }
}

async fn mem_client(app: &str) -> Arc<AvenDbClient> {
    let data_dir = std::env::temp_dir().join(format!("aven-brain-{app}"));
    let _ = std::fs::create_dir_all(&data_dir);
    let context = AppContext {
        app_id: AppId::from_name(app),
        client_id: None,
        schema: brain_schema(EMBED_DIM),
        data_dir,
        live_schemas: Vec::new(),
    };
    Arc::new(
        AvenDbClient::connect_headless_in_memory(context, Arc::new(NullSyncTransport))
            .await
            .expect("in-memory client"),
    )
}

#[tokio::test]
async fn recall_zero_decrypt_on_unchanged_frontier() {
    let owner = ObjectId::new();
    let opens = Arc::new(AtomicUsize::new(0));
    let sealer: Arc<dyn Sealer> = Arc::new(CountingSealer {
        inner: KeySealer::new([7u8; 32], *owner.uuid(), 1),
        opens: opens.clone(),
    });
    let client = mem_client("zero-decrypt").await;
    let brain = Brain::over(client, owner, StubEmbedder::new(EMBED_DIM), sealer);

    let opts = RememberOptions {
        stream: "talk".to_string(),
        author_role: "user".to_string(),
        ..Default::default()
    };
    for i in 0..200 {
        brain
            .remember_with(&format!("memory {i}: a goal was scored in the match"), &opts)
            .await
            .expect("seed");
    }

    let ctx = ContextOptions::default();
    let first = brain.assemble_context("who scored?", &ctx).await.expect("assemble 1");
    assert!(opens.load(Ordering::SeqCst) > 0, "first assemble must decrypt to build the mirror");

    // No writes between the two turns → aven-db's frontier_epoch is unchanged → ZERO decrypt.
    opens.store(0, Ordering::SeqCst);
    let second = brain.assemble_context("who scored?", &ctx).await.expect("assemble 2");
    assert_eq!(
        opens.load(Ordering::SeqCst),
        0,
        "a turn with no writes must decrypt nothing (served from the epoch-validated mirror)"
    );

    let ids = |b: &ContextBundle| b.trace.recalled.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&first), ids(&second), "cached recall returns the identical hit set");
}
