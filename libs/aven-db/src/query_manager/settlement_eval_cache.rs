use std::collections::HashMap;

use ahash::AHashSet;

use super::types::Tuple;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) struct RelationSubexprKey {
    pub(crate) site_fingerprint: u64,
    pub(crate) input_fingerprint: u64,
}

#[derive(Debug, Default)]
pub(crate) struct SettlementEvalCache {
    relation_results: HashMap<RelationSubexprKey, AHashSet<Tuple>>,
}

impl SettlementEvalCache {
    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.relation_results.is_empty()
    }

    pub(crate) fn relation_result_get(&self, key: &RelationSubexprKey) -> Option<AHashSet<Tuple>> {
        self.relation_results.get(key).cloned()
    }

    pub(crate) fn relation_result_insert(
        &mut self,
        key: RelationSubexprKey,
        value: AHashSet<Tuple>,
    ) {
        self.relation_results.insert(key, value);
    }
}
