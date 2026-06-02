//! P0 spike — prove peeroxide connects two nodes over a **local** bootstrap DHT
//! (no public network) and exchanges a frame over the encrypted SecretStream.
//!
//! Run: `cargo run -p aven-p2p --example swarm_smoke`
//! Expect: "A read 10 bytes: hello-aven" within a few seconds.

use std::time::Duration;

use aven_p2p::{join_opts, local_bootstrap_config, member_config, spark_topic};
use peeroxide::spawn;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("aven_p2p=debug,peeroxide=info,warn")
        .try_init();

    let bport = 49737u16;

    // 1. Local bootstrap DHT node (the offline dev DHT).
    let (_bt, _bh, _brx) = spawn(local_bootstrap_config(bport)).await?;
    println!("bootstrap up on 127.0.0.1:{bport}");
    tokio::time::sleep(Duration::from_millis(800)).await;

    let boot = vec![format!("127.0.0.1:{bport}")];
    let topic = spark_topic("spark:smoke");

    // 2. Node A — announce + lookup.
    let (_ta, ha, mut rxa) = spawn(member_config([1u8; 32], boot.clone())).await?;
    ha.join(topic, join_opts(true, true)).await?;
    println!("A joined topic");

    // 3. Node B — announce + lookup.
    let (_tb, hb, mut rxb) = spawn(member_config([2u8; 32], boot.clone())).await?;
    hb.join(topic, join_opts(true, true)).await?;
    println!("B joined topic");

    // 4. A accepts a connection and reads one frame; B connects and writes one.
    let server = tokio::spawn(async move {
        match rxa.recv().await {
            Some(mut conn) => {
                println!("A: peer {}", hex::encode(conn.remote_public_key()));
                match conn.peer.stream.read().await {
                    Ok(Some(msg)) => {
                        println!("A read {} bytes: {}", msg.len(), String::from_utf8_lossy(&msg))
                    }
                    other => println!("A read ended: {other:?}"),
                }
            }
            None => println!("A: no peer"),
        }
    });

    let client = tokio::spawn(async move {
        match rxb.recv().await {
            Some(mut conn) => {
                println!("B: peer {}", hex::encode(conn.remote_public_key()));
                if let Err(e) = conn.peer.stream.write(b"hello-aven").await {
                    println!("B write err: {e}");
                }
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
            None => println!("B: no peer"),
        }
    });

    match tokio::time::timeout(Duration::from_secs(25), async {
        let _ = tokio::join!(server, client);
    })
    .await
    {
        Ok(_) => println!("smoke done"),
        Err(_) => {
            println!("SMOKE TIMEOUT — peers did not connect via local bootstrap");
            std::process::exit(1);
        }
    }
    Ok(())
}
