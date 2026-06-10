//! UI drain orchestration — coalesced table-change snapshots for the webview.

use std::collections::HashSet;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_self::state::SelfState;

use crate::identity_sync;

use super::*;

const TABLE_DRAIN_FOLLOW_UP: Duration = Duration::from_millis(120);

/// Second drain pass after peer sync apply — row-batch frames can land after the first flush.
fn schedule_table_drain_follow_up(app: tauri::AppHandle, tables: HashSet<String>) {
	tauri::async_runtime::spawn(async move {
		tokio::time::sleep(TABLE_DRAIN_FOLLOW_UP).await;
		let drain = ui_drain::ui_table_drain(&app);
		if let Err(e) = drain.enqueue(tables).await {
			log::trace!(
				target: "avenos::jazz",
				"table-change drain follow-up enqueue failed: {e}",
			);
		}
	});
}

/// Runs one coalesced UI drain batch (shell hydrate + snapshots). Never enqueued on the Groove actor.
pub(crate) async fn execute_drain_batch(
	app: &tauri::AppHandle,
	jazz: &ManagedJazz,
	self_state: &SelfState,
	mut pending: std::collections::HashSet<String>,
) {
	// A pending vault-shell table (identities/keyshares/peers) MIGHT mean the shell changed — but
	// inbound peer-sync re-delivers these batches constantly as no-ops, so we confirm an actual
	// content change below (after we have a client) before paying for a re-hydrate.
	let vault_shell_maybe_dirty = pending
		.iter()
		.any(|t| identity_sync::is_vault_shell_table(t));

	let peers_pending = pending.remove("peers");
	if peers_pending {
		if let Err(e) = publish_trusted_peers_ui(app, jazz, self_state).await {
			log::warn!(
				target: "avenos::jazz",
				"table-change drain: publish_trusted_peers_ui failed: {e}",
			);
		}
	}

	let want_snapshots = !pending.is_empty() && jazz.any_ui_subscriber(&pending).await;
	if !vault_shell_maybe_dirty && !want_snapshots {
		if !pending.is_empty() {
			log::trace!(
				target: "avenos::jazz",
				"table-change drain: no UI subscribers for {} table(s), skip",
				pending.len(),
			);
		}
		return;
	}

	let client = match with_connected_client(jazz, app, self_state).await {
		Ok(c) => c,
		Err(_) => return,
	};

	// Only treat the vault shell as dirty when the shell tables' CONTENT actually changed.
	// This is the fix for the constant idle re-hydrate loop: inbound shell-table re-deliveries
	// (frontier re-announce, a non-converged blind relay) used to invalidate + re-hydrate the
	// vault shell every time. A genuine change (new identity-admin grant, keyshare, peer) alters a
	// row, so the content digest changes and we still invalidate + re-hydrate — reactivity is
	// preserved; identical re-deliveries are now a no-op. On a query error we fail safe to dirty.
	let vault_shell_dirty =
		vault_shell_maybe_dirty && jazz.vault_shell_content_changed(client.as_ref()).await;
	if vault_shell_dirty {
		jazz.invalidate_vault_shell();
	}

	// A vault-shell re-hydrate can change row ACCESS for ANY table — a single identity grant
	// unlocks the identity catalogue row AND every data row (todos / messages / files / …) it
	// scopes. So after re-hydrate we refresh GENERICALLY, with no per-table special cases:
	//   • the catalogue (`identities`) ALWAYS — so the identity list updates even off-page, and
	//   • every table the user is currently viewing — so the open page reflects new access.
	// Tables the user is *not* viewing need no push: navigating to them re-`list()`s through
	// the now-hydrated shell. This force-set bypasses the per-table subscriber gate.
	let force_after_rehydrate: Vec<String> = if vault_shell_dirty {
		let mut set: std::collections::HashSet<String> = jazz
			.subscribed_tables()
			.await
			.into_iter()
			.filter(|t| t != "peers") // peers has its own publish path (publish_trusted_peers_ui)
			.collect();
		set.insert("identities".to_string());
		set.into_iter().collect()
	} else {
		Vec::new()
	};

	// Row-batch sync parks inbound frames until `batched_tick`; `recv_inbound` posts to this
	// drain earlier. Flush first so re-hydrate / list queries see peer grant deltas.
	let pairing_active = pairing_session_active(app).await;
	if (vault_shell_dirty || want_snapshots) && !pairing_active {
		if let Err(e) = client.flush_peer_sync().await {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: flush_peer_sync before shell/snapshot: {e}",
			);
		}
	} else if (vault_shell_dirty || want_snapshots) && pairing_active {
		log::trace!(
			target: "avenos::jazz",
			"table-change drain: defer flush_peer_sync — pairing active",
		);
	}

	if pending
		.iter()
		.any(|t| identity_sync::is_spark_data_table(t))
	{
		if let Err(e) = jazz.refresh_sync_acl_object_map(client.as_ref()).await {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: refresh_sync_acl_object_map failed: {e}",
			);
		}
	}

	let mut shell_hydrate_ok = !vault_shell_dirty;
	if vault_shell_dirty {
		match jazz_shell_for_ui(app, jazz, self_state, client.clone()).await {
			Ok(_) => shell_hydrate_ok = true,
			Err(e) => {
				log::warn!(
					target: "avenos::jazz",
					"table-change drain: vault shell re-hydrate failed: {e}",
				);
			}
		}
	}

	if !shell_hydrate_ok {
		return;
	}

	if !want_snapshots && force_after_rehydrate.is_empty() {
		return;
	}

	let shell = match jazz_shell_for_ui(app, jazz, self_state, client.clone()).await {
		Ok(s) => s,
		Err(e) => {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: shell not ready ({e}); skip batch ({} table(s))",
				pending.len(),
			);
			return;
		}
	};

	// (1) Generic force-push after a shell re-hydrate: bypasses the per-table subscriber gate
	// so newly-granted access surfaces immediately (the identity list + whatever page is open),
	// for ANY table — no special cases.
	for table in &force_after_rehydrate {
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			last.remove(table);
		}
		match jazz
			.publish_table_snapshot_force(app, client.as_ref(), shell.as_ref(), table)
			.await
		{
			Ok(()) => log::debug!(
				target: "avenos::jazz",
				"table-change drain: force-published {table} after shell re-hydrate",
			),
			Err(e) => log::warn!(
				target: "avenos::jazz",
				"table-change drain: publish_table_snapshot_force({table}) failed: {e}",
			),
		}
	}

	// (2) Ordinary row changes (no access change) for tables the user is viewing: subscriber-
	// gated snapshot. Skip any table already force-pushed above (dedup would no-op it anyway).
	if want_snapshots {
		let to_broadcast: Vec<String> = pending
			.iter()
			.filter(|t| !force_after_rehydrate.contains(*t))
			.cloned()
			.collect();
		{
			let mut last = jazz
				.last_table_snapshots
				.write()
				.expect("last_table_snapshots poisoned");
			for t in &to_broadcast {
				last.remove(t);
			}
		}
		for table in to_broadcast {
			match jazz
				.snapshot_broadcast(app, client.as_ref(), shell.as_ref(), &table)
				.await
			{
				Ok(true) => log::debug!(
					target: "avenos::jazz",
					"table-change drain: republished {table}",
				),
				Ok(false) => {}
				Err(e) => log::warn!(
					target: "avenos::jazz",
					"table-change drain: snapshot_broadcast({table}) failed: {e}",
				),
			}
		}
	}

	let snapshot_tables: HashSet<String> = pending
		.iter()
		.cloned()
		.chain(force_after_rehydrate.iter().cloned())
		.collect();
	if !snapshot_tables.is_empty() {
		schedule_table_drain_follow_up(app.clone(), snapshot_tables);
	}
}

