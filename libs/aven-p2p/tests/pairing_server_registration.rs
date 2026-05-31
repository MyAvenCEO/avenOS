//! Pairing server registration stays alive across topic leave until session ends.

use aven_p2p::{spawn, JoinOpts};

#[tokio::test]
async fn leave_pairing_topic_defers_unregister_until_disarm() {
	let (_task, handle, _conn_rx) = spawn(Default::default()).await.unwrap();
	let topic = [0x44; 32];
	handle.join(topic, JoinOpts::fast_refresh()).await.unwrap();
	handle.set_active_pair_topic(Some(topic)).await.unwrap();
	// Transient topic leave (e.g. invite cancel step) must not drop server forward entry.
	handle.leave(topic).await.unwrap();
	handle.set_active_pair_topic(None).await.unwrap();
	handle.destroy().await.unwrap();
}
