use super::*;
use crate::batch_fate::{CapturedFrontierMember, SealedBatchMember, SealedBatchSubmission};
use crate::query_manager::session::WriteContext;
use crate::query_manager::types::{
    ColumnType, SchemaBuilder, SchemaHash, TableName, TableSchema,
};
use crate::row_format::encode_row;
use crate::row_histories::BatchId;
use crate::schema_manager::AppId;
use crate::storage::{
    MemoryStorage, RawTableKeys, RawTableRows, RowLocator, Storage, StorageError,
};
use crate::sync_manager::{
    PeerId, Destination, DurabilityTier, InboxEntry, OutboxEntry, Source,
    SyncManager, SyncPayload,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

type TestCore = RuntimeCore<MemoryStorage, NoopScheduler>;
type BoxedStorageTestCore = RuntimeCore<Box<dyn Storage>, NoopScheduler>;

fn new_test_core<S: Storage, Sch: Scheduler>(
    schema_manager: SchemaManager,
    storage: S,
    scheduler: Sch,
) -> RuntimeCore<S, Sch> {
    let mut core = RuntimeCore::new(schema_manager, storage, scheduler);
    core.set_sync_sender(Box::new(VecSyncSender::new()));
    core
}

struct RowRegionReadFailingStorage {
    inner: MemoryStorage,
    fail_visible_row_reads: bool,
    fail_row_locator_scans: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct LegacyStorageCallCounts;

struct LegacyPersistenceObservingStorage {
    inner: MemoryStorage,
    _calls: Arc<Mutex<LegacyStorageCallCounts>>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct RowMutationCallCounts {
    row_mutation_calls: usize,
    separate_index_mutation_calls: usize,
    flush_wal_calls: usize,
    local_batch_record_get_calls: usize,
}

struct RowMutationObservingStorage {
    inner: MemoryStorage,
    calls: Arc<Mutex<RowMutationCallCounts>>,
}

#[derive(Clone, Default)]
struct CountingScheduler {
    schedule_calls: Arc<Mutex<usize>>,
}

impl RowRegionReadFailingStorage {
    fn with_row_locator_scan_failure() -> Self {
        Self {
            inner: MemoryStorage::new(),
            fail_visible_row_reads: false,
            fail_row_locator_scans: true,
        }
    }
}

impl LegacyPersistenceObservingStorage {
    fn new(calls: Arc<Mutex<LegacyStorageCallCounts>>) -> Self {
        Self {
            inner: MemoryStorage::new(),
            _calls: calls,
        }
    }
}

impl RowMutationObservingStorage {
    fn new(calls: Arc<Mutex<RowMutationCallCounts>>) -> Self {
        Self {
            inner: MemoryStorage::new(),
            calls,
        }
    }
}

impl CountingScheduler {
    fn schedule_count(&self) -> usize {
        *self.schedule_calls.lock().unwrap()
    }
}

impl Scheduler for CountingScheduler {
    fn schedule_batched_tick(&self) {
        *self.schedule_calls.lock().unwrap() += 1;
    }
}

impl Storage for RowRegionReadFailingStorage {
    fn apply_encoded_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::storage::OwnedHistoryRowBytes],
        visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.inner
            .apply_encoded_row_mutation(table, history_rows, visible_rows, index_mutations)
    }

    fn apply_prepared_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::row_histories::StoredRowBatch],
        visible_entries: &[crate::row_histories::VisibleRowEntry],
        encoded_history_rows: &[crate::storage::OwnedHistoryRowBytes],
        encoded_visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.inner.apply_prepared_row_mutation(
            table,
            history_rows,
            visible_entries,
            encoded_history_rows,
            encoded_visible_rows,
            index_mutations,
        )
    }

    fn scan_row_locators(&self) -> Result<crate::storage::RowLocatorRows, StorageError> {
        if self.fail_row_locator_scans {
            return Err(StorageError::IoError(
                "row-locator scans deliberately disabled in this test".to_string(),
            ));
        }
        self.inner.scan_row_locators()
    }

    fn load_row_locator(
        &self,
        id: ObjectId,
    ) -> Result<Option<crate::storage::RowLocator>, StorageError> {
        self.inner.load_row_locator(id)
    }

    fn put_row_locator(
        &mut self,
        id: ObjectId,
        locator: Option<&crate::storage::RowLocator>,
    ) -> Result<(), StorageError> {
        self.inner.put_row_locator(id, locator)
    }

    fn raw_table_put(&mut self, table: &str, key: &str, value: &[u8]) -> Result<(), StorageError> {
        self.inner.raw_table_put(table, key, value)
    }

    fn raw_table_delete(&mut self, table: &str, key: &str) -> Result<(), StorageError> {
        self.inner.raw_table_delete(table, key)
    }

    fn raw_table_get(&self, table: &str, key: &str) -> Result<Option<Vec<u8>>, StorageError> {
        self.inner.raw_table_get(table, key)
    }

    fn raw_table_scan_prefix(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_prefix(table, prefix)
    }

    fn raw_table_scan_prefix_keys(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_prefix_keys(table, prefix)
    }

    fn raw_table_scan_range(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_range(table, start, end)
    }

    fn raw_table_scan_range_keys(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_range_keys(table, start, end)
    }

    fn append_history_region_rows(
        &mut self,
        table: &str,
        rows: &[crate::row_histories::StoredRowBatch],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_rows(table, rows)
    }

    fn append_history_region_row_bytes(
        &mut self,
        table: &str,
        rows: &[crate::storage::HistoryRowBytes<'_>],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_row_bytes(table, rows)
    }

    fn upsert_visible_region_rows(
        &mut self,
        table: &str,
        entries: &[crate::row_histories::VisibleRowEntry],
    ) -> Result<(), StorageError> {
        self.inner.upsert_visible_region_rows(table, entries)
    }

    fn delete_visible_region_row(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner.delete_visible_region_row(table, branch, row_id)
    }

    fn patch_row_region_rows_by_batch(
        &mut self,
        table: &str,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<(), StorageError> {
        self.inner
            .patch_row_region_rows_by_batch(table, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner
            .patch_exact_row_batch(table, branch, row_id, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch_for_schema_hash(
        &mut self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner.patch_exact_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
            state,
            confirmed_tier,
        )
    }

    fn scan_visible_region(
        &self,
        table: &str,
        branch: &str,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region(table, branch)
    }

    fn load_visible_region_row(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        if self.fail_visible_row_reads {
            return Err(StorageError::IoError(
                "row-history reads deliberately disabled in this test".to_string(),
            ));
        }
        self.inner.load_visible_region_row(table, branch, row_id)
    }

    fn load_visible_region_frontier(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<Vec<crate::row_histories::BatchId>>, StorageError> {
        self.inner
            .load_visible_region_frontier(table, branch, row_id)
    }

    fn capture_family_visible_frontier(
        &self,
        target_branch_name: crate::object::BranchName,
    ) -> Result<Vec<crate::batch_fate::CapturedFrontierMember>, StorageError> {
        self.inner
            .capture_family_visible_frontier(target_branch_name)
    }

    fn scan_visible_region_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region_row_batches(table, row_id)
    }

    fn scan_history_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_row_batches(table, row_id)
    }

    fn load_history_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_query_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_row_batch_for_schema_hash(
        &self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.load_history_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
        )
    }

    fn load_history_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch_any_branch(table, row_id, batch_id)
    }

    fn load_history_query_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch_any_branch(table, row_id, batch_id)
    }

    fn row_batch_exists(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<bool, StorageError> {
        self.inner.row_batch_exists(table, branch, row_id, batch_id)
    }

    fn scan_row_branch_tip_ids(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::BatchId>, StorageError> {
        self.inner.scan_row_branch_tip_ids(table, branch, row_id)
    }

    fn load_history_row_batch_bytes(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<Vec<u8>>, StorageError> {
        self.inner
            .load_history_row_batch_bytes(table, branch, row_id, batch_id)
    }

    fn scan_history_region_bytes(
        &self,
        table: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<Vec<u8>>, StorageError> {
        self.inner.scan_history_region_bytes(table, scan)
    }

    fn scan_history_region(
        &self,
        table: &str,
        branch: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_region(table, branch, scan)
    }

    fn index_insert(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_insert(table, column, branch, value, row_id)
    }

    fn index_remove(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_remove(table, column, branch, value, row_id)
    }

    fn index_lookup(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
    ) -> Vec<ObjectId> {
        self.inner.index_lookup(table, column, branch, value)
    }

    fn index_range(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        start: std::ops::Bound<&Value>,
        end: std::ops::Bound<&Value>,
    ) -> Vec<ObjectId> {
        self.inner.index_range(table, column, branch, start, end)
    }

    fn index_scan_all(&self, table: &str, column: &str, branch: &str) -> Vec<ObjectId> {
        self.inner.index_scan_all(table, column, branch)
    }

    fn flush(&self) -> Result<(), StorageError> {
        self.inner.flush()
    }

    fn flush_wal(&self) -> Result<(), StorageError> {
        self.inner.flush_wal()
    }

    fn close(&self) -> Result<(), StorageError> {
        self.inner.close()
    }
}

impl Storage for LegacyPersistenceObservingStorage {
    fn apply_encoded_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::storage::OwnedHistoryRowBytes],
        visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.inner
            .apply_encoded_row_mutation(table, history_rows, visible_rows, index_mutations)
    }

    fn apply_prepared_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::row_histories::StoredRowBatch],
        visible_entries: &[crate::row_histories::VisibleRowEntry],
        encoded_history_rows: &[crate::storage::OwnedHistoryRowBytes],
        encoded_visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.inner.apply_prepared_row_mutation(
            table,
            history_rows,
            visible_entries,
            encoded_history_rows,
            encoded_visible_rows,
            index_mutations,
        )
    }

    fn scan_row_locators(&self) -> Result<crate::storage::RowLocatorRows, StorageError> {
        self.inner.scan_row_locators()
    }

    fn load_row_locator(
        &self,
        id: ObjectId,
    ) -> Result<Option<crate::storage::RowLocator>, StorageError> {
        self.inner.load_row_locator(id)
    }

    fn put_row_locator(
        &mut self,
        id: ObjectId,
        locator: Option<&crate::storage::RowLocator>,
    ) -> Result<(), StorageError> {
        self.inner.put_row_locator(id, locator)
    }

    fn raw_table_put(&mut self, table: &str, key: &str, value: &[u8]) -> Result<(), StorageError> {
        self.inner.raw_table_put(table, key, value)
    }

    fn raw_table_delete(&mut self, table: &str, key: &str) -> Result<(), StorageError> {
        self.inner.raw_table_delete(table, key)
    }

    fn raw_table_get(&self, table: &str, key: &str) -> Result<Option<Vec<u8>>, StorageError> {
        self.inner.raw_table_get(table, key)
    }

    fn raw_table_scan_prefix(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_prefix(table, prefix)
    }

    fn raw_table_scan_prefix_keys(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_prefix_keys(table, prefix)
    }

    fn raw_table_scan_range(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_range(table, start, end)
    }

    fn raw_table_scan_range_keys(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_range_keys(table, start, end)
    }

    fn append_history_region_rows(
        &mut self,
        table: &str,
        rows: &[crate::row_histories::StoredRowBatch],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_rows(table, rows)
    }

    fn append_history_region_row_bytes(
        &mut self,
        table: &str,
        rows: &[crate::storage::HistoryRowBytes<'_>],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_row_bytes(table, rows)
    }

    fn upsert_visible_region_rows(
        &mut self,
        table: &str,
        entries: &[crate::row_histories::VisibleRowEntry],
    ) -> Result<(), StorageError> {
        self.inner.upsert_visible_region_rows(table, entries)
    }

    fn delete_visible_region_row(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner.delete_visible_region_row(table, branch, row_id)
    }

    fn patch_row_region_rows_by_batch(
        &mut self,
        table: &str,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<(), StorageError> {
        self.inner
            .patch_row_region_rows_by_batch(table, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner
            .patch_exact_row_batch(table, branch, row_id, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch_for_schema_hash(
        &mut self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner.patch_exact_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
            state,
            confirmed_tier,
        )
    }

    fn scan_visible_region(
        &self,
        table: &str,
        branch: &str,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region(table, branch)
    }

    fn load_visible_region_row(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.load_visible_region_row(table, branch, row_id)
    }

    fn load_visible_region_frontier(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<Vec<crate::row_histories::BatchId>>, StorageError> {
        self.inner
            .load_visible_region_frontier(table, branch, row_id)
    }

    fn capture_family_visible_frontier(
        &self,
        target_branch_name: crate::object::BranchName,
    ) -> Result<Vec<crate::batch_fate::CapturedFrontierMember>, StorageError> {
        self.inner
            .capture_family_visible_frontier(target_branch_name)
    }

    fn scan_visible_region_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region_row_batches(table, row_id)
    }

    fn scan_history_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_row_batches(table, row_id)
    }

    fn load_history_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_query_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_row_batch_for_schema_hash(
        &self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.load_history_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
        )
    }

    fn load_history_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch_any_branch(table, row_id, batch_id)
    }

    fn load_history_query_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch_any_branch(table, row_id, batch_id)
    }

    fn row_batch_exists(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<bool, StorageError> {
        self.inner.row_batch_exists(table, branch, row_id, batch_id)
    }

    fn scan_row_branch_tip_ids(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::BatchId>, StorageError> {
        self.inner.scan_row_branch_tip_ids(table, branch, row_id)
    }

    fn load_history_row_batch_bytes(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<Vec<u8>>, StorageError> {
        self.inner
            .load_history_row_batch_bytes(table, branch, row_id, batch_id)
    }

    fn scan_history_region_bytes(
        &self,
        table: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<Vec<u8>>, StorageError> {
        self.inner.scan_history_region_bytes(table, scan)
    }

    fn scan_history_region(
        &self,
        table: &str,
        branch: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_region(table, branch, scan)
    }

    fn index_insert(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_insert(table, column, branch, value, row_id)
    }

    fn index_remove(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_remove(table, column, branch, value, row_id)
    }

    fn index_lookup(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
    ) -> Vec<ObjectId> {
        self.inner.index_lookup(table, column, branch, value)
    }

    fn index_range(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        start: std::ops::Bound<&Value>,
        end: std::ops::Bound<&Value>,
    ) -> Vec<ObjectId> {
        self.inner.index_range(table, column, branch, start, end)
    }

    fn index_scan_all(&self, table: &str, column: &str, branch: &str) -> Vec<ObjectId> {
        self.inner.index_scan_all(table, column, branch)
    }

    fn flush(&self) -> Result<(), StorageError> {
        self.inner.flush()
    }

    fn flush_wal(&self) -> Result<(), StorageError> {
        self.inner.flush_wal()
    }

    fn close(&self) -> Result<(), StorageError> {
        self.inner.close()
    }
}

impl Storage for RowMutationObservingStorage {
    fn apply_encoded_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::storage::OwnedHistoryRowBytes],
        visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.calls.lock().unwrap().row_mutation_calls += 1;
        self.inner
            .apply_encoded_row_mutation(table, history_rows, visible_rows, index_mutations)
    }

    fn apply_prepared_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::row_histories::StoredRowBatch],
        visible_entries: &[crate::row_histories::VisibleRowEntry],
        encoded_history_rows: &[crate::storage::OwnedHistoryRowBytes],
        encoded_visible_rows: &[crate::storage::OwnedVisibleRowBytes],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.calls.lock().unwrap().row_mutation_calls += 1;
        self.inner.apply_prepared_row_mutation(
            table,
            history_rows,
            visible_entries,
            encoded_history_rows,
            encoded_visible_rows,
            index_mutations,
        )
    }

    fn scan_row_locators(&self) -> Result<crate::storage::RowLocatorRows, StorageError> {
        self.inner.scan_row_locators()
    }

    fn load_row_locator(
        &self,
        id: ObjectId,
    ) -> Result<Option<crate::storage::RowLocator>, StorageError> {
        self.inner.load_row_locator(id)
    }

    fn put_row_locator(
        &mut self,
        id: ObjectId,
        locator: Option<&crate::storage::RowLocator>,
    ) -> Result<(), StorageError> {
        self.inner.put_row_locator(id, locator)
    }

    fn raw_table_put(&mut self, table: &str, key: &str, value: &[u8]) -> Result<(), StorageError> {
        self.inner.raw_table_put(table, key, value)
    }

    fn raw_table_delete(&mut self, table: &str, key: &str) -> Result<(), StorageError> {
        self.inner.raw_table_delete(table, key)
    }

    fn raw_table_get(&self, table: &str, key: &str) -> Result<Option<Vec<u8>>, StorageError> {
        if table == "__local_batch_record" && key.starts_with("batch:") {
            self.calls.lock().unwrap().local_batch_record_get_calls += 1;
        }
        self.inner.raw_table_get(table, key)
    }

    fn raw_table_scan_prefix(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_prefix(table, prefix)
    }

    fn raw_table_scan_prefix_keys(
        &self,
        table: &str,
        prefix: &str,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_prefix_keys(table, prefix)
    }

    fn raw_table_scan_range(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableRows, StorageError> {
        self.inner.raw_table_scan_range(table, start, end)
    }

    fn raw_table_scan_range_keys(
        &self,
        table: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<RawTableKeys, StorageError> {
        self.inner.raw_table_scan_range_keys(table, start, end)
    }

    fn append_history_region_rows(
        &mut self,
        table: &str,
        rows: &[crate::row_histories::StoredRowBatch],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_rows(table, rows)
    }

    fn append_history_region_row_bytes(
        &mut self,
        table: &str,
        rows: &[crate::storage::HistoryRowBytes<'_>],
    ) -> Result<(), StorageError> {
        self.inner.append_history_region_row_bytes(table, rows)
    }

    fn upsert_visible_region_rows(
        &mut self,
        table: &str,
        entries: &[crate::row_histories::VisibleRowEntry],
    ) -> Result<(), StorageError> {
        self.inner.upsert_visible_region_rows(table, entries)
    }

    fn delete_visible_region_row(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner.delete_visible_region_row(table, branch, row_id)
    }

    fn apply_row_mutation(
        &mut self,
        table: &str,
        history_rows: &[crate::row_histories::StoredRowBatch],
        visible_entries: &[crate::row_histories::VisibleRowEntry],
        index_mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.calls.lock().unwrap().row_mutation_calls += 1;
        self.inner
            .apply_row_mutation(table, history_rows, visible_entries, index_mutations)
    }

    fn patch_row_region_rows_by_batch(
        &mut self,
        table: &str,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<(), StorageError> {
        self.inner
            .patch_row_region_rows_by_batch(table, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch(
        &mut self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner
            .patch_exact_row_batch(table, branch, row_id, batch_id, state, confirmed_tier)
    }

    fn patch_exact_row_batch_for_schema_hash(
        &mut self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
        state: Option<crate::row_histories::RowState>,
        confirmed_tier: Option<DurabilityTier>,
    ) -> Result<bool, StorageError> {
        self.inner.patch_exact_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
            state,
            confirmed_tier,
        )
    }

    fn scan_visible_region(
        &self,
        table: &str,
        branch: &str,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region(table, branch)
    }

    fn load_visible_region_row(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.load_visible_region_row(table, branch, row_id)
    }

    fn load_visible_region_frontier(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Option<Vec<crate::row_histories::BatchId>>, StorageError> {
        self.inner
            .load_visible_region_frontier(table, branch, row_id)
    }

    fn capture_family_visible_frontier(
        &self,
        target_branch_name: crate::object::BranchName,
    ) -> Result<Vec<crate::batch_fate::CapturedFrontierMember>, StorageError> {
        self.inner
            .capture_family_visible_frontier(target_branch_name)
    }

    fn scan_visible_region_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_visible_region_row_batches(table, row_id)
    }

    fn scan_history_row_batches(
        &self,
        table: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_row_batches(table, row_id)
    }

    fn load_history_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_query_row_batch(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch(table, branch, row_id, batch_id)
    }

    fn load_history_row_batch_for_schema_hash(
        &self,
        table: &str,
        schema_hash: crate::query_manager::types::SchemaHash,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.load_history_row_batch_for_schema_hash(
            table,
            schema_hash,
            branch,
            row_id,
            batch_id,
        )
    }

    fn load_history_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner
            .load_history_row_batch_any_branch(table, row_id, batch_id)
    }

    fn load_history_query_row_batch_any_branch(
        &self,
        table: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<crate::row_histories::QueryRowBatch>, StorageError> {
        self.inner
            .load_history_query_row_batch_any_branch(table, row_id, batch_id)
    }

    fn row_batch_exists(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<bool, StorageError> {
        self.inner.row_batch_exists(table, branch, row_id, batch_id)
    }

    fn scan_row_branch_tip_ids(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
    ) -> Result<Vec<crate::row_histories::BatchId>, StorageError> {
        self.inner.scan_row_branch_tip_ids(table, branch, row_id)
    }

    fn load_history_row_batch_bytes(
        &self,
        table: &str,
        branch: &str,
        row_id: ObjectId,
        batch_id: crate::row_histories::BatchId,
    ) -> Result<Option<Vec<u8>>, StorageError> {
        self.inner
            .load_history_row_batch_bytes(table, branch, row_id, batch_id)
    }

    fn scan_history_region_bytes(
        &self,
        table: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<Vec<u8>>, StorageError> {
        self.inner.scan_history_region_bytes(table, scan)
    }

    fn scan_history_region(
        &self,
        table: &str,
        branch: &str,
        scan: crate::row_histories::HistoryScan,
    ) -> Result<Vec<crate::row_histories::StoredRowBatch>, StorageError> {
        self.inner.scan_history_region(table, branch, scan)
    }

    fn index_insert(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_insert(table, column, branch, value, row_id)
    }

    fn index_remove(
        &mut self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
        row_id: ObjectId,
    ) -> Result<(), StorageError> {
        self.inner
            .index_remove(table, column, branch, value, row_id)
    }

    fn apply_index_mutations(
        &mut self,
        mutations: &[crate::storage::IndexMutation<'_>],
    ) -> Result<(), StorageError> {
        self.calls.lock().unwrap().separate_index_mutation_calls += 1;
        self.inner.apply_index_mutations(mutations)
    }

    fn index_lookup(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        value: &Value,
    ) -> Vec<ObjectId> {
        self.inner.index_lookup(table, column, branch, value)
    }

    fn index_range(
        &self,
        table: &str,
        column: &str,
        branch: &str,
        start: std::ops::Bound<&Value>,
        end: std::ops::Bound<&Value>,
    ) -> Vec<ObjectId> {
        self.inner.index_range(table, column, branch, start, end)
    }

    fn index_scan_all(&self, table: &str, column: &str, branch: &str) -> Vec<ObjectId> {
        self.inner.index_scan_all(table, column, branch)
    }

    fn flush(&self) -> Result<(), StorageError> {
        self.inner.flush()
    }

    fn flush_wal(&self) -> Result<(), StorageError> {
        self.calls.lock().unwrap().flush_wal_calls += 1;
        self.inner.flush_wal()
    }

    fn close(&self) -> Result<(), StorageError> {
        self.inner.close()
    }
}

fn test_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text),
        )
        .build()
}

fn schema_evolution_v1() -> Schema {
    test_schema()
}

fn schema_evolution_v2() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("users")
                .column("id", ColumnType::Uuid)
                .column("name", ColumnType::Text)
                .column("email", ColumnType::Text),
        )
        .build()
}

fn defaulted_todos_schema() -> Schema {
    SchemaBuilder::new()
        .table(
            TableSchema::builder("todos")
                .column("title", ColumnType::Text)
                .column_with_default("done", ColumnType::Boolean, Value::Boolean(false)),
        )
        .build()
}

fn user_row_values(id: ObjectId, name: &str) -> Vec<Value> {
    vec![Value::Uuid(id), Value::Text(name.to_string())]
}

fn user_insert_values(id: ObjectId, name: &str) -> HashMap<String, Value> {
    HashMap::from([
        ("id".to_string(), Value::Uuid(id)),
        ("name".to_string(), Value::Text(name.to_string())),
    ])
}

fn insert_and_wait_for_batch<S: Storage, Sch: Scheduler>(
    core: &mut RuntimeCore<S, Sch>,
    table: &str,
    values: HashMap<String, Value>,
    write_context: Option<&WriteContext>,
    tier: DurabilityTier,
) -> std::result::Result<
    (
        InsertedRow,
        futures::channel::oneshot::Receiver<PersistedWriteAck>,
    ),
    RuntimeError,
> {
    let (row, batch_id) = core.insert(table, values, write_context)?;
    let receiver = core.wait_for_batch(batch_id, tier)?;
    Ok((row, receiver))
}

fn staged_user_row(
    row_id: ObjectId,
    batch_id: BatchId,
    updated_at: u64,
    name: &str,
) -> crate::row_histories::StoredRowBatch {
    crate::row_histories::StoredRowBatch::new_with_batch_id(
        batch_id,
        row_id,
        "main",
        Vec::<BatchId>::new(),
        encode_row(
            &test_schema()[&TableName::new("users")].columns,
            &user_row_values(row_id, name),
        )
        .expect("user test row should encode"),
        crate::metadata::RowProvenance::for_insert(row_id.to_string(), updated_at),
        HashMap::new(),
        crate::row_histories::RowState::StagingPending,
        None,
    )
}

fn project_insert_values(name: &str, owner_id: &str) -> HashMap<String, Value> {
    HashMap::from([
        ("name".to_string(), Value::Text(name.to_string())),
        ("owner_id".to_string(), Value::Text(owner_id.to_string())),
    ])
}

fn todo_insert_values(
    title: &str,
    done: bool,
    description: Value,
    owner_id: &str,
    project: Value,
) -> HashMap<String, Value> {
    HashMap::from([
        ("title".to_string(), Value::Text(title.to_string())),
        ("done".to_string(), Value::Boolean(done)),
        ("description".to_string(), description),
        ("owner_id".to_string(), Value::Text(owner_id.to_string())),
        ("project".to_string(), project),
    ])
}

fn create_runtime_with_schema_and_sync_manager(
    schema: Schema,
    app_name: &str,
    sync_manager: SyncManager,
) -> TestCore {
    let app_id = AppId::from_name(app_name);
    let schema_manager = SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();
    let mut core = new_test_core(schema_manager, MemoryStorage::new(), NoopScheduler);
    core.immediate_tick();
    core
}

fn create_runtime_with_schema(schema: Schema, app_name: &str) -> TestCore {
    create_runtime_with_schema_and_sync_manager(schema, app_name, SyncManager::new())
}

fn create_runtime_with_storage(schema: Schema, app_name: &str, storage: MemoryStorage) -> TestCore {
    create_runtime_with_storage_and_sync_manager(schema, app_name, storage, SyncManager::new())
}

fn create_runtime_with_storage_and_sync_manager(
    schema: Schema,
    app_name: &str,
    storage: MemoryStorage,
    sync_manager: SyncManager,
) -> TestCore {
    let app_id = AppId::from_name(app_name);
    let schema_manager = SchemaManager::new(sync_manager, schema, app_id, "dev", "main").unwrap();
    let mut core = new_test_core(schema_manager, storage, NoopScheduler);
    core.immediate_tick();
    core
}

fn create_runtime_with_boxed_storage(
    schema: Schema,
    app_name: &str,
    storage: Box<dyn Storage>,
) -> BoxedStorageTestCore {
    let app_id = AppId::from_name(app_name);
    let schema_manager =
        SchemaManager::new(SyncManager::new(), schema, app_id, "dev", "main").unwrap();
    let mut core = new_test_core(schema_manager, storage, NoopScheduler);
    core.immediate_tick();
    core
}

fn create_test_runtime() -> TestCore {
    create_runtime_with_schema(test_schema(), "test-app")
}

fn column_index(schema: &Schema, table: &str, column: &str) -> usize {
    schema
        .get(&TableName::new(table))
        .unwrap_or_else(|| panic!("table '{table}' should exist"))
        .columns
        .column_index(column)
        .unwrap_or_else(|| panic!("column '{column}' should exist on table '{table}'"))
}

/// Helper to execute a query synchronously via subscribe/tick/unsubscribe.
fn execute_query(core: &mut TestCore, query: Query) -> Vec<(ObjectId, Vec<Value>)> {
    let sub_id = core
        .schema_manager_mut()
        .query_manager_mut()
        .subscribe(query)
        .unwrap();
    core.immediate_tick();
    let results = core
        .schema_manager_mut()
        .query_manager_mut()
        .get_subscription_results(sub_id);
    core.schema_manager_mut()
        .query_manager_mut()
        .unsubscribe_with_sync(sub_id);
    results
}

fn execute_runtime_query(
    core: &mut TestCore,
    query: Query,
    session: Option<Session>,
) -> Vec<(ObjectId, Vec<Value>)> {
    execute_runtime_query_with_propagation(
        core,
        query,
        session,
        crate::sync_manager::QueryPropagation::Full,
    )
}

fn execute_runtime_query_with_propagation(
    core: &mut TestCore,
    query: Query,
    session: Option<Session>,
    propagation: crate::sync_manager::QueryPropagation,
) -> Vec<(ObjectId, Vec<Value>)> {
    execute_runtime_query_with_durability_and_propagation(
        core,
        query,
        session,
        ReadDurabilityOptions::default(),
        propagation,
    )
}

fn execute_runtime_query_with_durability_and_propagation(
    core: &mut TestCore,
    query: Query,
    session: Option<Session>,
    durability: ReadDurabilityOptions,
    propagation: crate::sync_manager::QueryPropagation,
) -> Vec<(ObjectId, Vec<Value>)> {
    let waker = noop_waker();
    let mut cx = std::task::Context::from_waker(&waker);

    let mut future = core.query_with_propagation(query, session, durability, propagation);

    match Pin::new(&mut future).poll(&mut cx) {
        Poll::Ready(Ok(results)) => results,
        Poll::Ready(Err(err)) => panic!("query should succeed: {err:?}"),
        Poll::Pending => panic!("query should resolve immediately"),
    }
}













fn noop_waker() -> std::task::Waker {
    fn noop(_: *const ()) {}
    fn clone(_: *const ()) -> std::task::RawWaker {
        std::task::RawWaker::new(std::ptr::null(), &VTABLE)
    }
    static VTABLE: std::task::RawWakerVTable =
        std::task::RawWakerVTable::new(clone, noop, noop, noop);
    unsafe { std::task::Waker::from_raw(std::task::RawWaker::new(std::ptr::null(), &VTABLE)) }
}

mod basic;
mod fk_remove_error;
mod schema_catalogue;
mod write_batch;
