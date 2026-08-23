use std::env;
use std::net::SocketAddr;

use aven_artifact_store_contract::StablePublisher;
use aven_artifact_store_core::{builtin_type_definitions, TypeCatalog};
use aven_artifact_store_postgres::PostgresStore;
use aven_artifact_store_server::{router, AppState, FixedServiceAuth};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aven_artifact_store=info,tower_http=info".into()),
        )
        .init();

    let command = env::args().nth(1).unwrap_or_else(|| "serve".to_owned());
    let database_url = required_env("ARTIFACT_STORE_DATABASE_URL")?;
    let store = PostgresStore::connect(&database_url, 10).await?;
    let catalog = TypeCatalog::from_definitions(builtin_type_definitions()?)?;

    match command.as_str() {
        "migrate" => {
            store.migrate().await?;
            store.register_types(catalog.definitions()).await?;
            tracing::info!("artifact-store schema and built-in types are current");
        }
        "verify" => {
            let context = store.context().await?;
            tracing::info!(
                store_epoch = %context.store_epoch,
                write_mode = %context.write_mode,
                "artifact-store database is reachable"
            );
        }
        "serve" => {
            let scope_id = required_env("ARTIFACT_STORE_SCOPE_ID")?.parse::<Uuid>()?;
            let auth = FixedServiceAuth::new(
                required_env("ARTIFACT_STORE_BEARER_TOKEN")?,
                StablePublisher {
                    issuer: required_env("ARTIFACT_STORE_PUBLISHER_ISSUER")?,
                    subject: required_env("ARTIFACT_STORE_PUBLISHER_SUBJECT")?,
                },
                scope_id,
            )?;
            store.ensure_scope(scope_id).await?;
            let address = env::var("ARTIFACT_STORE_LISTEN")
                .unwrap_or_else(|_| "127.0.0.1:8087".to_owned())
                .parse::<SocketAddr>()?;
            let listener = tokio::net::TcpListener::bind(address).await?;
            tracing::info!(%address, %scope_id, "artifact-store listening");
            axum::serve(listener, router(AppState::new(store, catalog, auth)))
                .with_graceful_shutdown(shutdown_signal())
                .await?;
        }
        other => {
            return Err(
                format!("unknown command {other:?}; expected serve, migrate, or verify").into(),
            )
        }
    }
    Ok(())
}

fn required_env(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(name).map_err(|_| format!("required environment variable {name} is missing").into())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
