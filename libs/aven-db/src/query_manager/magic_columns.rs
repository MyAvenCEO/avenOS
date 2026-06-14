use crate::query_manager::types::{ColumnDescriptor, ColumnType};

pub const RESERVED_MAGIC_COLUMN_PREFIX: char = '$';

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MagicColumnKind {
    CanRead,
    CanEdit,
    CanDelete,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
    /// The owning SAFE, projected from the row's signed owner-binding header (board 0037).
    /// There is no `owner` data column — ownership lives only in the immutable binding, and
    /// `$owner` exposes it for filtering/projection without a second source.
    Owner,
}

impl MagicColumnKind {
    pub fn column_name(self) -> &'static str {
        match self {
            MagicColumnKind::CanRead => "$canRead",
            MagicColumnKind::CanEdit => "$canEdit",
            MagicColumnKind::CanDelete => "$canDelete",
            MagicColumnKind::CreatedBy => "$createdBy",
            MagicColumnKind::CreatedAt => "$createdAt",
            MagicColumnKind::UpdatedBy => "$updatedBy",
            MagicColumnKind::UpdatedAt => "$updatedAt",
            MagicColumnKind::Owner => "$owner",
        }
    }
}

pub fn magic_column_kind(name: &str) -> Option<MagicColumnKind> {
    match name {
        "$canRead" => Some(MagicColumnKind::CanRead),
        "$canEdit" => Some(MagicColumnKind::CanEdit),
        "$canDelete" => Some(MagicColumnKind::CanDelete),
        "$createdBy" => Some(MagicColumnKind::CreatedBy),
        "$createdAt" => Some(MagicColumnKind::CreatedAt),
        "$updatedBy" => Some(MagicColumnKind::UpdatedBy),
        "$updatedAt" => Some(MagicColumnKind::UpdatedAt),
        "$owner" => Some(MagicColumnKind::Owner),
        _ => None,
    }
}

pub(crate) fn magic_column_descriptor(kind: MagicColumnKind) -> ColumnDescriptor {
    let descriptor = ColumnDescriptor::new(
        kind.column_name(),
        match kind {
            MagicColumnKind::CanRead | MagicColumnKind::CanEdit | MagicColumnKind::CanDelete => {
                ColumnType::Boolean
            }
            MagicColumnKind::CreatedBy | MagicColumnKind::UpdatedBy => ColumnType::Text,
            MagicColumnKind::CreatedAt | MagicColumnKind::UpdatedAt => ColumnType::Timestamp,
            MagicColumnKind::Owner => ColumnType::Uuid,
        },
    );

    if matches!(
        kind,
        MagicColumnKind::CanRead
            | MagicColumnKind::CanEdit
            | MagicColumnKind::CanDelete
            | MagicColumnKind::Owner
    ) {
        descriptor.nullable()
    } else {
        descriptor
    }
}

pub fn is_magic_column_name(name: &str) -> bool {
    magic_column_kind(name).is_some()
}

pub fn is_reserved_magic_column_name(name: &str) -> bool {
    name.starts_with(RESERVED_MAGIC_COLUMN_PREFIX)
}
