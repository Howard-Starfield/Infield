use serde::{Deserialize, Serialize};
use specta::Type;

use super::field::{CellData, FieldType};

// ------------------------------------------------------------------ //
//  FilterCondition
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FilterCondition {
    // Text / URL / rich-text
    Contains,
    DoesNotContain,
    // Generic equality
    Is,
    IsNot,
    // Emptiness
    IsEmpty,
    IsNotEmpty,
    // Checkbox
    IsChecked,
    IsUnchecked,
    // Numeric / date comparisons
    Equal,
    NotEqual,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
}

// ------------------------------------------------------------------ //
//  FilterInner (recursive tree)
// ------------------------------------------------------------------ //

/// A node in the filter tree. Can be a leaf (Data) or a logical
/// combinator (And / Or).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FilterInner {
    Data {
        field_id: String,
        field_type: FieldType,
        condition: FilterCondition,
        /// String representation of the filter value (empty for unary conditions).
        value: String,
    },
    And {
        children: Vec<FilterInner>,
    },
    Or {
        children: Vec<FilterInner>,
    },
}

// ------------------------------------------------------------------ //
//  Filter (top-level wrapper)
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Filter {
    pub id: String,
    pub inner: FilterInner,
}

impl Filter {
    /// Returns `true` when `cell` matches this filter.
    pub fn matches_cell(&self, field_id: &str, cell: Option<&CellData>) -> bool {
        self.inner.matches(field_id, cell)
    }
}

// ------------------------------------------------------------------ //
//  Matching logic
// ------------------------------------------------------------------ //

impl FilterInner {
    pub fn matches(&self, field_id: &str, cell: Option<&CellData>) -> bool {
        match self {
            FilterInner::And { children } => children.iter().all(|c| c.matches(field_id, cell)),
            FilterInner::Or { children } => children.iter().any(|c| c.matches(field_id, cell)),
            FilterInner::Data {
                field_id: fid,
                condition,
                value,
                ..
            } => {
                // Only apply if the field matches
                if fid != field_id {
                    // A data leaf for a different field is considered "passing"
                    // when checked against the current cell.
                    return true;
                }
                match_condition(condition, cell, value)
            }
        }
    }
}

fn match_condition(cond: &FilterCondition, cell: Option<&CellData>, value: &str) -> bool {
    match cond {
        FilterCondition::IsEmpty => cell_is_empty(cell),
        FilterCondition::IsNotEmpty => !cell_is_empty(cell),
        FilterCondition::IsChecked => matches!(cell, Some(CellData::Checkbox(true))),
        FilterCondition::IsUnchecked => matches!(cell, None | Some(CellData::Checkbox(false))),

        FilterCondition::Contains => cell_text(cell)
            .map(|t| t.to_lowercase().contains(&value.to_lowercase()))
            .unwrap_or(false),

        FilterCondition::DoesNotContain => cell_text(cell)
            .map(|t| !t.to_lowercase().contains(&value.to_lowercase()))
            .unwrap_or(true),

        FilterCondition::Is => cell_text(cell)
            .map(|t| t.eq_ignore_ascii_case(value))
            .unwrap_or(false),

        FilterCondition::IsNot => cell_text(cell)
            .map(|t| !t.eq_ignore_ascii_case(value))
            .unwrap_or(true),

        FilterCondition::Equal => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| (n - v).abs() < f64::EPSILON)
            .unwrap_or(false),

        FilterCondition::NotEqual => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| (n - v).abs() >= f64::EPSILON)
            .unwrap_or(true),

        FilterCondition::GreaterThan => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| n > v)
            .unwrap_or(false),

        FilterCondition::LessThan => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| n < v)
            .unwrap_or(false),

        FilterCondition::GreaterThanOrEqual => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| n >= v)
            .unwrap_or(false),

        FilterCondition::LessThanOrEqual => cell_number(cell)
            .zip(value.parse::<f64>().ok())
            .map(|(n, v)| n <= v)
            .unwrap_or(false),
    }
}

// ------------------------------------------------------------------ //
//  Cell helpers
// ------------------------------------------------------------------ //

fn cell_is_empty(cell: Option<&CellData>) -> bool {
    match cell {
        None => true,
        Some(CellData::RichText(s)) | Some(CellData::Url(s)) | Some(CellData::Protected(s)) => {
            s.is_empty()
        }
        Some(CellData::MultiSelect(v))
        | Some(CellData::Checklist(v))
        | Some(CellData::Media(v)) => v.is_empty(),
        Some(CellData::SingleSelect(s)) => s.is_empty(),
        _ => false,
    }
}

fn cell_text(cell: Option<&CellData>) -> Option<&str> {
    match cell {
        Some(CellData::RichText(s))
        | Some(CellData::Url(s))
        | Some(CellData::SingleSelect(s))
        | Some(CellData::Protected(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn cell_number(cell: Option<&CellData>) -> Option<f64> {
    match cell {
        Some(CellData::Number(n)) => Some(*n),
        Some(CellData::DateTime(ts))
        | Some(CellData::LastEditedTime(ts))
        | Some(CellData::CreatedTime(ts))
        | Some(CellData::Time(ts)) => Some(*ts as f64),
        _ => None,
    }
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_filter(field_type: FieldType, condition: FilterCondition, value: &str) -> Filter {
        Filter {
            id: Uuid::new_v4().to_string(),
            inner: FilterInner::Data {
                field_id: "f1".to_string(),
                field_type,
                condition,
                value: value.to_string(),
            },
        }
    }

    #[test]
    fn text_filter_contains_matches() {
        let filter = make_filter(FieldType::RichText, FilterCondition::Contains, "hello");

        let cell_yes = CellData::RichText("say hello world".to_string());
        let cell_no = CellData::RichText("goodbye".to_string());

        assert!(filter.matches_cell("f1", Some(&cell_yes)));
        assert!(!filter.matches_cell("f1", Some(&cell_no)));
        assert!(!filter.matches_cell("f1", None));
    }

    #[test]
    fn checkbox_filter_is_checked_matches_true() {
        let filter = make_filter(FieldType::Checkbox, FilterCondition::IsChecked, "");

        let checked = CellData::Checkbox(true);
        let unchecked = CellData::Checkbox(false);

        assert!(filter.matches_cell("f1", Some(&checked)));
        assert!(!filter.matches_cell("f1", Some(&unchecked)));
        assert!(!filter.matches_cell("f1", None));
    }

    #[test]
    fn is_empty_filter_works() {
        let filter = make_filter(FieldType::RichText, FilterCondition::IsEmpty, "");

        let empty = CellData::RichText(String::new());
        let non_empty = CellData::RichText("something".to_string());

        assert!(filter.matches_cell("f1", Some(&empty)));
        assert!(filter.matches_cell("f1", None));
        assert!(!filter.matches_cell("f1", Some(&non_empty)));
    }

    #[test]
    fn and_filter_requires_all_children() {
        // Both: Contains "hello" AND Contains "world"
        let inner = FilterInner::And {
            children: vec![
                FilterInner::Data {
                    field_id: "f1".to_string(),
                    field_type: FieldType::RichText,
                    condition: FilterCondition::Contains,
                    value: "hello".to_string(),
                },
                FilterInner::Data {
                    field_id: "f1".to_string(),
                    field_type: FieldType::RichText,
                    condition: FilterCondition::Contains,
                    value: "world".to_string(),
                },
            ],
        };

        let both = CellData::RichText("hello world".to_string());
        let only_hello = CellData::RichText("hello there".to_string());

        assert!(inner.matches("f1", Some(&both)));
        assert!(!inner.matches("f1", Some(&only_hello)));
    }
}
