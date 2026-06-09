use std::sync::Arc;

use crate::object::{BranchName, ObjectId};
use crate::row_histories::BatchId;
use crate::schema_manager::LensTransformer;
use crate::storage::Storage;

use super::manager::{QueryManager, SchemaWarningAccumulator};
use super::session::Session;
use super::settlement_eval_cache::SettlementEvalCache;
use super::types::{ComposedBranchName, Schema, SchemaHash};

enum AuthorizedTuplesResult {
    Ready(Vec<super::types::Tuple>),
    PermissionsUnavailable,
}

pub(super) struct ResolvedSchemaRow {
    pub branch_name: BranchName,
    pub batch_id: BatchId,
    pub content: Vec<u8>,
}

pub(super) struct RowTransformContext<'a> {
    pub(super) table: &'a str,
    pub(super) branch_schema_map:
        &'a std::collections::HashMap<String, crate::query_manager::types::SchemaHash>,
    pub(super) schema_context: &'a crate::schema_manager::SchemaContext,
    pub(super) schema_warnings: &'a mut SchemaWarningAccumulator,
}

impl QueryManager {
    pub(super) fn branch_schema_map_for_context(
        schema_context: &crate::schema_manager::SchemaContext,
    ) -> std::collections::HashMap<String, crate::query_manager::types::SchemaHash> {
        let mut map = std::collections::HashMap::new();
        map.insert(
            schema_context.branch_name().as_str().to_string(),
            schema_context.current_hash,
        );

        for hash in schema_context.live_schemas.keys() {
            let branch =
                ComposedBranchName::new(&schema_context.env, *hash, &schema_context.user_branch)
                    .to_branch_name();
            map.insert(branch.as_str().to_string(), *hash);
        }

        map
    }

    pub(super) fn authorization_schema_for_context(
        &mut self,
        env: &str,
        user_branch: &str,
    ) -> Option<(Arc<Schema>, Arc<crate::schema_manager::SchemaContext>)> {
        if self.authorization_schema_required && self.authorization_schema.is_none() {
            return None;
        }

        let schema = self
            .authorization_schema
            .clone()
            .or_else(|| (!self.schema.is_empty()).then(|| self.schema.clone()))?;

        let cache_key = (env.to_string(), user_branch.to_string());
        if let Some(context) = self.authorization_context_cache.get(&cache_key) {
            return Some((schema, context.clone()));
        }

        let mut schema_context =
            crate::schema_manager::SchemaContext::new((*schema).clone(), env, user_branch);

        for lens in self.schema_context.lenses.values() {
            schema_context.register_lens(lens.clone());
        }

        for (hash, known_schema) in self.known_schemas.iter() {
            if *hash != schema_context.current_hash {
                schema_context.add_pending_schema_with_hash(*hash, known_schema.clone());
            }
        }

        schema_context.try_activate_pending();

        let schema_context = Arc::new(schema_context);
        self.authorization_context_cache
            .insert(cache_key, schema_context.clone());

        Some((schema, schema_context))
    }

    pub(super) fn authorization_schema_for_branch(
        &mut self,
        branch_name: &BranchName,
    ) -> Option<(Arc<Schema>, Arc<crate::schema_manager::SchemaContext>)> {
        if let Some(composed) = ComposedBranchName::parse(branch_name) {
            if let Some(parts) =
                self.authorization_schema_for_context(&composed.env, &composed.user_branch)
            {
                return Some(parts);
            }

            if self.authorization_schema_required {
                return None;
            }

            let full_hash = self.find_schema_by_short_hash(&composed.schema_hash)?;
            let target_schema = self.known_schemas.get(&full_hash)?.clone();
            let mut schema_context = crate::schema_manager::SchemaContext::new(
                target_schema.clone(),
                &composed.env,
                &composed.user_branch,
            );

            for lens in self.schema_context.lenses.values() {
                schema_context.register_lens(lens.clone());
            }

            for (hash, known_schema) in self.known_schemas.iter() {
                if *hash != full_hash {
                    schema_context.add_pending_schema_with_hash(*hash, known_schema.clone());
                }
            }

            schema_context.try_activate_pending();

            return Some((Arc::new(target_schema), Arc::new(schema_context)));
        }

        if self.schema_context.is_initialized() {
            let env = self.schema_context.env.clone();
            let user_branch = self.schema_context.user_branch.clone();
            return self
                .authorization_schema_for_context(&env, &user_branch)
                .or_else(|| Some((self.schema.clone(), Arc::new(self.schema_context.clone()))));
        }

        None
    }

