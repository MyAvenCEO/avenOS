use super::*;

impl<S: Storage, Sch: Scheduler> RuntimeCore<S, Sch> {
    // =========================================================================
    // Sync Operations
    // =========================================================================

    /// Inject the peer-sync capability gate (§6). The app provides its
    /// biscuit-aware resolver; tests / local-only keep the `AllowAll` default.
    pub fn set_resolver(
        &mut self,
        resolver: std::sync::Arc<dyn crate::capability::CapabilityResolver>,
    ) {
        self.schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .set_resolver(resolver);
    }

    /// Push a sync message to the inbox (from network).
    pub fn push_sync_inbox(&mut self, entry: InboxEntry) {
        if entry.payload.writes_storage() {
            self.mark_storage_write_pending_flush();
        }
        self.schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .push_inbox(entry);
    }

    /// Add a client connection.
    pub fn add_client(&mut self, client_id: PeerId, session: Option<Session>) {
        info!(%client_id, has_session = session.is_some(), "adding client");
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        sm.add_client_with_storage(&self.storage, client_id);
        if let Some(s) = session {
            sm.set_client_session(client_id, s);
        }
        self.immediate_tick();
    }

    /// Ensure a client exists with the given session.
    ///
    /// If the client already exists, updates the session. This is idempotent —
    /// calling with the same session is a no-op. Calling with a new session
    /// updates it in place without resetting the client's role or other state.
    ///
    /// A session is always required — callers must authenticate before
    /// registering a client.
    pub fn ensure_client_with_session(&mut self, client_id: PeerId, session: Session) {
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        if sm.get_client(client_id).is_some() {
            sm.set_client_session(client_id, session);
        } else {
            sm.add_client_with_storage(&self.storage, client_id);
            sm.set_client_session(client_id, session);
            self.immediate_tick();
        }
    }

    /// Remove a client connection.
    ///
    /// Returns `false` if the client has unprocessed messages — either
    /// parked in RuntimeCore (pre-inbox, from `push_sync_inbox`) or
    /// already in SyncManager's inbox. The caller should retry later.
    pub fn remove_client(&mut self, client_id: PeerId) -> bool {
        use crate::sync_manager::Source;

        let has_parked = self
            .parked_sync_messages
            .iter()
            .any(|e| e.source == Source::Client(client_id));
        if has_parked {
            tracing::warn!(
                %client_id,
                "skipping reap: client has parked sync messages"
            );
            return false;
        }

        self.schema_manager
            .query_manager_mut()
            .remove_client(client_id)
    }

    /// Ensure a peer client exists without resetting state.
    pub fn ensure_client_as_peer(&mut self, client_id: PeerId) {
        self.ensure_client_as_peer_with_catalogue_state_hash(client_id, None);
    }

    /// Ensure a peer client exists, then replay catalogue entries only when
    /// the peer's catalogue digest is missing or stale.
    pub fn ensure_client_as_peer_with_catalogue_state_hash(
        &mut self,
        client_id: PeerId,
        remote_catalogue_state_hash: Option<&str>,
    ) {
        let local_catalogue_state_hash = self.schema_manager.catalogue_state_hash();
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();

        if sm.get_client(client_id).is_none() {
            sm.add_client(client_id);
        }

        let queued_catalogue_replay = sm.queue_catalogue_sync_to_client_if_hash_mismatch(
            &self.storage,
            client_id,
            remote_catalogue_state_hash,
            &local_catalogue_state_hash,
        );
        if queued_catalogue_replay {
            self.immediate_tick();
        }
    }

    /// AvenOS: re-queue full row-batch catch-up for a Peer client.
    pub fn rebroadcast_peer_catchup(&mut self, client_id: PeerId) {
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        sm.rebroadcast_peer_catchup(&self.storage, client_id);
        self.immediate_tick();
    }

    /// AvenOS: shell-only catch-up (sparks/keyshares) for pairing bootstrap.
    pub fn rebroadcast_peer_shell_catchup(&mut self, client_id: PeerId) {
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        sm.rebroadcast_peer_shell_catchup(&self.storage, client_id);
        self.immediate_tick();
    }

    /// AvenOS: peer client ids registered for P2P sync.
    pub fn peer_client_ids(&self) -> Vec<PeerId> {
        self.schema_manager
            .query_manager()
            .sync_manager()
            .peer_client_ids()
    }

    /// AvenOS: peers whose frontier is converged from our side (§10.2).
    pub fn converged_peer_ids(&self) -> Vec<PeerId> {
        self.schema_manager
            .query_manager()
            .sync_manager()
            .converged_peer_ids()
    }

    /// AvenOS: replay catch-up for every Peer client (caller should flush after).
    pub fn rebroadcast_all_peer_clients(&mut self) {
        self.clear_all_peer_delivery_ledgers();
        let peer_ids = self.peer_client_ids();
        for peer_id in peer_ids {
            self.rebroadcast_peer_catchup(peer_id);
        }
    }

    /// Forget what we believe was already delivered to a peer (see [`SyncManager::clear_peer_delivery_ledger`]).
    pub fn clear_peer_delivery_ledger(&mut self, client_id: PeerId) {
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        sm.clear_peer_delivery_ledger(client_id);
    }

    fn clear_all_peer_delivery_ledgers(&mut self) {
        let sm = self.schema_manager.query_manager_mut().sync_manager_mut();
        sm.clear_all_peer_delivery_ledgers();
    }

    /// Re-queue a peer outbox entry after transport send failure.
    pub fn prepend_outbox(&mut self, entry: OutboxEntry) {
        self.schema_manager
            .query_manager_mut()
            .sync_manager_mut()
            .prepend_outbox(vec![entry]);
        self.scheduler().schedule_batched_tick();
    }
}
