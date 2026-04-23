use serde::{Deserialize, Serialize};
use specta::Type;
use std::cmp::Ordering;

use super::field::{CellData, FieldType};

// ------------------------------------------------------------------ //
//  SortCondition
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SortCondition {
    Ascending,
    Descending,
}

// ------------------------------------------------------------------ //
//  Sort
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Sort {
    pub id: String,
    pub field_id: String,
    pub field_type: FieldType,
    pub condition: SortCondition,
}

// ------------------------------------------------------------------ //
//  compare_cells
// ------------------------------------------------------------------ //

/// Compares two optional cell values for sorting purposes.
///
/// * Empty / `None` values always sort **last** regardless of direction.
/// * The caller is responsible for reversing the result for `Descending` order.
pub fn compare_cells(a: Option<&CellData>, b: Option<&CellData>) -> Ordering {
    match (a, b) {
        // Both empty → equal
        (None, None) => Ordering::Equal,
        // Empty always last
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,

        (Some(a_val), Some(b_val)) => compare_cell_values(a_val, b_val),
    }
}

fn compare_cell_values(a: &CellData, b: &CellData) -> Ordering {
    match (a, b) {
        (CellData::RichText(av), CellData::RichText(bv))
        | (CellData::Url(av), CellData::Url(bv))
        | (CellData::SingleSelect(av), CellData::SingleSelect(bv))
        | (CellData::Protected(av), CellData::Protected(bv)) => {
            av.to_lowercase().cmp(&bv.to_lowercase())
        }

        (CellData::Number(av), CellData::Number(bv)) => {
            av.partial_cmp(bv).unwrap_or(Ordering::Equal)
        }

        (CellData::Checkbox(av), CellData::Checkbox(bv)) => {
            // true > false (checked items come first in ascending)
            bv.cmp(av).reverse()
            // i.e. true sorts before false → false.cmp(true).reverse() = Less.reverse() = Greater
            // Actually: we want true < false so checked is "smaller" (first ascending).
            // bool: false=0, true=1 → natural ascending: false < true
        }

        (CellData::DateTime(av), CellData::DateTime(bv))
        | (CellData::LastEditedTime(av), CellData::LastEditedTime(bv))
        | (CellData::CreatedTime(av), CellData::CreatedTime(bv))
        | (CellData::Time(av), CellData::Time(bv)) => av.cmp(bv),

        // Mixed or unsupported combinations → treat as equal
        _ => Ordering::Equal,
    }
}

/// Sorts `rows` (mutable slice of `(row_id, cells)`) by the given sort list.
/// Cells are provided as `Option<&CellData>` via the closure `get_cell`.
///
/// # Parameters
/// * `rows`     – mutable slice of row identifiers.
/// * `sorts`    – ordered list of sorts (first sort has highest priority).
/// * `get_cell` – closure mapping `(row_id, field_id) → Option<CellData>`.
pub fn sort_rows<F>(rows: &mut Vec<String>, sorts: &[Sort], get_cell: F)
where
    F: Fn(&str, &str) -> Option<CellData>,
{
    rows.sort_by(|a_id, b_id| {
        for sort in sorts {
            let a_cell = get_cell(a_id, &sort.field_id);
            let b_cell = get_cell(b_id, &sort.field_id);
            let mut ord = compare_cells(a_cell.as_ref(), b_cell.as_ref());
            if sort.condition == SortCondition::Descending {
                // Empty-last rule: only reverse non-equal comparisons where
                // neither side is empty.
                ord = match (a_cell.is_some(), b_cell.is_some()) {
                    (true, true) => ord.reverse(),
                    _ => ord, // keep empty-last behaviour
                };
            }
            if ord != Ordering::Equal {
                return ord;
            }
        }
        Ordering::Equal
    });
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use uuid::Uuid;

    fn text_sort(condition: SortCondition) -> Sort {
        Sort {
            id: Uuid::new_v4().to_string(),
            field_id: "f1".to_string(),
            field_type: FieldType::RichText,
            condition,
        }
    }

    fn cell_map(pairs: &[(&str, CellData)]) -> HashMap<String, CellData> {
        pairs
            .iter()
            .map(|(id, c)| (id.to_string(), c.clone()))
            .collect()
    }

    #[test]
    fn ascending_text_sort() {
        let mut rows: Vec<String> = vec!["r3".into(), "r1".into(), "r2".into()];
        let cells: HashMap<String, CellData> = cell_map(&[
            ("r1", CellData::RichText("banana".into())),
            ("r2", CellData::RichText("apple".into())),
            ("r3", CellData::RichText("cherry".into())),
        ]);

        let sorts = vec![text_sort(SortCondition::Ascending)];
        sort_rows(&mut rows, &sorts, |row_id, _field_id| {
            cells.get(row_id).cloned()
        });

        assert_eq!(rows, vec!["r2", "r1", "r3"]); // apple, banana, cherry
    }

    #[test]
    fn descending_reverses_order() {
        let mut rows: Vec<String> = vec!["r1".into(), "r2".into(), "r3".into()];
        let cells: HashMap<String, CellData> = cell_map(&[
            ("r1", CellData::RichText("apple".into())),
            ("r2", CellData::RichText("banana".into())),
            ("r3", CellData::RichText("cherry".into())),
        ]);

        let sorts = vec![text_sort(SortCondition::Descending)];
        sort_rows(&mut rows, &sorts, |row_id, _field_id| {
            cells.get(row_id).cloned()
        });

        assert_eq!(rows, vec!["r3", "r2", "r1"]); // cherry, banana, apple
    }

    #[test]
    fn empty_sorts_last_in_ascending() {
        let mut rows: Vec<String> = vec!["r_empty".into(), "r_b".into(), "r_a".into()];
        let cells: HashMap<String, CellData> = cell_map(&[
            ("r_a", CellData::RichText("apple".into())),
            ("r_b", CellData::RichText("banana".into())),
            // r_empty has no cell
        ]);

        let sorts = vec![text_sort(SortCondition::Ascending)];
        sort_rows(&mut rows, &sorts, |row_id, _field_id| {
            cells.get(row_id).cloned()
        });

        // apple, banana, then empty last
        assert_eq!(rows[0], "r_a");
        assert_eq!(rows[1], "r_b");
        assert_eq!(rows[2], "r_empty");
    }

    #[test]
    fn empty_sorts_last_in_descending() {
        let mut rows: Vec<String> = vec!["r_empty".into(), "r_b".into(), "r_a".into()];
        let cells: HashMap<String, CellData> = cell_map(&[
            ("r_a", CellData::RichText("apple".into())),
            ("r_b", CellData::RichText("banana".into())),
        ]);

        let sorts = vec![text_sort(SortCondition::Descending)];
        sort_rows(&mut rows, &sorts, |row_id, _field_id| {
            cells.get(row_id).cloned()
        });

        // descending: banana, apple, then empty last
        assert_eq!(rows[0], "r_b");
        assert_eq!(rows[1], "r_a");
        assert_eq!(rows[2], "r_empty");
    }

    #[test]
    fn compare_cells_empty_last() {
        let text = CellData::RichText("hello".into());
        assert_eq!(compare_cells(None, Some(&text)), Ordering::Greater);
        assert_eq!(compare_cells(Some(&text), None), Ordering::Less);
        assert_eq!(compare_cells(None, None), Ordering::Equal);
    }
}
