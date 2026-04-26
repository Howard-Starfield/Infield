use serde::{Deserialize, Serialize};
use specta::Type;

// ------------------------------------------------------------------ //
//  FieldType
// ------------------------------------------------------------------ //

/// Discriminant values mirror AppFlowy's field type integers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    RichText,       // 0
    Number,         // 1
    DateTime,       // 2
    SingleSelect,   // 3
    MultiSelect,    // 4
    Checkbox,       // 5
    Url,            // 6
    Checklist,      // 7
    LastEditedTime, // 8
    CreatedTime,    // 9
    Time,           // 13
    Media,          // 14
    Date,           // 15
    /// Stored as plain string in JSON; UI masks value (not encrypted at rest).
    Protected, // 16
}

impl FieldType {
    pub fn to_int(&self) -> i64 {
        match self {
            FieldType::RichText => 0,
            FieldType::Number => 1,
            FieldType::DateTime => 2,
            FieldType::SingleSelect => 3,
            FieldType::MultiSelect => 4,
            FieldType::Checkbox => 5,
            FieldType::Url => 6,
            FieldType::Checklist => 7,
            FieldType::LastEditedTime => 8,
            FieldType::CreatedTime => 9,
            FieldType::Time => 13,
            FieldType::Media => 14,
            FieldType::Date => 15,
            FieldType::Protected => 16,
        }
    }

    pub fn from_int(v: i64) -> Self {
        match v {
            0 => FieldType::RichText,
            1 => FieldType::Number,
            2 => FieldType::DateTime,
            3 => FieldType::SingleSelect,
            4 => FieldType::MultiSelect,
            5 => FieldType::Checkbox,
            6 => FieldType::Url,
            7 => FieldType::Checklist,
            8 => FieldType::LastEditedTime,
            9 => FieldType::CreatedTime,
            13 => FieldType::Time,
            14 => FieldType::Media,
            15 => FieldType::Date,
            16 => FieldType::Protected,
            _ => FieldType::RichText,
        }
    }
}

// ------------------------------------------------------------------ //
//  SelectOption
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SelectColor {
    Purple,
    Pink,
    LightPink,
    Orange,
    Yellow,
    Lime,
    Green,
    Aqua,
    Blue,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    pub color: SelectColor,
}

// ------------------------------------------------------------------ //
//  CellData
// ------------------------------------------------------------------ //

/// Strongly-typed cell content. The `type` tag is used in JSON so the
/// frontend can discriminate without knowing the field type separately.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum CellData {
    RichText(String),
    Number(f64),
    /// Unix timestamp in milliseconds.
    DateTime(i64),
    SingleSelect(String),
    MultiSelect(Vec<String>),
    Checkbox(bool),
    Url(String),
    /// List of checklist item IDs that are checked.
    Checklist(Vec<String>),
    LastEditedTime(i64),
    CreatedTime(i64),
    /// Duration in seconds.
    Time(i64),
    Date(Option<i64>),
    /// List of media file paths / URLs.
    Media(Vec<String>),
    /// Secret string; persisted in workspace JSON like other cells (not encrypted).
    Protected(String),
}

// ------------------------------------------------------------------ //
//  TypeOption
// ------------------------------------------------------------------ //

/// Per-field configuration stored alongside the field definition.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "config", rename_all = "snake_case")]
pub enum TypeOption {
    RichText,
    Number {
        /// e.g. "USD", "EUR", "none"
        format: String,
    },
    DateTime {
        /// e.g. "MM/DD/YYYY"
        date_format: String,
        /// e.g. "12h" | "24h"
        time_format: String,
        include_time: bool,
    },
    SingleSelect {
        options: Vec<SelectOption>,
    },
    MultiSelect {
        options: Vec<SelectOption>,
    },
    Checkbox,
    Url,
    Checklist,
    LastEditedTime,
    CreatedTime,
    Time,
    Date {
        date_format: String,
        time_format: String,
        include_time: bool,
    },
    Media,
    Protected,
}

// ------------------------------------------------------------------ //
//  Field
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Field {
    pub id: String,
    pub database_id: String,
    pub name: String,
    pub field_type: FieldType,
    pub is_primary: bool,
    pub type_option: TypeOption,
    /// Ordering index within the database view.
    pub position: i64,
}