    fn authorized_tuples_from_graph_result(
        &mut self,
        storage: &dyn Storage,
        settlement_eval_cache: &mut SettlementEvalCache,
        graph: &super::graph::QueryGraph,
        schema_context: &crate::schema_manager::SchemaContext,
        source_branch_schema_map: &std::collections::HashMap<String, SchemaHash>,
        session: Option<&Session>,
    ) -> AuthorizedTuplesResult {
        if self.authorization_schema_required && self.authorization_schema.is_none() {
            return AuthorizedTuplesResult::PermissionsUnavailable;
        }

        let Some((auth_schema, auth_context)) =
            self.authorization_schema_for_context(&schema_context.env, &schema_context.user_branch)
        else {
            if !self.authorization_schema_required {
                return AuthorizedTuplesResult::Ready(graph.current_output_tuples());
            }
            return AuthorizedTuplesResult::PermissionsUnavailable;
        };

        let _ = (
            storage,
            settlement_eval_cache,
            auth_schema,
            auth_context,
            source_branch_schema_map,
            session,
        );
        AuthorizedTuplesResult::Ready(graph.current_output_tuples())
    }

    pub(super) fn authorized_tuples_from_graph_with_cache(
        &mut self,
        storage: &dyn Storage,
        settlement_eval_cache: &mut SettlementEvalCache,
        graph: &super::graph::QueryGraph,
        schema_context: &crate::schema_manager::SchemaContext,
        source_branch_schema_map: &std::collections::HashMap<String, SchemaHash>,
        session: Option<&Session>,
    ) -> Vec<super::types::Tuple> {
        match self.authorized_tuples_from_graph_result(
            storage,
            settlement_eval_cache,
            graph,
            schema_context,
            source_branch_schema_map,
            session,
        ) {
            AuthorizedTuplesResult::Ready(tuples) => tuples,
            AuthorizedTuplesResult::PermissionsUnavailable => Vec::new(),
        }
    }

    pub(super) fn transform_row_with_schema(
        id: ObjectId,
        content: Vec<u8>,
        batch_id: BatchId,
        branch_name: BranchName,
        context: &mut RowTransformContext<'_>,
    ) -> Option<ResolvedSchemaRow> {
        let source_hash = context.branch_schema_map.get(branch_name.as_str()).copied();

        if let Some(source_hash) = source_hash
            && source_hash != context.schema_context.current_hash
        {
            let transformer = LensTransformer::new(context.schema_context, context.table);
            match transformer.transform(&content, batch_id, source_hash) {
                Ok(result) => {
                    return Some(ResolvedSchemaRow {
                        branch_name,
                        batch_id: result.batch_id,
                        content: result.data,
                    });
                }
                Err(err) => {
                    context.schema_warnings.record(
                        context.table,
                        source_hash,
                        context.schema_context.current_hash,
                    );
                    tracing::debug!(
                        row_id = %id,
                        table = context.table,
                        source_branch = %branch_name,
                        source_schema = %source_hash.short(),
                        target_schema = %context.schema_context.current_hash.short(),
                        error = %err,
                        "lens transform failed; row will be counted in aggregated schema warning"
                    );
                    return None;
                }
            }
        }

        Some(ResolvedSchemaRow {
            branch_name,
            batch_id,
            content,
        })
    }
}
