//! Board 0026 (M4): the decrypt-once mirror CONVERGES with the store after both a LOCAL write
//! and a SYNCED (peer) write — proving freshness rides aven-db's `frontier_epoch()`, not write
//! origin. Two `Brain`s sharing one store + owner + key model two devices of one identity; a
//! write by device B is, to device A, exactly a synced peer batch landing in the shared store.
//!
//! Own integration binary so the process-global epoch is isolated from parallel tests.

use std::sync::Arc;

use aven_brain::{brain_schema, Brain, ContextOptions, KeySealer, RememberOptions, Sealer, StubEmbedder, EMBED_DIM};
use aven_db::{AppContext, AppId, AvenDbClient, NullSyncTransport, ObjectId};

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

fn talk_opts() -> RememberOptions {
    RememberOptions { stream: "talk".to_string(), author_role: "user".to_string(), ..Default::default() }
}

#[tokio::test]
async fn mirror_converges_after_local_and_synced_writes() {
    let owner = ObjectId::new();
    let key = [9u8; 32];
    let client = mem_client("converge").await;
    let device = |c: Arc<AvenDbClient>| {
        Brain::over(
            c,
            owner,
            StubEmbedder::new(EMBED_DIM),
            Arc::new(KeySealer::new(key, *owner.uuid(), 1)) as Arc<dyn Sealer>,
        )
    };
    let device_a = device(client.clone());
    let device_b = device(client.clone()); // a second device that syncs into the same store

    let ctx = ContextOptions::default();
    // Prime A's mirror (empty store).
    let _ = device_a.assemble_context("hello", &ctx).await.expect("prime A");

    // Local write on A → A's next assemble must reflect it (epoch advanced → rebuild).
    device_a.remember_with("the apple is local", &talk_opts()).await.expect("local write");
    let after_local = device_a.assemble_context("apple banana", &ctx).await.expect("A after local");
    assert!(
        after_local.prompt.contains("apple"),
        "A's mirror reflects its own local write:\n{}",
        after_local.prompt
    );

    // SYNCED write: device B writes — a peer batch landing in the shared store. A made no write.
    device_b.remember_with("the banana is synced from a peer", &talk_opts()).await.expect("synced write");
    let after_synced = device_a.assemble_context("apple banana", &ctx).await.expect("A after synced");
    assert!(
        after_synced.prompt.contains("banana"),
        "A's mirror CONVERGES with a write it did not make (the synced peer write):\n{}",
        after_synced.prompt
    );
    // Both writes are present together — full convergence, not a partial view.
    assert!(
        after_synced.prompt.contains("apple") && after_synced.prompt.contains("banana"),
        "A's mirror holds BOTH the local and the synced write:\n{}",
        after_synced.prompt
    );
}
