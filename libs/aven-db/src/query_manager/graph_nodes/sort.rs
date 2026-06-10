use ahash::AHashSet;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::object::ObjectId;
use crate::row_format::{compare_column, decode_column};
use crate::query_manager::types::{
    RowDescriptor, TableName, Tuple, TupleDelta, TupleDescriptor, Value,
};

use super::RowNode;

/// Unseal-on-scan hook (the sealed-data seam, plan §3): maps a stored (possibly
/// sealed) column [`Value`] to its plaintext for ranking. Supplied by the DEK-holding
/// layer; invoked only where `nearest`/`text_search` read values — plaintext exists
/// transiently in RAM, never in results (which carry row ids + stored rows only).
/// Return `None` for unreadable values (they rank last / score zero).
pub type UnsealFn = Arc<dyn Fn(&TableName, &str, &Value) -> Option<Value> + Send + Sync>;

/// `UnsealFn` bound to one (table, column) by [`SortNode::bind_unseal`].
#[derive(Clone)]
struct BoundUnseal(Arc<dyn Fn(&Value) -> Option<Value> + Send + Sync>);

impl std::ops::Deref for BoundUnseal {
    type Target = Arc<dyn Fn(&Value) -> Option<Value> + Send + Sync>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::fmt::Debug for BoundUnseal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BoundUnseal(..)")
    }
}

/// Cosine distance (`1 - cosine_similarity`) between two equal-length vectors.
/// Returns `+inf` for length mismatch and `1.0` for a zero-norm operand so that
/// well-formed candidates always sort ahead of degenerate ones.
pub(crate) fn cosine_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return f32::INFINITY;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom <= 0.0 {
        return 1.0;
    }
    1.0 - (dot / denom).clamp(-1.0, 1.0)
}

/// Lowercase word tokens of length >= 2 (mirrors MemPalace's `\w{2,}` tokenizer).
pub(crate) fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(|t| t.to_lowercase())
        .collect()
}