// ------------------------------------------------------------------ //
//  Database views
// ------------------------------------------------------------------ //

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DbViewLayout {
    Board,
    Grid,
    Calendar,
    Chart,
    List,
}

impl DbViewLayout {
    pub fn to_int(&self) -> i64 {
        match self {
            DbViewLayout::Board    => 0,
            DbViewLayout::Grid    => 1,
            DbViewLayout::Calendar => 2,
            DbViewLayout::Chart   => 3,
            DbViewLayout::List    => 4,
        }
    }

    pub fn from_int(n: i64) -> Self {
        match n {
            1 => DbViewLayout::Grid,
            2 => DbViewLayout::Calendar,
            3 => DbViewLayout::Chart,
            4 => DbViewLayout::List,
            _ => DbViewLayout::Board,
        }
    }
}

/// Default `TypeOption` payload for a freshly-created field. Used by the
/// generic `DatabaseManager::create_field` so callers don't have to spell
/// out type-option JSON when adding a column. Pickers / formatters can be
/// edited later via a (future) field-options UI.
pub fn default_type_option_for(ft: &FieldType) -> TypeOption {
    match ft {
        FieldType::RichText => TypeOption::RichText,
        FieldType::Number => TypeOption::Number { format: "none".to_string() },
        FieldType::DateTime => TypeOption::DateTime {
            date_format: "MM/dd/yyyy".to_string(),
            time_format: "12h".to_string(),
            include_time: true,
        },
        FieldType::SingleSelect => TypeOption::SingleSelect { options: Vec::new() },
        FieldType::MultiSelect => TypeOption::MultiSelect { options: Vec::new() },
        FieldType::Checkbox => TypeOption::Checkbox,
        FieldType::Url => TypeOption::Url,
        FieldType::Checklist => TypeOption::Checklist,
        FieldType::LastEditedTime => TypeOption::LastEditedTime,
        FieldType::CreatedTime => TypeOption::CreatedTime,
        FieldType::Time => TypeOption::Time,
        FieldType::Media => TypeOption::Media,
        FieldType::Date => TypeOption::Date {
            date_format: "MM/dd/yyyy".to_string(),
            time_format: "12h".to_string(),
            include_time: false,
        },
        FieldType::Protected => TypeOption::Protected,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DatabaseView {
    pub id: String,
    pub database_id: String,
    pub name: String,
    pub layout: DbViewLayout,
    pub position: i64,
}

// ------------------------------------------------------------------ //
//  Tests
// ------------------------------------------------------------------ //

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_type_roundtrips_through_i32() {
        let types = [
            FieldType::RichText,
            FieldType::Number,
            FieldType::DateTime,
            FieldType::SingleSelect,
            FieldType::MultiSelect,
            FieldType::Checkbox,
            FieldType::Url,
            FieldType::Checklist,
            FieldType::LastEditedTime,
            FieldType::CreatedTime,
            FieldType::Time,
            FieldType::Media,
            FieldType::Date,
            FieldType::Protected,
        ];
        for ft in &types {
            let round = FieldType::from_int(ft.to_int());
            assert_eq!(&round, ft, "roundtrip failed for {:?}", ft);
        }
    }

    #[test]
    fn cell_data_serializes_to_json() {
        let cell = CellData::RichText("hello".to_string());
        let json = serde_json::to_string(&cell).expect("serialize");
        assert!(json.contains("rich_text"), "json = {}", json);
        assert!(json.contains("hello"), "json = {}", json);

        let cell2 = CellData::Checkbox(true);
        let json2 = serde_json::to_string(&cell2).expect("serialize checkbox");
        assert!(json2.contains("checkbox"), "json = {}", json2);
        assert!(json2.contains("true"), "json = {}", json2);
    }

    #[test]
    fn select_option_has_id_name_color() {
        let opt = SelectOption {
            id: "opt-1".to_string(),
            name: "Done".to_string(),
            color: SelectColor::Green,
        };
        let json = serde_json::to_string(&opt).expect("serialize");
        assert!(json.contains("opt-1"));
        assert!(json.contains("Done"));
        assert!(json.contains("green"));
    }
}
