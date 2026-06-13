//! Store change-log — the frontier-driven freshness SSOT + delta feed (board 0026/0027).
//!
//! A bounded, monotonic in-memory append-log of committed history-row ids, in commit order,
//! written wherever a history batch lands — LOCAL writes AND SYNCED peer applies both funnel
//! through the storage sink (`apply_prepared`/`apply_encoded_row_mutation`) that calls [`record`].
//!
//! - [`current`] — the latest sequence (total ever recorded). The O(1) "did anything change since
//!   I last looked?" gate (`AvenDbClient::frontier_epoch`).
//! - [`changes_since`] — the delta a consumer applies: `Delta(ids)` (the row ids changed since the
//!   cursor, deduped latest-wins) or `Resync` (the cursor is older than the retained window — the
//!   consumer must full-rebuild, exactly as a far-behind peer re-syncs from genesis).
//!
//! One structure, one version notion: the sequence is the SSOT cursor space; every reader (a
//! brain cache, a UI store, a remote peer) holds a cursor and reconciles via `changes_since` —
//! the same shape device↔device sync uses, in-process. The consumer supplies only "apply this
//! changed row to my view"; aven-db owns the feed.
//!
//! Bounded: the log retains the most recent [`LOG_CAP`] entries; older entries are dropped and a
//! consumer whose cursor predates them gets `Resync`. Per-process + in-memory: on restart a
//! consumer full-rebuilds once (cursor 0 ⇒ Resync once the log has wrapped, else a clean delta).

use std::sync::{Mutex, OnceLock};

use crate::object::ObjectId;

/// Retained recent-change window. A cursor older than `current() - retained` gets `Resync`.
/// Generous so steady-state consumers always get a delta; bounds memory at ~16 bytes × cap.
const LOG_CAP: usize = 100_000;

/// The frontier delta for a consumer: the changed ids since its cursor, or "re-sync from scratch"
/// when its cursor fell out of the retained window.
#[derive(Debug, Clone)]
pub enum Changes {
    Delta(Vec<ObjectId>),
    Resync,
}

struct ChangeLog {
    entries: Vec<ObjectId>,
    /// Count of entries dropped off the front (the base sequence: `entries[0]` is seq `dropped`).
    dropped: u64,
}

fn log() -> &'static Mutex<ChangeLog> {
    static LOG: OnceLock<Mutex<ChangeLog>> = OnceLock::new();
    LOG.get_or_init(|| Mutex::new(ChangeLog { entries: Vec::new(), dropped: 0 }))
}

/// Record committed history-row ids (local write OR synced apply) — called at the storage sink.
pub fn record<I: IntoIterator<Item = ObjectId>>(ids: I) {
    let mut l = log().lock().unwrap();
    l.entries.extend(ids);
    if l.entries.len() > LOG_CAP {
        let overflow = l.entries.len() - LOG_CAP;
        l.entries.drain(..overflow);
        l.dropped += overflow as u64;
    }
}

/// The current store sequence (total changes ever recorded). O(1) freshness gate; stable when
/// nothing has committed; independent of row count.
pub fn current() -> u64 {
    let l = log().lock().unwrap();
    l.dropped + l.entries.len() as u64
}

/// The delta since `cursor` + the new cursor. `Resync` when `cursor` predates the retained window.
pub fn changes_since(cursor: u64) -> (u64, Changes) {
    let l = log().lock().unwrap();
    let next = l.dropped + l.entries.len() as u64;
    if cursor < l.dropped {
        return (next, Changes::Resync);
    }
    let start = (cursor - l.dropped) as usize;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for id in l.entries[start.min(l.entries.len())..].iter().rev() {
        if seen.insert(*id) {
            out.push(*id);
        }
    }
    out.reverse();
    (next, Changes::Delta(out))
}