/// Okapi BM25 (`k1=1.5`, `b=0.75`, Lucene-smoothed IDF) over a candidate set,
/// keyed by row id. Matches MemPalace's `_bm25_scores`. Higher score = more relevant.
pub(crate) fn bm25_scores(
    query_terms: &[String],
    docs: &[(ObjectId, String)],
) -> HashMap<ObjectId, f32> {
    const K1: f32 = 1.5;
    const B: f32 = 0.75;
    let n = docs.len();
    let mut scores: HashMap<ObjectId, f32> = HashMap::with_capacity(n);
    let q: HashSet<String> = query_terms.iter().cloned().collect();
    if q.is_empty() || n == 0 {
        for (id, _) in docs {
            scores.insert(*id, 0.0);
        }
        return scores;
    }
    let tokenized: Vec<(ObjectId, Vec<String>)> =
        docs.iter().map(|(id, d)| (*id, tokenize(d))).collect();
    let total_len: usize = tokenized.iter().map(|(_, t)| t.len()).sum();
    let avgdl = (total_len as f32 / n as f32).max(1.0);

    let mut df: HashMap<String, usize> = HashMap::new();
    for (_, toks) in &tokenized {
        let uniq: HashSet<&String> = toks.iter().collect();
        for term in &q {
            if uniq.contains(&term) {
                *df.entry(term.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut idf: HashMap<String, f32> = HashMap::new();
    for term in &q {
        let dfi = *df.get(term).unwrap_or(&0) as f32;
        idf.insert(
            term.clone(),
            (((n as f32 - dfi + 0.5) / (dfi + 0.5)) + 1.0).ln(),
        );
    }
    for (id, toks) in &tokenized {
        let dl = toks.len() as f32;
        let mut tf: HashMap<&String, usize> = HashMap::new();
        for tok in toks {
            if q.contains(tok) {
                *tf.entry(tok).or_insert(0) += 1;
            }
        }
        let mut score = 0.0f32;
        for (term, freq) in &tf {
            let f = *freq as f32;
            let num = f * (K1 + 1.0);
            let den = f + K1 * (1.0 - B + B * dl / avgdl);
            score += idf.get(*term).copied().unwrap_or(0.0) * num / den;
        }
        scores.insert(*id, score);
    }
    scores
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// Sort specification for a single column.
#[derive(Debug, Clone)]
pub struct SortKey {
    pub target: SortTarget,
    pub direction: SortDirection,
}

/// Field used by a sort key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortTarget {
    Column(usize),
    /// Virtual sort key for object identity (`id`/`_id`).
    ///
    /// This is needed because object ID is not part of row payload columns,
    /// but query semantics allow `ORDER BY id|_id` (including desc and mixed keys).
    RowId,
    /// Virtual sort key for vector similarity: order ascending by cosine distance
    /// from the node's `nearest_query` to the `Vector` value in this column.
    /// Powers `nearest` (exact-cosine top-k). The query vector lives on the node.
    VectorDistance { column: usize },
    /// Virtual sort key for lexical relevance: order by descending BM25 score
    /// (best first). Scores are corpus-dependent, so they are computed over the
    /// whole candidate set and cached on the node (`text_scores`), keyed by row id.
    TextScore,
}

/// Lexical-search state held on a `SortNode` for `SortTarget::TextScore`.
#[derive(Debug, Clone)]
struct TextSearchState {
    /// Index of the `Text` column to score.
    column: usize,
    /// Pre-tokenized query terms.
    query_terms: Vec<String>,
}

/// Threshold: when adding more than this many tuples, use bulk append + sort
/// instead of individual binary-search inserts.
const BULK_ADD_THRESHOLD: usize = 16;

/// Compare two tuples by sort keys without borrowing self.
///
/// Extracted as a free function so it can be used inside `sort_unstable_by`
/// without conflicting borrows on `SortNode` fields.
fn compare_tuples_with(
    sort_keys: &[SortKey],
    descriptor: &RowDescriptor,
    nearest_query: Option<&[f32]>,
    text_scores: Option<&HashMap<ObjectId, f32>>,
    unseal: Option<&BoundUnseal>,
    a: &Tuple,
    b: &Tuple,
) -> Ordering {
    let a_content = a.get(0).and_then(|e| e.content());
    let b_content = b.get(0).and_then(|e| e.content());

    for key in sort_keys {
        let ord = match key.target {
            SortTarget::Column(col_index) => match (a_content, b_content) {
                (Some(a_data), Some(b_data)) => {
                    compare_column(descriptor, a_data, col_index, b_data, col_index)
                        .unwrap_or(Ordering::Equal)
                }
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            },
            SortTarget::RowId => compare_all_ids(a, b),
            SortTarget::VectorDistance { column } => {
                let dist = |content: Option<&[u8]>| -> f32 {
                    match (content, nearest_query) {
                        (Some(data), Some(q)) => match decode_column(descriptor, data, column) {
                            Ok(stored) => {
                                let plain = match unseal {
                                    Some(u) => u(&stored),
                                    None => Some(stored),
                                };
                                match plain {
                                    Some(Value::Vector(v)) => cosine_distance(&v, q),
                                    _ => f32::INFINITY,
                                }
                            }
                            _ => f32::INFINITY,
                        },
                        _ => f32::INFINITY,
                    }
                };
                dist(a_content)
                    .partial_cmp(&dist(b_content))
                    .unwrap_or(Ordering::Equal)
            }
            SortTarget::TextScore => {
                let score = |t: &Tuple| -> f32 {
                    match (t.get(0), text_scores) {
                        (Some(e), Some(scores)) => scores.get(&e.id()).copied().unwrap_or(0.0),
                        _ => 0.0,
                    }
                };
                // Higher BM25 score = more relevant = earlier.
                score(b).partial_cmp(&score(a)).unwrap_or(Ordering::Equal)
            }
        };

        let ord = match key.direction {
            SortDirection::Ascending => ord,
            SortDirection::Descending => ord.reverse(),
        };

        if ord != Ordering::Equal {
            return ord;
        }
    }

    // Stable tie-breaker for deterministic ordering.
    compare_all_ids(a, b)
}

/// Compare tuples by all element IDs lexicographically, without allocating.
///
/// This is the zero-alloc equivalent of `a.ids().cmp(&b.ids())`. It must compare
/// *all* element IDs (not just the first) to produce a deterministic total ordering
/// for joined tuples where multiple rows share the same first_id.
#[inline]
fn compare_all_ids(a: &Tuple, b: &Tuple) -> Ordering {
    for (ea, eb) in a.iter().zip(b.iter()) {
        let ord = ea.id().cmp(&eb.id());
        if ord != Ordering::Equal {
            return ord;
        }
    }
    a.len().cmp(&b.len())
}

/// Sort node for ordering rows.
#[derive(Debug)]
pub struct SortNode {
    descriptor: RowDescriptor,
    /// Output tuple descriptor (same as input - pass-through).
    output_tuple_descriptor: TupleDescriptor,
    sort_keys: Vec<SortKey>,
    /// Query vector for any `SortTarget::VectorDistance` key (exact-cosine `nearest`).
    nearest_query: Option<Vec<f32>>,
    /// Lexical-search state for any `SortTarget::TextScore` key (BM25 `text_search`).
    text_search: Option<TextSearchState>,
    /// Cached BM25 scores by row id; recomputed over the candidate set on change.
    text_scores: HashMap<ObjectId, f32>,
    /// Unseal-on-scan hook bound to this node's ranking column (plan §3 seam).
    unseal: Option<BoundUnseal>,
    /// Current sorted tuples.
    sorted_tuples: Vec<Tuple>,
    /// HashSet view of current tuples (for trait requirement).
    current_tuples: AHashSet<Tuple>,
    dirty: bool,
}

impl SortNode {
    /// Create a SortNode with TupleDescriptor.
    pub fn with_tuple_descriptor(
        tuple_descriptor: TupleDescriptor,
        sort_keys: Vec<SortKey>,
    ) -> Self {
        let descriptor = tuple_descriptor.combined_descriptor();
        Self {
            descriptor,
            output_tuple_descriptor: tuple_descriptor,
            sort_keys,
            nearest_query: None,
            text_search: None,
            text_scores: HashMap::new(),
            unseal: None,
            sorted_tuples: Vec::new(),
            current_tuples: AHashSet::new(),
            dirty: true,
        }
    }

    /// Create a SortNode that orders by ascending cosine distance from `query_vector`
    /// to the `Vector` value in `column` (exact-cosine `nearest`). Pass-through descriptor.
    pub fn with_vector_nearest(
        tuple_descriptor: TupleDescriptor,
        column: usize,
        query_vector: Vec<f32>,
    ) -> Self {
        let descriptor = tuple_descriptor.combined_descriptor();
        Self {
            descriptor,
            output_tuple_descriptor: tuple_descriptor,
            sort_keys: vec![SortKey {
                target: SortTarget::VectorDistance { column },
                direction: SortDirection::Ascending,
            }],
            nearest_query: Some(query_vector),
            text_search: None,
            text_scores: HashMap::new(),
            unseal: None,
            sorted_tuples: Vec::new(),
            current_tuples: AHashSet::new(),
            dirty: true,
        }
    }

    /// Create a SortNode that orders by descending BM25 relevance of `query` against
    /// the `Text` value in `column` (lexical `text_search` top-k). Pass-through descriptor.
    pub fn with_text_search(
        tuple_descriptor: TupleDescriptor,
        column: usize,
        query: &str,
    ) -> Self {
        let descriptor = tuple_descriptor.combined_descriptor();
        Self {
            descriptor,
            output_tuple_descriptor: tuple_descriptor,
            sort_keys: vec![SortKey {
                target: SortTarget::TextScore,
                direction: SortDirection::Ascending,
            }],
            nearest_query: None,
            text_search: Some(TextSearchState {
                column,
                query_terms: tokenize(query),
            }),
            text_scores: HashMap::new(),
            unseal: None,
            sorted_tuples: Vec::new(),
            current_tuples: AHashSet::new(),
            dirty: true,
        }
    }

    /// Bind the unseal-on-scan hook to this node's ranking column (no-op for plain
    /// ORDER BY nodes). `table` is the graph's primary table; the column name is
    /// resolved from this node's descriptor.
    pub fn bind_unseal(&mut self, table: &TableName, hook: &UnsealFn) {
        let column_idx = match (&self.sort_keys.first().map(|k| k.target), &self.text_search) {
            (Some(SortTarget::VectorDistance { column }), _) => Some(*column),
            (_, Some(state)) => Some(state.column),
            _ => None,
        };
        let Some(idx) = column_idx else { return };
        let Some(col) = self.descriptor.columns.get(idx) else {
            return;
        };
        let table = table.clone();
        let column_name = col.name.as_str().to_string();
        let hook = Arc::clone(hook);
        self.unseal = Some(BoundUnseal(Arc::new(move |v: &Value| {
            hook(&table, &column_name, v)
        })));
    }

    /// (Re)compute BM25 scores over the current candidate set, keyed by row id.
    fn recompute_text_scores(&mut self) {
        let (column, query_terms) = match self.text_search.as_ref() {
            Some(state) => (state.column, state.query_terms.clone()),
            None => return,
        };
        let docs: Vec<(ObjectId, String)> = self
            .sorted_tuples
            .iter()
            .filter_map(|t| {
                let elem = t.get(0)?;
                let content = elem.content()?;
                let stored = decode_column(&self.descriptor, content, column).ok();
                let plain = match (&self.unseal, stored) {
                    (Some(u), Some(v)) => u(&v),
                    (None, v) => v,
                    _ => None,
                };
                let doc = match plain {
                    Some(Value::Text(s)) => s,
                    _ => String::new(),
                };
                Some((elem.id(), doc))
            })
            .collect();
        self.text_scores = bm25_scores(&query_terms, &docs);
    }

    /// Get the output tuple descriptor.
    pub fn output_tuple_descriptor(&self) -> &TupleDescriptor {
        &self.output_tuple_descriptor
    }

    /// Find the insertion position for a tuple (binary search).
    fn find_tuple_position(&self, tuple: &Tuple) -> usize {
        let sort_keys = &self.sort_keys;
        let descriptor = &self.descriptor;
        let nearest_query = self.nearest_query.as_deref();
        let unseal = self.unseal.as_ref();
        self.sorted_tuples
            .binary_search_by(|t| {
                compare_tuples_with(sort_keys, descriptor, nearest_query, None, unseal, t, tuple)
            })
            .unwrap_or_else(|pos| pos)
    }

    /// Full current ordering after sort has been applied.
    pub fn sorted_tuples(&self) -> &[Tuple] {
        &self.sorted_tuples
    }
}

impl RowNode for SortNode {
    fn output_descriptor(&self) -> &RowDescriptor {
        &self.descriptor
    }

    fn process(&mut self, input: TupleDelta) -> TupleDelta {
        // Use full tuple IDs (all elements) for identity tracking.
        // `ids()` allocates a Vec<ObjectId> per call, but this only happens once per
        // changed tuple — not in the sort comparison hot path — so the cost is O(k).
        // Using first_id() here would be incorrect for joined tuples where multiple
        // rows share the same first element ID.
        let removed_id_set: AHashSet<Vec<ObjectId>> = input
            .removed
            .iter()
            .chain(input.updated.iter().map(|(old, _)| old))
            .map(|t| t.ids())
            .collect();

        let added_id_set: AHashSet<Vec<ObjectId>> = input.added.iter().map(|t| t.ids()).collect();

        // --- Phase 1: Removals (single retain pass instead of k linear scans) ---
        if !removed_id_set.is_empty() {
            // Incremental hashset: remove entries before modifying the vec.
            for tuple in &input.removed {
                self.current_tuples.remove(tuple);
            }
            for (old, _) in &input.updated {
                self.current_tuples.remove(old);
            }
            // Tuple PartialEq is ID-based, so retain uses the same identity semantics.
            self.sorted_tuples
                .retain(|t| !removed_id_set.contains(&t.ids()));
        }

        // --- Phase 2: Additions ---
        // BM25 scores depend on corpus stats over the whole candidate set, so text
        // search always uses the bulk (full re-sort) path instead of incremental inserts.
        let text_active = self.text_search.is_some();
        let new_count = input.added.len() + input.updated.len();
        let use_bulk =
            text_active || self.sorted_tuples.is_empty() || new_count > BULK_ADD_THRESHOLD;

        if new_count > 0 {
            if use_bulk {
                // Bulk path: append all, then sort once — O(n log n) instead of O(n²) memmoves.
                for tuple in input
                    .added
                    .iter()
                    .chain(input.updated.iter().map(|(_, new)| new))
                {
                    self.current_tuples.insert(tuple.clone());
                    self.sorted_tuples.push(tuple.clone());
                }
                // Text search re-sorts below once scores are (re)computed.
                if !text_active {
                    let sort_keys = &self.sort_keys;
                    let descriptor = &self.descriptor;
                    let nearest_query = self.nearest_query.as_deref();
                    let unseal = self.unseal.as_ref();
                    self.sorted_tuples.sort_unstable_by(|a, b| {
                        compare_tuples_with(sort_keys, descriptor, nearest_query, None, unseal, a, b)
                    });
                }
            } else {
                // Incremental path: binary search + insert for small batches.
                for tuple in input
                    .added
                    .iter()
                    .chain(input.updated.iter().map(|(_, new)| new))
                {
                    self.current_tuples.insert(tuple.clone());
                    let pos = self.find_tuple_position(tuple);
                    self.sorted_tuples.insert(pos, tuple.clone());
                }
            }
        }

        // --- Phase 2b: BM25 (re)score + full re-sort when the candidate set changed ---
        if text_active && (new_count > 0 || !removed_id_set.is_empty()) {
            self.recompute_text_scores();
            let sort_keys = &self.sort_keys;
            let descriptor = &self.descriptor;
            let text_scores = &self.text_scores;
            let unseal = self.unseal.as_ref();
            self.sorted_tuples.sort_unstable_by(|a, b| {
                compare_tuples_with(sort_keys, descriptor, None, Some(text_scores), unseal, a, b)
            });
        }

        // --- Phase 3: Build result delta ---
        let mut result = TupleDelta::new();

        // Added tuples in sorted order (scan sorted_tuples, match against full IDs).
        if !added_id_set.is_empty() {
            let mut remaining = added_id_set;
            for tuple in &self.sorted_tuples {
                if remaining.is_empty() {
                    break;
                }
                if remaining.remove(&tuple.ids()) {
                    result.added.push(tuple.clone());
                }
            }
        }

        // Removed: move from input (no clone).
        result.removed = input.removed;

        // Updated: old from input (moved), new found by tuple equality in sorted_tuples.
        for (old_tuple, _) in input.updated {
            // Tuple equality is ID-based, so find() matches on all element IDs.
            if let Some(new_tuple) = self.sorted_tuples.iter().find(|t| *t == &old_tuple) {
                result.updated.push((old_tuple, new_tuple.clone()));
            }
        }

        self.dirty = false;
        result
    }

    fn current_tuples(&self) -> &AHashSet<Tuple> {
        &self.current_tuples
    }

    fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    fn is_dirty(&self) -> bool {
        self.dirty
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::object::ObjectId;
    use crate::row_format::encode_row;
    use crate::query_manager::types::{ColumnDescriptor, ColumnType, TupleElement, Value};

    fn test_descriptor() -> RowDescriptor {
        RowDescriptor::new(vec![
            ColumnDescriptor::new("id", ColumnType::Integer),
            ColumnDescriptor::new("name", ColumnType::Text),
            ColumnDescriptor::new("score", ColumnType::Integer),
        ])
    }

    fn make_tuple(id: ObjectId, values: &[Value]) -> Tuple {
        let descriptor = test_descriptor();
        let data = encode_row(&descriptor, values).unwrap();
        Tuple::new(vec![TupleElement::Row {
            id,
            content: data.into(),
            batch_id: crate::row_histories::BatchId([0; 16]),
            row_provenance: crate::metadata::RowProvenance::for_insert("jazz:test", 0),
        }])
    }

    fn get_sorted_ids(node: &SortNode) -> Vec<ObjectId> {
        node.sorted_tuples.iter().map(|t| t.ids()[0]).collect()
    }

    fn make_sort_node(sort_keys: Vec<SortKey>) -> SortNode {
        let descriptor = test_descriptor();
        let tuple_desc = TupleDescriptor::single_with_materialization("", descriptor, true);
        SortNode::with_tuple_descriptor(tuple_desc, sort_keys)
    }

    // Scenario: ascending sort by score.
    //
    // ASCII:
    // input:   [A:100, B:50, C:75]
    // sorted:  [B:50, C:75, A:100]
    #[test]
    fn sort_ascending() {
        let sort_keys = vec![SortKey {
            target: SortTarget::Column(2), // score
            direction: SortDirection::Ascending,
        }];
        let mut node = make_sort_node(sort_keys);

        let id1 = ObjectId::new();
        let id2 = ObjectId::new();
        let id3 = ObjectId::new();
        let tuple1 = make_tuple(
            id1,
            &[
                Value::Integer(1),
                Value::Text("A".into()),
                Value::Integer(100),
            ],
        );
        let tuple2 = make_tuple(
            id2,
            &[
                Value::Integer(2),
                Value::Text("B".into()),
                Value::Integer(50),
            ],
        );
        let tuple3 = make_tuple(
            id3,
            &[
                Value::Integer(3),
                Value::Text("C".into()),
                Value::Integer(75),
            ],
        );

        let delta = TupleDelta {
            added: vec![tuple1, tuple2, tuple3],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        };

        node.process(delta);

        let sorted_ids = get_sorted_ids(&node);
        assert_eq!(sorted_ids.len(), 3);
        assert_eq!(sorted_ids[0], id2); // score 50
        assert_eq!(sorted_ids[1], id3); // score 75
        assert_eq!(sorted_ids[2], id1); // score 100
    }

    // Scenario: descending sort by score.
    //
    // ASCII:
    // input:   [A:100, B:50, C:75]
    // sorted:  [A:100, C:75, B:50]
    #[test]
    fn sort_descending() {
        let sort_keys = vec![SortKey {
            target: SortTarget::Column(2), // score
            direction: SortDirection::Descending,
        }];
        let mut node = make_sort_node(sort_keys);

        let id1 = ObjectId::new();
        let id2 = ObjectId::new();
        let id3 = ObjectId::new();
        let tuple1 = make_tuple(
            id1,
            &[
                Value::Integer(1),
                Value::Text("A".into()),
                Value::Integer(100),
            ],
        );
        let tuple2 = make_tuple(
            id2,
            &[
                Value::Integer(2),
                Value::Text("B".into()),
                Value::Integer(50),
            ],
        );
        let tuple3 = make_tuple(
            id3,
            &[
                Value::Integer(3),
                Value::Text("C".into()),
                Value::Integer(75),
            ],
        );

        let delta = TupleDelta {
            added: vec![tuple1, tuple2, tuple3],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        };

        node.process(delta);

        let sorted_ids = get_sorted_ids(&node);
        assert_eq!(sorted_ids.len(), 3);
        assert_eq!(sorted_ids[0], id1); // score 100
        assert_eq!(sorted_ids[1], id3); // score 75
        assert_eq!(sorted_ids[2], id2); // score 50
    }

    // Scenario: multi-key sort (dept asc, score desc).
    //
    // ASCII:
    // dept1: [A:100, B:50]
    // dept2: [D:90,  C:75]
    // final: [A, B, D, C]
    #[test]
    fn sort_multiple_keys() {
        let descriptor = RowDescriptor::new(vec![
            ColumnDescriptor::new("dept", ColumnType::Integer),
            ColumnDescriptor::new("name", ColumnType::Text),
            ColumnDescriptor::new("score", ColumnType::Integer),
        ]);
        let sort_keys = vec![
            SortKey {
                target: SortTarget::Column(0), // dept ascending
                direction: SortDirection::Ascending,
            },
            SortKey {
                target: SortTarget::Column(2), // score descending
                direction: SortDirection::Descending,
            },
        ];
        let tuple_desc = TupleDescriptor::single_with_materialization("", descriptor.clone(), true);
        let mut node = SortNode::with_tuple_descriptor(tuple_desc, sort_keys);

        let id1 = ObjectId::new();
        let id2 = ObjectId::new();
        let id3 = ObjectId::new();
        let id4 = ObjectId::new();

        let make_tuple_local = |id: ObjectId, values: &[Value]| -> Tuple {
            let data = encode_row(&descriptor, values).unwrap();
            Tuple::new(vec![TupleElement::Row {
                id,
                content: data.into(),
                batch_id: crate::row_histories::BatchId([0; 16]),
                row_provenance: crate::metadata::RowProvenance::for_insert("jazz:test", 0),
            }])
        };

        let tuple1 = make_tuple_local(
            id1,
            &[
                Value::Integer(1),
                Value::Text("A".into()),
                Value::Integer(100),
            ],
        );
        let tuple2 = make_tuple_local(
            id2,
            &[
                Value::Integer(1),
                Value::Text("B".into()),
                Value::Integer(50),
            ],
        );
        let tuple3 = make_tuple_local(
            id3,
            &[
                Value::Integer(2),
                Value::Text("C".into()),
                Value::Integer(75),
            ],
        );
        let tuple4 = make_tuple_local(
            id4,
            &[
                Value::Integer(2),
                Value::Text("D".into()),
                Value::Integer(90),
            ],
        );

        let delta = TupleDelta {
            added: vec![tuple1, tuple2, tuple3, tuple4],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        };

        node.process(delta);

        let sorted_ids = get_sorted_ids(&node);
        assert_eq!(sorted_ids.len(), 4);
        // Dept 1, score desc: 100, 50
        assert_eq!(sorted_ids[0], id1); // dept 1, score 100
        assert_eq!(sorted_ids[1], id2); // dept 1, score 50
        // Dept 2, score desc: 90, 75
        assert_eq!(sorted_ids[2], id4); // dept 2, score 90
        assert_eq!(sorted_ids[3], id3); // dept 2, score 75
    }

    // Scenario: insertion uses sorted position (not append order).
    //
    // ASCII:
    // tick1: [A:100]
    // tick2: +B:50
    // final: [B:50, A:100]
    #[test]
    fn sort_maintains_order_on_insert() {
        let sort_keys = vec![SortKey {
            target: SortTarget::Column(2),
            direction: SortDirection::Ascending,
        }];
        let mut node = make_sort_node(sort_keys);

        let id1 = ObjectId::new();
        let id2 = ObjectId::new();
        let tuple1 = make_tuple(
            id1,
            &[
                Value::Integer(1),
                Value::Text("A".into()),
                Value::Integer(100),
            ],
        );

        node.process(TupleDelta {
            added: vec![tuple1],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        });

        // Insert tuple with lower score
        let tuple2 = make_tuple(
            id2,
            &[
                Value::Integer(2),
                Value::Text("B".into()),
                Value::Integer(50),
            ],
        );
        node.process(TupleDelta {
            added: vec![tuple2],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        });

        let sorted_ids = get_sorted_ids(&node);
        assert_eq!(sorted_ids[0], id2); // 50 first
        assert_eq!(sorted_ids[1], id1); // 100 second
    }

    #[test]
    fn sort_by_row_id() {
        let sort_keys = vec![SortKey {
            target: SortTarget::RowId,
            direction: SortDirection::Ascending,
        }];
        let mut node = make_sort_node(sort_keys);

        let id1 = ObjectId::new();
        let id2 = ObjectId::new();
        let id3 = ObjectId::new();
        let tuple1 = make_tuple(
            id1,
            &[
                Value::Integer(1),
                Value::Text("A".into()),
                Value::Integer(5),
            ],
        );
        let tuple2 = make_tuple(
            id2,
            &[
                Value::Integer(2),
                Value::Text("B".into()),
                Value::Integer(5),
            ],
        );
        let tuple3 = make_tuple(
            id3,
            &[
                Value::Integer(3),
                Value::Text("C".into()),
                Value::Integer(5),
            ],
        );

        node.process(TupleDelta {
            added: vec![tuple3, tuple1, tuple2],
            removed: vec![],
            moved: vec![],
            updated: vec![],
        });

        let sorted_ids = get_sorted_ids(&node);
        let mut expected = vec![id1, id2, id3];
        expected.sort();
        assert_eq!(sorted_ids, expected);
    }
}