/// Background loop that coalesces table-change notifications into one `snapshot_broadcast`
/// per table per ~25ms window. Spawned once from `tauri::Builder::setup`.
///
/// Why coalesce: a single inbound sync delta from a peer can fire many `ObjectUpdated`
/// commits in quick succession for the same table; without coalescing we'd re-query the
/// store and serialize the snapshot once per commit, which is wasted work and noisy on
/// the event channel.
///
/// Why on a separate task: peer-sync's `recv_inbound` is called from inside the Groove
/// sync loop, which holds its own locks. Doing the snapshot query inline would risk
/// re-entering the `JazzConn` mutex and stalling Groove. Posting to an unbounded MPSC
/// keeps `recv_inbound` non-blocking; the drain task takes the locks at its own pace.
pub async fn run_table_change_drain(
	app: tauri::AppHandle,
	mut rx: tokio::sync::mpsc::UnboundedReceiver<String>,
) {
	use std::collections::HashSet;
	use std::time::Duration;

	// Headroom for peer `push_sync_inbox` → `batched_tick` apply before we flush + re-query.
	const COALESCE_WINDOW: Duration = Duration::from_millis(50);

	loop {
		let Some(first) = rx.recv().await else {
			log::debug!(
				target: "avenos::jazz",
				"table-change drain: channel closed, exiting",
			);
			return;
		};
		let mut pending: HashSet<String> = HashSet::new();
		pending.insert(first);

		let sleep = tokio::time::sleep(COALESCE_WINDOW);
		tokio::pin!(sleep);
		loop {
			tokio::select! {
				_ = &mut sleep => break,
				next = rx.recv() => match next {
					Some(t) => { pending.insert(t); }
					None => return,
				}
			}
		}

		let drain = app.state::<ui_drain::UiTableDrainHandle>();
		if let Err(e) = drain.enqueue(pending).await {
			log::warn!(
				target: "avenos::jazz",
				"table-change drain: failed to enqueue batch on ui drain: {e}",
			);
		}
	}
}

pub(super) async fn enqueue_vault_catalogue_drain(app: &tauri::AppHandle) {
	use std::collections::HashSet;

	let mut tables = HashSet::new();
	for t in identity_sync::VAULT_CATALOGUE_UI_TABLES {
		tables.insert(t.to_string());
	}
	let drain = ui_drain::ui_table_drain(app);
	if let Err(e) = drain.enqueue(tables).await {
		log::debug!(
			target: "avenos::jazz",
			"vault catalogue drain enqueue failed: {e}",
		);
	}
}
