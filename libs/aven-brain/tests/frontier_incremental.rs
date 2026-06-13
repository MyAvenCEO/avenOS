//! Board 0027 (S3 / 0026 M3): the brain consumes aven-db's `changes_since` feed and decrypts ONLY
//! the delta. After N seeded memories, a write turn re-decodes just the changed row(s) — not the
//! whole table. Proven by counting `Sealer::open` calls on the write-turn assemble vs a full build.
//!
//! Own integration binary → the process-global change-log is isolated from parallel tests.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use aven_brain::{brain_schema, Brain, ContextOptions, KeySealer, RememberOptions, Sealer, StubEmbedder, EMBED_DIM};
use aven_db::{AppContext, AppId, AvenDbClient, NullSyncTransport, ObjectId};

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
async fn mirror_applies_only_delta() {
    let owner = ObjectId::new();
    let opens = Arc::new(AtomicUsize::new(0));
    let sealer: Arc<dyn Sealer> = Arc::new(CountingSealer {
        inner: KeySealer::new([5u8; 32], *owner.uuid(), 1),
        opens: opens.clone(),
    });
    let brain = Brain::over(mem_client("incremental").await, owner, StubEmbedder::new(EMBED_DIM), sealer);

    let opts = RememberOptions { stream: "talk".to_string(), author_role: "user".to_string(), ..Default::default() };
    const N: usize = 80;
    for i in 0..N {
        brain.remember_with(&format!("memory {i}: notes for the day"), &opts).await.expect("seed");
    }

    let ctx = ContextOptions::default();
    // First assemble builds the whole mirror (decodes all N rows).
    opens.store(0, Ordering::SeqCst);
    let _ = brain.assemble_context("notes", &ctx).await.expect("full build");
    let full = opens.load(Ordering::SeqCst);
    assert!(full > 0, "first assemble decodes the whole mirror");

    // One write, then a turn. Reset AFTER the write so we measure only the assemble's re-decode.
    brain.remember_with("memory NEW: the one fresh note", &opts).await.expect("delta write");
    opens.store(0, Ordering::SeqCst);
    let _ = brain.assemble_context("notes", &ctx).await.expect("delta build");
    let delta = opens.load(Ordering::SeqCst);

    assert!(delta > 0, "the write-turn assemble decodes the changed row");
    assert!(
        delta * 3 < full,
        "the write turn decrypts only the DELTA, not the whole table (delta {delta} vs full {full})"
    );
}
