use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::Cell;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

const MAX_BLOCK_INDENT: i32 = 6;
const MARK_ORDER: [TextMarkType; 10] = [
    TextMarkType::Bold,
    TextMarkType::Italic,
    TextMarkType::Code,
    TextMarkType::Underline,
    TextMarkType::Strikethrough,
    TextMarkType::Highlight,
    TextMarkType::Link,
    TextMarkType::IconLink,
    TextMarkType::TextColor,
    TextMarkType::BackgroundColor,
];

thread_local! {
    static NEXT_ID: Cell<u64> = const { Cell::new(1) };
}

#[wasm_bindgen]
pub fn editor_core_call(method: &str, payload: &str) -> Result<String, JsValue> {
    let payload: Value = serde_json::from_str(payload)
        .map_err(|error| JsValue::from_str(&format!("Invalid editor-core payload: {error}")))?;
    let output = dispatch(method, payload)
        .map_err(|error| JsValue::from_str(&format!("editor-core {method} failed: {error}")))?;
    serde_json::to_string(&output).map_err(|error| {
        JsValue::from_str(&format!("Failed to serialize editor-core output: {error}"))
    })
}

fn dispatch(method: &str, payload: Value) -> Result<Value, String> {
    match method {
        "applyMarkdownShortcut" => {
            unary::<Block, _>(payload, |block| Ok(apply_markdown_shortcut(block)))
        }
        "applyTransaction" => value2(payload, |history: History, tx: Transaction| {
            Ok(apply_transaction(history, tx))
        }),
        "clampSelection" => value2(payload, |document: Document, selection: Selection| {
            Ok(clamp_selection(&document, selection))
        }),
        "createBlock" => unary::<Option<CreateBlockInput>, _>(payload, |input| {
            Ok(create_block(input.unwrap_or_default()))
        }),
        "createCollapsedSelection" => {
            let block_id = get_string(&payload, "blockId").unwrap_or_default();
            let offset = get_i32(&payload, "offset").unwrap_or(0);
            Ok(json!(create_collapsed_selection(block_id, offset)))
        }
        "createDocument" => unary::<Option<CreateDocumentInput>, _>(payload, |input| {
            Ok(create_document(input.unwrap_or_default()))
        }),
        "createEditorHistory" => {
            unary::<Document, _>(payload, |document| Ok(create_history(document)))
        }
        "deleteBlock" => value2(payload, |document: Document, block_id: String| {
            Ok(delete_block(document, &block_id))
        }),
        "documentToMarkdown" => {
            unary::<Document, _>(payload, |document| Ok(document_to_markdown(&document)))
        }
        "executeBlockCommand" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                command: BlockCommandInput,
                source: BlockCommandSource,
                slash_query: Option<String>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(execute_block_command(
                    input.document,
                    &input.block_id,
                    input.command,
                    input.source,
                    input.slash_query.as_deref(),
                ))
            })
        }
        "findEditorCommand" => unary::<String, _>(payload, |query| Ok(find_editor_command(&query))),
        "getBlockPlainText" => unary::<Block, _>(payload, |block| Ok(block_plain_text(&block))),
        "getSelectionFocus" => unary::<Selection, _>(payload, |selection| Ok(selection.focus)),
        "editableMarkRangeAtSelection" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                selection: Selection,
            }
            unary::<Input, _>(payload, |input| {
                Ok(editable_mark_range_at_selection(
                    &input.block,
                    &input.selection,
                ))
            })
        }
        "insertBlockAfter" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                after_block_id: Option<String>,
                block: Option<Block>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(insert_block_after(
                    input.document,
                    input.after_block_id.as_deref(),
                    input
                        .block
                        .unwrap_or_else(|| create_block(CreateBlockInput::default())),
                ))
            })
        }
        "insertDocumentFragment" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                start_offset: i32,
                end_offset: i32,
                fragment: Document,
            }
            unary::<Input, _>(payload, |input| {
                Ok(insert_document_fragment(
                    input.document,
                    &input.block_id,
                    input.start_offset,
                    input.end_offset,
                    input.fragment,
                ))
            })
        }
        "isSelectionCollapsed" => {
            unary::<Selection, _>(payload, |selection| Ok(selection.anchor == selection.focus))
        }
        "isSameBlockSelection" => {
            unary::<Selection, _>(payload, |selection| Ok(is_same_block_selection(&selection)))
        }
        "listBlockSpecs" => Ok(json!(block_specs())),
        "listTextMarkSpecs" => Ok(json!(text_mark_specs())),
        "markdownToDocument" => {
            #[derive(Deserialize)]
            struct Input {
                markdown: String,
                title: Option<String>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(markdown_to_document(
                    &input.markdown,
                    input.title.as_deref().unwrap_or("Imported document"),
                ))
            })
        }
        "mergeWithPrevious" => value2(payload, |document: Document, block_id: String| {
            Ok(merge_with_previous(document, &block_id))
        }),
        "markRangeAtOffset" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                offset: i32,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(mark_range_at_offset(&input.block, input.offset, input.mark))
            })
        }
        "markRangesInBlock" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(mark_ranges_in_block(&input.block, input.mark))
            })
        }
        "marksAtOffset" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                offset: i32,
            }
            unary::<Input, _>(payload, |input| {
                Ok(span_marks_at_offset(&input.block, input.offset).unwrap_or_default())
            })
        }
        "moveBlock" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                to_index: i32,
            }
            unary::<Input, _>(payload, |input| {
                Ok(move_block(input.document, &input.block_id, input.to_index))
            })
        }
        "redo" => unary::<History, _>(payload, |history| Ok(redo(history))),
        "selectionAtBlockEnd" => value2(payload, |document: Document, block_id: String| {
            Ok(selection_at_block_end(&document, &block_id))
        }),
        "selectedMarkAttrs" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                selection: Selection,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(selected_mark_attrs(
                    &input.block,
                    &input.selection,
                    input.mark,
                ))
            })
        }
        "selectedRange" => {
            unary::<Selection, _>(payload, |selection| Ok(selected_range(&selection)))
        }
        "selectionHasMark" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                selection: Selection,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(selection_has_mark(
                    &input.block,
                    &input.selection,
                    input.mark,
                ))
            })
        }
        "selectionMarkState" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                selection: Selection,
                mark: TextMarkType,
                stored_marks: Option<Vec<TextMark>>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(selection_mark_state(
                    &input.block,
                    &input.selection,
                    input.mark,
                    input.stored_marks,
                ))
            })
        }
        "selectionFormattingSnapshot" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                block: Block,
                selection: Selection,
                marks: Vec<TextMarkType>,
                stored_marks: Option<Vec<TextMark>>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(selection_formatting_snapshot(
                    &input.block,
                    &input.selection,
                    input.marks,
                    input.stored_marks,
                ))
            })
        }
        "searchEditorCommandNames" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                commands: Vec<CommandSearchInput>,
                query: String,
            }
            unary::<Input, _>(payload, |input| {
                Ok(search_editor_command_names(input.commands, &input.query))
            })
        }
        "setBlockIndent" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                indent: i32,
                offset: Option<i32>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(set_block_indent(
                    input.document,
                    &input.block_id,
                    input.indent,
                    input.offset,
                ))
            })
        }
        "setBlockAttrs" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                attrs: BTreeMap<String, Value>,
                offset: Option<i32>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(set_block_attrs(
                    input.document,
                    &input.block_id,
                    input.attrs,
                    input.offset,
                ))
            })
        }
        "setBlockType" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                block_type: BlockType,
                level: Option<i32>,
                text: Option<String>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(set_block_type(
                    input.document,
                    &input.block_id,
                    input.block_type,
                    input.level,
                    input.text,
                ))
            })
        }
        "splitBlock" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                offset: i32,
            }
            unary::<Input, _>(payload, |input| {
                Ok(split_block(input.document, &input.block_id, input.offset))
            })
        }
        "toggleTextMark" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                start_offset: i32,
                end_offset: i32,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(toggle_text_mark(
                    input.document,
                    &input.block_id,
                    input.start_offset,
                    input.end_offset,
                    input.mark,
                ))
            })
        }
        "setTextMark" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                start_offset: i32,
                end_offset: i32,
                mark: TextMarkType,
                attrs: Option<BTreeMap<String, String>>,
            }
            unary::<Input, _>(payload, |input| {
                Ok(set_text_mark(
                    input.document,
                    &input.block_id,
                    input.start_offset,
                    input.end_offset,
                    TextMark {
                        mark_type: input.mark,
                        attrs: clean_mark_attrs(input.attrs.unwrap_or_default()),
                    },
                ))
            })
        }
        "unsetTextMark" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                start_offset: i32,
                end_offset: i32,
                mark: TextMarkType,
            }
            unary::<Input, _>(payload, |input| {
                Ok(unset_text_mark(
                    input.document,
                    &input.block_id,
                    input.start_offset,
                    input.end_offset,
                    input.mark,
                ))
            })
        }
        "toggleTodo" => value2(payload, |document: Document, block_id: String| {
            Ok(toggle_todo(document, &block_id))
        }),
        "undo" => unary::<History, _>(payload, |history| Ok(undo(history))),
        "updateBlockText" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                text: String,
                offset: Option<i32>,
            }
            unary::<Input, _>(payload, |input| {
                let offset = input
                    .offset
                    .unwrap_or_else(|| utf16_len(&input.text) as i32);
                Ok(update_block_text(
                    input.document,
                    &input.block_id,
                    input.text,
                    offset,
                ))
            })
        }
        "updateBlockTextWithMarkdownShortcut" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Input {
                document: Document,
                block_id: String,
                text: String,
                offset: Option<i32>,
            }
            unary::<Input, _>(payload, |input| {
                let offset = input
                    .offset
                    .unwrap_or_else(|| utf16_len(&input.text) as i32);
                Ok(update_block_text_with_markdown_shortcut(
                    input.document,
                    &input.block_id,
                    input.text,
                    offset,
                ))
            })
        }
        _ => Err(format!("unknown method")),
    }
}

fn unary<T, R>(payload: Value, f: impl FnOnce(T) -> Result<R, String>) -> Result<Value, String>
where
    T: for<'de> Deserialize<'de>,
    R: Serialize,
{
    let input = serde_json::from_value(payload).map_err(|error| error.to_string())?;
    serde_json::to_value(f(input)?).map_err(|error| error.to_string())
}

fn value2<A, B, R>(
    payload: Value,
    f: impl FnOnce(A, B) -> Result<R, String>,
) -> Result<Value, String>
where
    A: for<'de> Deserialize<'de>,
    B: for<'de> Deserialize<'de>,
    R: Serialize,
{
    let first = serde_json::from_value(payload.get("0").cloned().ok_or("missing argument 0")?)
        .map_err(|error| error.to_string())?;
    let second = serde_json::from_value(payload.get("1").cloned().ok_or("missing argument 1")?)
        .map_err(|error| error.to_string())?;
    serde_json::to_value(f(first, second)?).map_err(|error| error.to_string())
}

fn get_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(ToOwned::to_owned)
}

fn get_i32(value: &Value, key: &str) -> Option<i32> {
    value.get(key)?.as_i64().map(|value| value as i32)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum BlockType {
    Paragraph,
    Heading,
    Quote,
    Divider,
    Todo,
    BulletedList,
    NumberedList,
    CodeBlock,
    Callout,
    Image,
    Toggle,
    Table,
    Bookmark,
    Embed,
    File,
    PageLink,
    Raw,
}

impl Default for BlockType {
    fn default() -> Self {
        Self::Paragraph
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TextMarkType {
    Bold,
    Italic,
    Code,
    Underline,
    Strikethrough,
    Highlight,
    Link,
    IconLink,
    TextColor,
    BackgroundColor,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextMark {
    #[serde(rename = "type")]
    mark_type: TextMarkType,
    #[serde(skip_serializing_if = "BTreeMap::is_empty", default)]
    attrs: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct TextSpan {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    marks: Option<Vec<TextMark>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Block {
    id: String,
    #[serde(rename = "type")]
    block_type: BlockType,
    text: Vec<TextSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    indent: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attrs: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<Block>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Document {
    version: i32,
    title: String,
    blocks: Vec<Block>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cursor {
    block_id: String,
    offset: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Selection {
    anchor: Cursor,
    focus: Cursor,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextRange {
    block_id: String,
    start: i32,
    end: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkRange {
    block_id: String,
    start: i32,
    end: i32,
    attrs: Option<BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionMarkState {
    active: bool,
    attrs: Option<BTreeMap<String, String>>,
    mixed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SelectionFormattingSnapshotItem {
    mark: TextMarkType,
    state: SelectionMarkState,
}

#[derive(Clone, Debug, Default)]
struct SelectionMarkAccumulator {
    touched: bool,
    marked: i32,
    unmarked: i32,
    first_attrs: Option<BTreeMap<String, String>>,
    saw_first_attrs: bool,
    attrs_mixed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TransactionKind {
    InsertBlock,
    InsertFragment,
    UpdateText,
    SplitBlock,
    MergeBlock,
    DeleteBlock,
    MoveBlock,
    SetBlockIndent,
    ToggleTextMark,
    SetTextMark,
    UnsetTextMark,
    ToggleTodo,
    SetBlockType,
    SetBlockAttrs,
    MarkdownShortcut,
    Normalize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Transaction {
    id: String,
    kind: TransactionKind,
    before: Document,
    after: Document,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<Selection>,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct History {
    document: Document,
    undo_stack: Vec<Transaction>,
    redo_stack: Vec<Transaction>,
}

#[derive(Default, Deserialize)]
struct CreateDocumentInput {
    title: Option<String>,
    blocks: Option<Vec<Block>>,
}

#[derive(Default, Deserialize)]
struct CreateBlockInput {
    id: Option<String>,
    #[serde(default, rename = "type")]
    block_type: Option<BlockType>,
    text: Option<TextInput>,
    level: Option<i32>,
    indent: Option<i32>,
    checked: Option<bool>,
    attrs: Option<BTreeMap<String, Value>>,
    children: Option<Vec<Block>>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum TextInput {
    String(String),
    Spans(Vec<TextSpan>),
}

#[derive(Clone, Debug, Serialize)]
struct Command {
    name: &'static str,
    label: &'static str,
    description: &'static str,
    #[serde(rename = "blockType")]
    block_type: BlockType,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<i32>,
    icon: &'static str,
    placeholder: &'static str,
    #[serde(rename = "markdownShortcut", skip_serializing_if = "Option::is_none")]
    markdown_shortcut: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum BlockCommandSource {
    Slash,
    TurnInto,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockCommandInput {
    #[serde(rename = "blockType")]
    block_type: BlockType,
    level: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandSearchInput {
    name: String,
    label: String,
    description: String,
    #[serde(rename = "blockType")]
    block_type: BlockType,
    level: Option<i32>,
    icon: Option<String>,
    #[serde(rename = "markdownShortcut")]
    markdown_shortcut: Option<String>,
    group: Option<String>,
    #[serde(rename = "slashMenu")]
    slash_menu: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
struct TextMarkSpec {
    mark: TextMarkType,
    label: &'static str,
    description: &'static str,
    kind: &'static str,
    shortcut: &'static str,
    tag: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    values: Option<Vec<&'static str>>,
}

fn next_id(prefix: &str) -> String {
    NEXT_ID.with(|cell| {
        let value = cell.get();
        cell.set(value + 1);
        format!("{prefix}_{value}")
    })
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn byte_index_for_utf16(text: &str, offset: i32) -> usize {
    let safe_offset = offset.max(0) as usize;
    let mut cursor = 0usize;
    for (byte_index, character) in text.char_indices() {
        if cursor >= safe_offset {
            return byte_index;
        }
        cursor += character.len_utf16();
        if cursor > safe_offset {
            return byte_index + character.len_utf8();
        }
    }
    text.len()
}

fn slice_utf16(text: &str, start: i32, end: i32) -> String {
    let start = byte_index_for_utf16(text, start);
    let end = byte_index_for_utf16(text, end);
    text[start.min(text.len())..end.min(text.len())].to_string()
}

fn clean_mark_attrs(attrs: BTreeMap<String, String>) -> BTreeMap<String, String> {
    attrs
        .into_iter()
        .filter_map(|(key, value)| {
            let trimmed = value.trim().to_string();
            (!key.trim().is_empty() && !trimmed.is_empty()).then_some((key, trimmed))
        })
        .collect()
}

fn text_mark(mark_type: TextMarkType) -> TextMark {
    TextMark {
        mark_type,
        attrs: BTreeMap::new(),
    }
}

fn normalize_marks(marks: Option<Vec<TextMark>>) -> Option<Vec<TextMark>> {
    let marks = marks?;
    let ordered: Vec<TextMark> = MARK_ORDER
        .iter()
        .filter_map(|mark_type| {
            marks
                .iter()
                .rev()
                .find(|mark| mark.mark_type == *mark_type)
                .map(|mark| TextMark {
                    mark_type: mark.mark_type,
                    attrs: clean_mark_attrs(mark.attrs.clone()),
                })
        })
        .collect();
    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

fn text_span(text: impl Into<String>, marks: Option<Vec<TextMark>>) -> TextSpan {
    TextSpan {
        text: text.into(),
        marks: normalize_marks(marks),
    }
}

fn has_mark_type(marks: Option<&Vec<TextMark>>, mark_type: TextMarkType) -> bool {
    marks.is_some_and(|marks| marks.iter().any(|mark| mark.mark_type == mark_type))
}

fn mark_attrs<'a>(
    marks: Option<&'a Vec<TextMark>>,
    mark_type: TextMarkType,
) -> Option<&'a BTreeMap<String, String>> {
    marks?
        .iter()
        .find(|mark| mark.mark_type == mark_type)
        .map(|mark| &mark.attrs)
}

fn remove_mark_type(marks: &mut Vec<TextMark>, mark_type: TextMarkType) {
    marks.retain(|candidate| candidate.mark_type != mark_type);
}

fn merge_text_spans(spans: Vec<TextSpan>) -> Vec<TextSpan> {
    let mut merged: Vec<TextSpan> = Vec::new();
    for span in spans.into_iter().filter(|span| !span.text.is_empty()) {
        let next = text_span(span.text, span.marks);
        if let Some(previous) = merged.last_mut() {
            if previous.marks == next.marks {
                previous.text.push_str(&next.text);
                continue;
            }
        }
        merged.push(next);
    }
    if merged.is_empty() {
        vec![text_span("", None)]
    } else {
        merged
    }
}

fn block_plain_text(block: &Block) -> String {
    block.text.iter().map(|span| span.text.as_str()).collect()
}

fn common_prefix_len_utf16(left: &str, right: &str) -> i32 {
    let mut length = 0;
    for (left_char, right_char) in left.chars().zip(right.chars()) {
        if left_char != right_char {
            break;
        }
        length += left_char.len_utf16() as i32;
    }
    length
}

fn common_suffix_len_utf16(left: &str, right: &str, prefix_len: i32) -> i32 {
    let left_len = utf16_len(left) as i32;
    let right_len = utf16_len(right) as i32;
    let mut length = 0;
    for (left_char, right_char) in left.chars().rev().zip(right.chars().rev()) {
        if left_char != right_char {
            break;
        }
        let char_len = left_char.len_utf16() as i32;
        if prefix_len + length + char_len > left_len || prefix_len + length + char_len > right_len {
            break;
        }
        length += char_len;
    }
    length
}

fn span_marks_at_offset(block: &Block, offset: i32) -> Option<Vec<TextMark>> {
    let safe_offset = offset.clamp(0, utf16_len(&block_plain_text(block)) as i32);
    let mut cursor = 0;
    let mut previous_marks = None;
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if safe_offset == 0 && span_start == 0 {
            return span.marks.clone();
        }
        if safe_offset > span_start && safe_offset <= span_end {
            return span.marks.clone();
        }
        previous_marks = span.marks.clone();
    }
    previous_marks
}

fn mark_attrs_owned(
    marks: Option<&Vec<TextMark>>,
    mark_type: TextMarkType,
) -> Option<BTreeMap<String, String>> {
    mark_attrs(marks, mark_type)
        .cloned()
        .and_then(|attrs| (!attrs.is_empty()).then_some(attrs))
}

fn mark_attrs_equal(
    left: &Option<BTreeMap<String, String>>,
    right: &Option<BTreeMap<String, String>>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left == right,
        (None, None) => true,
        (Some(left), None) => left.is_empty(),
        (None, Some(right)) => right.is_empty(),
    }
}

fn is_same_block_selection(selection: &Selection) -> bool {
    selection.anchor.block_id == selection.focus.block_id
}

fn selected_range(selection: &Selection) -> TextRange {
    TextRange {
        block_id: selection.anchor.block_id.clone(),
        start: selection.anchor.offset.min(selection.focus.offset),
        end: selection.anchor.offset.max(selection.focus.offset),
    }
}

fn mark_ranges_in_block(block: &Block, mark_type: TextMarkType) -> Vec<MarkRange> {
    let mut ranges: Vec<MarkRange> = Vec::new();
    let mut cursor = 0;
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if !has_mark_type(span.marks.as_ref(), mark_type) {
            continue;
        }
        let attrs = mark_attrs_owned(span.marks.as_ref(), mark_type);
        if let Some(previous) = ranges.last_mut() {
            if previous.end == span_start && mark_attrs_equal(&previous.attrs, &attrs) {
                previous.end = span_end;
                continue;
            }
        }
        ranges.push(MarkRange {
            attrs,
            block_id: block.id.clone(),
            end: span_end,
            start: span_start,
        });
    }
    ranges
}

fn mark_range_at_offset(block: &Block, offset: i32, mark_type: TextMarkType) -> Option<TextRange> {
    let safe_offset = offset.clamp(0, utf16_len(&block_plain_text(block)) as i32);
    mark_ranges_in_block(block, mark_type)
        .into_iter()
        .find(|range| {
            if range.start == range.end {
                return false;
            }
            if safe_offset == 0 {
                range.start == 0
            } else {
                safe_offset > range.start && safe_offset <= range.end
            }
        })
        .map(|range| TextRange {
            block_id: range.block_id,
            start: range.start,
            end: range.end,
        })
}

fn editable_mark_range_at_selection(block: &Block, selection: &Selection) -> Option<TextRange> {
    if !is_same_block_selection(selection) {
        return None;
    }
    let range = selected_range(selection);
    if range.start != range.end {
        return Some(range);
    }
    mark_range_at_offset(block, range.start, TextMarkType::Link)
        .or_else(|| mark_range_at_offset(block, range.start, TextMarkType::IconLink))
}

fn selection_has_mark(block: &Block, selection: &Selection, mark_type: TextMarkType) -> bool {
    if !is_same_block_selection(selection) {
        return false;
    }
    let range = selected_range(selection);
    if range.start == range.end {
        return mark_range_at_offset(block, range.start, mark_type).is_some();
    }

    let mut cursor = 0;
    let mut touched = false;
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if span_end <= range.start || span_start >= range.end {
            continue;
        }
        touched = true;
        if !has_mark_type(span.marks.as_ref(), mark_type) {
            return false;
        }
    }
    touched
}

fn selected_mark_attrs(
    block: &Block,
    selection: &Selection,
    mark_type: TextMarkType,
) -> Option<BTreeMap<String, String>> {
    if !is_same_block_selection(selection) {
        return None;
    }
    let range = selected_range(selection);
    if range.start == range.end && mark_range_at_offset(block, range.start, mark_type).is_none() {
        return None;
    }

    let mut cursor = 0;
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if range.start == range.end {
            let outside = if range.start == 0 {
                span_start != 0
            } else {
                range.start <= span_start || range.start > span_end
            };
            if outside {
                continue;
            }
        } else if span_end <= range.start || span_start >= range.end {
            continue;
        }
        return mark_attrs_owned(span.marks.as_ref(), mark_type);
    }
    None
}

fn inactive_selection_mark_state() -> SelectionMarkState {
    SelectionMarkState {
        active: false,
        attrs: None,
        mixed: false,
    }
}

fn stored_mark_state(mark: Option<&TextMark>) -> SelectionMarkState {
    if let Some(mark) = mark {
        SelectionMarkState {
            active: true,
            attrs: (!mark.attrs.is_empty()).then_some(mark.attrs.clone()),
            mixed: false,
        }
    } else {
        inactive_selection_mark_state()
    }
}

fn collapsed_mark_state(
    block: &Block,
    selection: &Selection,
    mark_type: TextMarkType,
) -> SelectionMarkState {
    if selection_has_mark(block, selection, mark_type) {
        SelectionMarkState {
            active: true,
            attrs: selected_mark_attrs(block, selection, mark_type),
            mixed: false,
        }
    } else {
        inactive_selection_mark_state()
    }
}

fn span_mark_state(marks: Option<&Vec<TextMark>>, mark_type: TextMarkType) -> SelectionMarkState {
    stored_mark_state(marks.and_then(|marks| marks.iter().find(|mark| mark.mark_type == mark_type)))
}

fn record_selection_mark_span(
    accumulator: &mut SelectionMarkAccumulator,
    marks: Option<&Vec<TextMark>>,
    mark_type: TextMarkType,
) {
    accumulator.touched = true;
    let attrs = mark_attrs_owned(marks, mark_type);
    if !has_mark_type(marks, mark_type) {
        accumulator.unmarked += 1;
        return;
    }

    accumulator.marked += 1;
    if !accumulator.saw_first_attrs {
        accumulator.first_attrs = attrs;
        accumulator.saw_first_attrs = true;
    } else if !mark_attrs_equal(&accumulator.first_attrs, &attrs) {
        accumulator.attrs_mixed = true;
    }
}

fn selection_mark_accumulator_state(accumulator: SelectionMarkAccumulator) -> SelectionMarkState {
    if !accumulator.touched || accumulator.marked == 0 {
        inactive_selection_mark_state()
    } else if accumulator.unmarked > 0 {
        SelectionMarkState {
            active: false,
            attrs: accumulator.first_attrs,
            mixed: true,
        }
    } else {
        SelectionMarkState {
            active: true,
            attrs: if accumulator.attrs_mixed {
                None
            } else {
                accumulator.first_attrs
            },
            mixed: accumulator.attrs_mixed,
        }
    }
}

fn selection_mark_state(
    block: &Block,
    selection: &Selection,
    mark_type: TextMarkType,
    stored_marks: Option<Vec<TextMark>>,
) -> SelectionMarkState {
    if !is_same_block_selection(selection) {
        return inactive_selection_mark_state();
    }

    let range = selected_range(selection);
    if range.start == range.end {
        if let Some(stored_marks) = stored_marks {
            return stored_mark_state(stored_marks.iter().find(|mark| mark.mark_type == mark_type));
        }
        return collapsed_mark_state(block, selection, mark_type);
    }

    let mut cursor = 0;
    let mut accumulator = SelectionMarkAccumulator::default();

    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if span_end <= range.start || span_start >= range.end {
            continue;
        }

        record_selection_mark_span(&mut accumulator, span.marks.as_ref(), mark_type);
    }
    selection_mark_accumulator_state(accumulator)
}

fn selection_formatting_snapshot(
    block: &Block,
    selection: &Selection,
    marks: Vec<TextMarkType>,
    stored_marks: Option<Vec<TextMark>>,
) -> Vec<SelectionFormattingSnapshotItem> {
    if !is_same_block_selection(selection) {
        return marks
            .into_iter()
            .map(|mark| SelectionFormattingSnapshotItem {
                mark,
                state: inactive_selection_mark_state(),
            })
            .collect();
    }

    let range = selected_range(selection);
    if range.start == range.end {
        return marks
            .into_iter()
            .map(|mark| {
                let state = if let Some(stored_marks) = stored_marks.as_ref() {
                    stored_mark_state(
                        stored_marks
                            .iter()
                            .find(|stored_mark| stored_mark.mark_type == mark),
                    )
                } else {
                    span_mark_state(span_marks_at_offset(block, range.start).as_ref(), mark)
                };
                SelectionFormattingSnapshotItem { mark, state }
            })
            .collect();
    }

    let mut states: Vec<(TextMarkType, SelectionMarkAccumulator)> = marks
        .into_iter()
        .map(|mark| (mark, SelectionMarkAccumulator::default()))
        .collect();
    let mut cursor = 0;

    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if span_end <= range.start || span_start >= range.end {
            continue;
        }

        for (mark, accumulator) in &mut states {
            record_selection_mark_span(accumulator, span.marks.as_ref(), *mark);
        }
    }

    states
        .into_iter()
        .map(|(mark, accumulator)| SelectionFormattingSnapshotItem {
            mark,
            state: selection_mark_accumulator_state(accumulator),
        })
        .collect()
}

fn update_text_preserving_marks(block: &Block, next_text: &str) -> Vec<TextSpan> {
    let previous_text = block_plain_text(block);
    if previous_text == next_text {
        return block.text.clone();
    }

    let previous_len = utf16_len(&previous_text) as i32;
    let next_len = utf16_len(next_text) as i32;
    let prefix_len = common_prefix_len_utf16(&previous_text, next_text);
    let suffix_len = common_suffix_len_utf16(&previous_text, next_text, prefix_len);
    let previous_replace_start = prefix_len;
    let previous_replace_end = previous_len - suffix_len;
    let next_replace_end = next_len - suffix_len;
    let inserted_text = slice_utf16(next_text, prefix_len, next_replace_end);
    let inserted_marks = span_marks_at_offset(block, previous_replace_start);

    let mut cursor = 0;
    let mut inserted = false;
    let mut next_spans = Vec::new();
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;

        if span_end < previous_replace_start {
            next_spans.push(span.clone());
            continue;
        }

        if span_start > previous_replace_end {
            if !inserted {
                next_spans.push(text_span(inserted_text.clone(), inserted_marks.clone()));
                inserted = true;
            }
            next_spans.push(span.clone());
            continue;
        }

        if !inserted {
            let before_end =
                (previous_replace_start - span_start).clamp(0, utf16_len(&span.text) as i32);
            let before_text = slice_utf16(&span.text, 0, before_end);
            if !before_text.is_empty() {
                next_spans.push(text_span(before_text, span.marks.clone()));
            }
            next_spans.push(text_span(inserted_text.clone(), inserted_marks.clone()));
            inserted = true;
        }

        if span_end > previous_replace_end {
            let after_start =
                (previous_replace_end - span_start).clamp(0, utf16_len(&span.text) as i32);
            let after_text = slice_utf16(&span.text, after_start, utf16_len(&span.text) as i32);
            if !after_text.is_empty() {
                next_spans.push(text_span(after_text, span.marks.clone()));
            }
        }
    }

    if !inserted {
        next_spans.push(text_span(inserted_text, inserted_marks));
    }
    merge_text_spans(next_spans)
}

fn slice_text_spans(block: &Block, start_offset: i32, end_offset: i32) -> Vec<TextSpan> {
    let text_length = utf16_len(&block_plain_text(block)) as i32;
    let start = start_offset.clamp(0, text_length);
    let end = end_offset.clamp(start, text_length);
    let mut cursor = 0;
    let mut spans = Vec::new();
    for span in &block.text {
        let span_start = cursor;
        let span_end = cursor + utf16_len(&span.text) as i32;
        cursor = span_end;
        if span_end <= start || span_start >= end {
            continue;
        }
        let slice_start = start.max(span_start) - span_start;
        let slice_end = end.min(span_end) - span_start;
        let text = slice_utf16(&span.text, slice_start, slice_end);
        if !text.is_empty() {
            spans.push(text_span(text, span.marks.clone()));
        }
    }
    merge_text_spans(spans)
}

fn spans_plain_text_len(spans: &[TextSpan]) -> i32 {
    spans.iter().map(|span| utf16_len(&span.text) as i32).sum()
}

fn clone_block_with_fresh_ids(mut block: Block) -> Block {
    block.id = next_id("blk");
    block.children = block.children.map(|children| {
        children
            .into_iter()
            .map(clone_block_with_fresh_ids)
            .collect()
    });
    normalize_block(block)
}

fn block_with_id(mut block: Block, id: String) -> Block {
    block.id = id;
    normalize_block(block)
}

fn replace_block_text(mut block: Block, text: Vec<TextSpan>) -> Block {
    block.text = merge_text_spans(text);
    normalize_block(block)
}

fn create_block(input: CreateBlockInput) -> Block {
    let block_type = input.block_type.unwrap_or_default();
    let text = match input.text {
        Some(TextInput::String(value)) => vec![text_span(value, None)],
        Some(TextInput::Spans(spans)) => spans
            .into_iter()
            .map(|span| text_span(span.text, span.marks))
            .collect(),
        None => Vec::new(),
    };
    normalize_block(Block {
        id: input.id.unwrap_or_else(|| next_id("blk")),
        block_type,
        text,
        level: if block_type == BlockType::Heading {
            Some(input.level.unwrap_or(1).clamp(1, 3))
        } else {
            None
        },
        indent: input
            .indent
            .map(|value| value.clamp(0, MAX_BLOCK_INDENT))
            .filter(|value| *value > 0),
        checked: if block_type == BlockType::Todo {
            Some(input.checked.unwrap_or(false))
        } else {
            None
        },
        attrs: input.attrs.filter(|attrs| !attrs.is_empty()),
        children: input
            .children
            .map(|children| children.into_iter().map(normalize_block).collect()),
    })
}

fn normalize_block(mut block: Block) -> Block {
    block.text = if block.block_type == BlockType::Divider {
        Vec::new()
    } else {
        merge_text_spans(block.text)
    };
    if block.block_type != BlockType::Heading {
        block.level = None;
    } else {
        block.level = Some(block.level.unwrap_or(1).clamp(1, 3));
    }
    if block.block_type != BlockType::Todo {
        block.checked = None;
    } else {
        block.checked = Some(block.checked.unwrap_or(false));
    }
    if matches!(
        block.block_type,
        BlockType::Image
            | BlockType::Toggle
            | BlockType::Table
            | BlockType::Bookmark
            | BlockType::Embed
            | BlockType::File
            | BlockType::PageLink
            | BlockType::Raw
            | BlockType::CodeBlock
            | BlockType::Callout
    ) {
        block.attrs = block.attrs.filter(|attrs| !attrs.is_empty());
    } else {
        block.attrs = block.attrs.filter(|attrs| !attrs.is_empty());
    }
    block.indent = block
        .indent
        .map(|value| value.clamp(0, MAX_BLOCK_INDENT))
        .filter(|value| *value > 0);
    block.children = block
        .children
        .map(|children| children.into_iter().map(normalize_block).collect());
    block
}

fn create_document(input: CreateDocumentInput) -> Document {
    normalize_document(Document {
        version: 1,
        title: input.title.unwrap_or_else(|| "Untitled".to_string()),
        blocks: input
            .blocks
            .filter(|blocks| !blocks.is_empty())
            .unwrap_or_else(|| vec![create_block(CreateBlockInput::default())]),
    })
}

fn normalize_document(document: Document) -> Document {
    let mut blocks: Vec<Block> = document.blocks.into_iter().map(normalize_block).collect();
    if blocks.is_empty() {
        blocks.push(create_block(CreateBlockInput::default()));
    }
    Document {
        version: 1,
        title: if document.title.is_empty() {
            "Untitled".to_string()
        } else {
            document.title
        },
        blocks,
    }
}

fn find_block<'a>(document: &'a Document, block_id: &str) -> Option<&'a Block> {
    document.blocks.iter().find(|block| block.id == block_id)
}

fn find_block_mut<'a>(blocks: &'a mut [Block], block_id: &str) -> Option<&'a mut Block> {
    blocks.iter_mut().find(|block| block.id == block_id)
}

fn create_cursor(block_id: impl Into<String>, offset: i32) -> Cursor {
    Cursor {
        block_id: block_id.into(),
        offset: offset.max(0),
    }
}

fn create_collapsed_selection(block_id: impl Into<String>, offset: i32) -> Selection {
    let cursor = create_cursor(block_id, offset);
    Selection {
        anchor: cursor.clone(),
        focus: cursor,
    }
}

fn clamp_cursor(document: &Document, cursor: Cursor) -> Cursor {
    let block = find_block(document, &cursor.block_id).or_else(|| document.blocks.first());
    if let Some(block) = block {
        create_cursor(
            &block.id,
            cursor
                .offset
                .clamp(0, utf16_len(&block_plain_text(block)) as i32),
        )
    } else {
        cursor
    }
}

fn clamp_selection(document: &Document, selection: Selection) -> Selection {
    Selection {
        anchor: clamp_cursor(document, selection.anchor),
        focus: clamp_cursor(document, selection.focus),
    }
}

fn selection_at_block_end(document: &Document, block_id: &str) -> Selection {
    let offset = find_block(document, block_id)
        .map(|block| utf16_len(&block_plain_text(block)) as i32)
        .unwrap_or(0);
    create_collapsed_selection(block_id, offset)
}

fn transaction(
    kind: TransactionKind,
    before: Document,
    after: Document,
    selection: Option<Selection>,
) -> Transaction {
    Transaction {
        id: next_id("tx"),
        kind,
        before,
        after: normalize_document(after),
        selection,
        created_at: next_id("created"),
    }
}

fn update_block_text(document: Document, block_id: &str, text: String, offset: i32) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).and_then(|block| {
        if block.block_type == BlockType::Divider {
            return None;
        }
        block.text = update_text_preserving_marks(block, &text);
        Some(create_collapsed_selection(block_id, offset))
    });
    transaction(TransactionKind::UpdateText, before, after, selection)
}

fn update_block_text_with_markdown_shortcut(
    document: Document,
    block_id: &str,
    text: String,
    offset: i32,
) -> Transaction {
    let before = document.clone();
    let text_tx = update_block_text(document, block_id, text, offset);
    let mut after = text_tx.after;
    let mut kind = TransactionKind::UpdateText;
    let selection = if let Some(index) = after.blocks.iter().position(|block| block.id == block_id)
    {
        let updated = after.blocks[index].clone();
        if updated.block_type == BlockType::Paragraph {
            let converted = apply_markdown_shortcut(updated.clone());
            if converted.block_type != updated.block_type || converted.level != updated.level {
                after.blocks[index] = converted;
                kind = TransactionKind::MarkdownShortcut;
                Some(create_collapsed_selection(block_id, 0))
            } else {
                text_tx.selection
            }
        } else {
            text_tx.selection
        }
    } else {
        text_tx.selection
    };
    transaction(kind, before, after, selection)
}

fn toggle_text_mark(
    document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    mark_type: TextMarkType,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).and_then(|block| {
        if block.block_type == BlockType::Divider {
            return None;
        }
        let text_length = utf16_len(&block_plain_text(block)) as i32;
        let start = start_offset.min(end_offset).clamp(0, text_length);
        let end = start_offset.max(end_offset).clamp(0, text_length);
        if start == end {
            return Some(create_collapsed_selection(block_id, start));
        }

        let mut cursor = 0i32;
        let mut every_selected_span_has_mark = true;
        for span in &block.text {
            let span_start = cursor;
            let span_end = cursor + utf16_len(&span.text) as i32;
            cursor = span_end;
            if span_end <= start || span_start >= end {
                continue;
            }
            if !has_mark_type(span.marks.as_ref(), mark_type) {
                every_selected_span_has_mark = false;
            }
        }

        cursor = 0;
        let mut next_spans = Vec::new();
        for span in &block.text {
            let span_start = cursor;
            let span_end = cursor + utf16_len(&span.text) as i32;
            cursor = span_end;
            if span_end <= start || span_start >= end {
                next_spans.push(span.clone());
                continue;
            }
            let selection_start = start.max(span_start) - span_start;
            let selection_end = end.min(span_end) - span_start;
            let before_text = slice_utf16(&span.text, 0, selection_start);
            let selected_text = slice_utf16(&span.text, selection_start, selection_end);
            let after_text = slice_utf16(&span.text, selection_end, utf16_len(&span.text) as i32);
            let mut marks = span.marks.clone().unwrap_or_default();
            if every_selected_span_has_mark {
                remove_mark_type(&mut marks, mark_type);
            } else if !has_mark_type(Some(&marks), mark_type) {
                marks.push(text_mark(mark_type));
            }
            if !before_text.is_empty() {
                next_spans.push(text_span(before_text, span.marks.clone()));
            }
            if !selected_text.is_empty() {
                next_spans.push(text_span(selected_text, Some(marks)));
            }
            if !after_text.is_empty() {
                next_spans.push(text_span(after_text, span.marks.clone()));
            }
        }
        block.text = merge_text_spans(next_spans);
        Some(Selection {
            anchor: create_cursor(block_id, start_offset),
            focus: create_cursor(block_id, end_offset),
        })
    });
    transaction(TransactionKind::ToggleTextMark, before, after, selection)
}

fn apply_text_mark(
    mut document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    mark: TextMark,
    remove: bool,
) -> (Document, Option<Selection>) {
    let selection = find_block_mut(&mut document.blocks, block_id).and_then(|block| {
        if block.block_type == BlockType::Divider {
            return None;
        }
        let text_length = utf16_len(&block_plain_text(block)) as i32;
        let start = start_offset.min(end_offset).clamp(0, text_length);
        let end = start_offset.max(end_offset).clamp(0, text_length);
        if start == end {
            return Some(create_collapsed_selection(block_id, start));
        }

        let mut cursor = 0;
        let mut next_spans = Vec::new();
        for span in &block.text {
            let span_start = cursor;
            let span_end = cursor + utf16_len(&span.text) as i32;
            cursor = span_end;
            if span_end <= start || span_start >= end {
                next_spans.push(span.clone());
                continue;
            }

            let selection_start = start.max(span_start) - span_start;
            let selection_end = end.min(span_end) - span_start;
            let before_text = slice_utf16(&span.text, 0, selection_start);
            let selected_text = slice_utf16(&span.text, selection_start, selection_end);
            let after_text = slice_utf16(&span.text, selection_end, utf16_len(&span.text) as i32);
            let mut marks = span.marks.clone().unwrap_or_default();
            remove_mark_type(&mut marks, mark.mark_type);
            if !remove {
                marks.push(mark.clone());
            }

            if !before_text.is_empty() {
                next_spans.push(text_span(before_text, span.marks.clone()));
            }
            if !selected_text.is_empty() {
                next_spans.push(text_span(selected_text, Some(marks)));
            }
            if !after_text.is_empty() {
                next_spans.push(text_span(after_text, span.marks.clone()));
            }
        }
        block.text = merge_text_spans(next_spans);
        Some(Selection {
            anchor: create_cursor(block_id, start_offset),
            focus: create_cursor(block_id, end_offset),
        })
    });
    (document, selection)
}

fn set_text_mark(
    document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    mark: TextMark,
) -> Transaction {
    let before = document.clone();
    let (after, selection) =
        apply_text_mark(document, block_id, start_offset, end_offset, mark, false);
    transaction(TransactionKind::SetTextMark, before, after, selection)
}

fn unset_text_mark(
    document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    mark_type: TextMarkType,
) -> Transaction {
    let before = document.clone();
    let (after, selection) = apply_text_mark(
        document,
        block_id,
        start_offset,
        end_offset,
        text_mark(mark_type),
        true,
    );
    transaction(TransactionKind::UnsetTextMark, before, after, selection)
}

fn insert_block_after(
    document: Document,
    after_block_id: Option<&str>,
    block: Block,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = if let Some(after_block_id) = after_block_id {
        let index = after
            .blocks
            .iter()
            .position(|candidate| candidate.id == after_block_id)
            .map(|index| index + 1)
            .unwrap_or(after.blocks.len());
        after.blocks.insert(index, block.clone());
        Some(create_collapsed_selection(block.id, 0))
    } else {
        after.blocks.insert(0, block.clone());
        Some(create_collapsed_selection(block.id, 0))
    };
    transaction(TransactionKind::InsertBlock, before, after, selection)
}

fn insert_document_fragment(
    document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    fragment: Document,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let mut fragment_blocks: Vec<Block> = fragment
        .blocks
        .into_iter()
        .map(clone_block_with_fresh_ids)
        .collect();
    if fragment_blocks.is_empty() {
        return transaction(TransactionKind::InsertFragment, before, after, None);
    }

    let selection = if let Some(index) = after.blocks.iter().position(|block| block.id == block_id)
    {
        let target = after.blocks[index].clone();
        let target_text_length = utf16_len(&block_plain_text(&target)) as i32;
        let start = start_offset.min(end_offset).clamp(0, target_text_length);
        let end = start_offset.max(end_offset).clamp(0, target_text_length);
        let replaces_whole_block = start == 0 && end == target_text_length;
        let prefix_spans = slice_text_spans(&target, 0, start);
        let suffix_spans = slice_text_spans(&target, end, target_text_length);

        if fragment_blocks.len() == 1 {
            let inserted = fragment_blocks.remove(0);
            let inserted_len = spans_plain_text_len(&inserted.text);
            if replaces_whole_block {
                let next_block = block_with_id(inserted, target.id.clone());
                let selection_offset = utf16_len(&block_plain_text(&next_block)) as i32;
                after.blocks[index] = next_block;
                Some(create_collapsed_selection(block_id, selection_offset))
            } else {
                let mut next_spans = prefix_spans;
                next_spans.extend(inserted.text);
                next_spans.extend(suffix_spans);
                after.blocks[index] = replace_block_text(target, next_spans);
                Some(create_collapsed_selection(block_id, start + inserted_len))
            }
        } else if replaces_whole_block {
            let mut inserted_blocks = fragment_blocks;
            inserted_blocks[0].id = target.id.clone();
            let last_id = inserted_blocks
                .last()
                .map(|block| block.id.clone())
                .unwrap_or_else(|| target.id.clone());
            let last_offset = inserted_blocks
                .last()
                .map(|block| utf16_len(&block_plain_text(block)) as i32)
                .unwrap_or(0);
            after.blocks.splice(
                index..index + 1,
                inserted_blocks.into_iter().map(normalize_block),
            );
            Some(create_collapsed_selection(last_id, last_offset))
        } else {
            let first = fragment_blocks.remove(0);
            let mut last = fragment_blocks
                .pop()
                .expect("fragment has at least two blocks");
            let last_id = last.id.clone();
            let last_offset = utf16_len(&block_plain_text(&last)) as i32;

            let mut first_spans = prefix_spans;
            first_spans.extend(first.text);
            let first_block = replace_block_text(target, first_spans);

            last.text.extend(suffix_spans);
            let mut inserted_blocks = Vec::with_capacity(fragment_blocks.len() + 2);
            inserted_blocks.push(first_block);
            inserted_blocks.extend(fragment_blocks.into_iter().map(normalize_block));
            inserted_blocks.push(normalize_block(last));
            after.blocks.splice(index..index + 1, inserted_blocks);
            Some(create_collapsed_selection(last_id, last_offset))
        }
    } else {
        let last = fragment_blocks.last().cloned();
        after
            .blocks
            .extend(fragment_blocks.into_iter().map(normalize_block));
        last.map(|block| {
            create_collapsed_selection(
                block.id.clone(),
                utf16_len(&block_plain_text(&block)) as i32,
            )
        })
    };

    transaction(TransactionKind::InsertFragment, before, after, selection)
}

fn split_block(document: Document, block_id: &str, offset: i32) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = if let Some(index) = after.blocks.iter().position(|block| block.id == block_id)
    {
        let block = after.blocks[index].clone();
        let text = block_plain_text(&block);
        let safe_offset = offset.clamp(0, utf16_len(&text) as i32);
        after.blocks[index].text = vec![text_span(slice_utf16(&text, 0, safe_offset), None)];
        let next_block = create_block(CreateBlockInput {
            block_type: Some(if block.block_type == BlockType::Heading {
                BlockType::Paragraph
            } else {
                block.block_type
            }),
            text: Some(TextInput::String(slice_utf16(
                &text,
                safe_offset,
                utf16_len(&text) as i32,
            ))),
            checked: if block.block_type == BlockType::Todo {
                Some(false)
            } else {
                None
            },
            ..Default::default()
        });
        after.blocks.insert(index + 1, next_block.clone());
        Some(create_collapsed_selection(next_block.id, 0))
    } else {
        None
    };
    transaction(TransactionKind::SplitBlock, before, after, selection)
}

fn merge_with_previous(document: Document, block_id: &str) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = if let Some(index) = after.blocks.iter().position(|block| block.id == block_id)
    {
        if index == 0 || after.blocks[index - 1].block_type == BlockType::Divider {
            None
        } else {
            let current = after.blocks.remove(index);
            let previous = &mut after.blocks[index - 1];
            let previous_text = block_plain_text(previous);
            previous.text = vec![text_span(
                format!("{}{}", previous_text, block_plain_text(&current)),
                None,
            )];
            Some(create_collapsed_selection(
                &previous.id,
                utf16_len(&previous_text) as i32,
            ))
        }
    } else {
        None
    };
    transaction(TransactionKind::MergeBlock, before, after, selection)
}

fn delete_block(document: Document, block_id: &str) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = if let Some(index) = after.blocks.iter().position(|block| block.id == block_id)
    {
        if after.blocks.len() == 1 {
            None
        } else {
            let removed = after.blocks.remove(index);
            let next_index = index.min(after.blocks.len() - 1);
            let next = after
                .blocks
                .get(next_index)
                .or_else(|| after.blocks.get(index.saturating_sub(1)))
                .unwrap_or(&removed);
            Some(create_collapsed_selection(
                &next.id,
                utf16_len(&block_plain_text(next)) as i32,
            ))
        }
    } else {
        None
    };
    transaction(TransactionKind::DeleteBlock, before, after, selection)
}

fn move_block(document: Document, block_id: &str, to_index: i32) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection =
        if let Some(from_index) = after.blocks.iter().position(|block| block.id == block_id) {
            let block = after.blocks.remove(from_index);
            let safe_index = to_index.clamp(0, after.blocks.len() as i32) as usize;
            let text_length = utf16_len(&block_plain_text(&block)) as i32;
            after.blocks.insert(safe_index, block);
            Some(create_collapsed_selection(block_id, text_length))
        } else {
            None
        };
    transaction(TransactionKind::MoveBlock, before, after, selection)
}

fn set_block_indent(
    document: Document,
    block_id: &str,
    indent: i32,
    offset: Option<i32>,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).map(|block| {
        let indent = indent.clamp(0, MAX_BLOCK_INDENT);
        block.indent = (indent > 0).then_some(indent);
        create_collapsed_selection(
            block_id,
            offset.unwrap_or_else(|| utf16_len(&block_plain_text(block)) as i32),
        )
    });
    transaction(TransactionKind::SetBlockIndent, before, after, selection)
}

fn set_block_attrs(
    document: Document,
    block_id: &str,
    attrs: BTreeMap<String, Value>,
    offset: Option<i32>,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).map(|block| {
        let mut next_attrs = block.attrs.clone().unwrap_or_default();
        for (key, value) in attrs {
            if value.is_null() || value.as_str().is_some_and(|value| value.trim().is_empty()) {
                next_attrs.remove(&key);
            } else {
                next_attrs.insert(key, value);
            }
        }
        block.attrs = (!next_attrs.is_empty()).then_some(next_attrs);
        create_collapsed_selection(
            block_id,
            offset.unwrap_or_else(|| utf16_len(&block_plain_text(block)) as i32),
        )
    });
    transaction(TransactionKind::SetBlockAttrs, before, after, selection)
}

fn toggle_todo(document: Document, block_id: &str) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).map(|block| {
        block.block_type = BlockType::Todo;
        block.checked = Some(!block.checked.unwrap_or(false));
        create_collapsed_selection(block_id, utf16_len(&block_plain_text(block)) as i32)
    });
    transaction(TransactionKind::ToggleTodo, before, after, selection)
}

fn set_block_type(
    document: Document,
    block_id: &str,
    block_type: BlockType,
    level: Option<i32>,
    text: Option<String>,
) -> Transaction {
    let before = document.clone();
    let mut after = document;
    let selection = find_block_mut(&mut after.blocks, block_id).map(|block| {
        block.block_type = block_type;
        block.level = (block_type == BlockType::Heading).then_some(level.unwrap_or(1).clamp(1, 3));
        block.checked = (block_type == BlockType::Todo).then_some(block.checked.unwrap_or(false));
        if !matches!(block_type, BlockType::CodeBlock | BlockType::Callout) {
            block.attrs = None;
        }
        if let Some(text) = text {
            block.text = vec![text_span(text, None)];
        }
        if block_type == BlockType::Divider {
            block.text = Vec::new();
        }
        create_collapsed_selection(block_id, utf16_len(&block_plain_text(block)) as i32)
    });
    transaction(TransactionKind::SetBlockType, before, after, selection)
}

fn text_without_last_slash_query(text: &str, query: &str) -> String {
    let pattern = format!("/{query}");
    if let Some(start) = text.rfind(&pattern) {
        let end = start + pattern.len();
        format!("{}{}", &text[..start], &text[end..])
    } else {
        text.to_string()
    }
}

fn execute_block_command(
    document: Document,
    block_id: &str,
    command: BlockCommandInput,
    source: BlockCommandSource,
    slash_query: Option<&str>,
) -> Transaction {
    let next_text = find_block(&document, block_id).and_then(|block| match source {
        BlockCommandSource::Slash => {
            let query = slash_query.unwrap_or_default();
            Some(text_without_last_slash_query(
                &block_plain_text(block),
                query,
            ))
        }
        BlockCommandSource::TurnInto => {
            (block.block_type != BlockType::Divider).then(|| block_plain_text(block))
        }
    });
    set_block_type(
        document,
        block_id,
        command.block_type,
        command.level,
        next_text,
    )
}

fn create_history(document: Document) -> History {
    History {
        document,
        undo_stack: Vec::new(),
        redo_stack: Vec::new(),
    }
}

fn apply_transaction(mut history: History, tx: Transaction) -> History {
    history.document = tx.after.clone();
    history.undo_stack.push(tx);
    history.redo_stack.clear();
    history
}

fn undo(mut history: History) -> History {
    if let Some(tx) = history.undo_stack.pop() {
        history.document = tx.before.clone();
        history.redo_stack.insert(0, tx);
    }
    history
}

fn redo(mut history: History) -> History {
    if !history.redo_stack.is_empty() {
        let tx = history.redo_stack.remove(0);
        history.document = tx.after.clone();
        history.undo_stack.push(tx);
    }
    history
}

fn apply_markdown_shortcut(block: Block) -> Block {
    let text = block_plain_text(&block);
    if text.ends_with(' ') {
        let hashes = text
            .trim_end()
            .chars()
            .take_while(|character| *character == '#')
            .count();
        if (1..=3).contains(&hashes) && text.trim_end().len() == hashes {
            return create_block(CreateBlockInput {
                id: Some(block.id),
                block_type: Some(BlockType::Heading),
                level: Some(hashes as i32),
                indent: block.indent,
                text: Some(TextInput::String(String::new())),
                ..Default::default()
            });
        }
    }
    let block_type = match text.as_str() {
        "> " => Some(BlockType::Quote),
        "- " | "* " => Some(BlockType::BulletedList),
        "1. " => Some(BlockType::NumberedList),
        "[] " | "[ ] " => Some(BlockType::Todo),
        "---" => Some(BlockType::Divider),
        "```" | "``` " => Some(BlockType::CodeBlock),
        "! " => Some(BlockType::Callout),
        _ => None,
    };
    block_type.map_or(block.clone(), |block_type| {
        create_block(CreateBlockInput {
            id: Some(block.id),
            block_type: Some(block_type),
            indent: block.indent,
            text: Some(TextInput::String(String::new())),
            ..Default::default()
        })
    })
}

fn inline_markdown(text: &str, marks: Option<&Vec<TextMark>>) -> String {
    let mut next = text.to_string();
    if has_mark_type(marks, TextMarkType::Code) {
        next = format!("`{next}`");
    }
    if has_mark_type(marks, TextMarkType::Bold) && has_mark_type(marks, TextMarkType::Italic) {
        next = format!("***{next}***");
    } else if has_mark_type(marks, TextMarkType::Bold) {
        next = format!("**{next}**");
    } else if has_mark_type(marks, TextMarkType::Italic) {
        next = format!("*{next}*");
    }
    if has_mark_type(marks, TextMarkType::Underline) {
        next = format!("<u>{next}</u>");
    }
    if has_mark_type(marks, TextMarkType::Strikethrough) {
        next = format!("~~{next}~~");
    }
    if has_mark_type(marks, TextMarkType::Highlight) {
        next = format!("=={next}==");
    }
    if let Some(attrs) = mark_attrs(marks, TextMarkType::Link) {
        if let Some(href) = attrs.get("href") {
            next = format!("[{next}]({href})");
        }
    }
    if let Some(attrs) = mark_attrs(marks, TextMarkType::IconLink) {
        let icon = attrs
            .get("icon")
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!(" data-link-icon=\"{}\"", escape_html_attr(value)))
            .unwrap_or_default();
        next = format!("<span data-link-style=\"icon\"{icon}>{next}</span>");
    }
    if let Some(attrs) = mark_attrs(marks, TextMarkType::TextColor) {
        if let Some(color) = attrs.get("color") {
            next = format!(
                "<span data-color=\"{}\">{next}</span>",
                escape_html_attr(color)
            );
        }
    }
    if let Some(attrs) = mark_attrs(marks, TextMarkType::BackgroundColor) {
        if let Some(color) = attrs.get("color") {
            next = format!(
                "<span data-bg=\"{}\">{next}</span>",
                escape_html_attr(color)
            );
        }
    }
    next
}

fn spans_to_markdown(spans: &[TextSpan]) -> String {
    spans
        .iter()
        .map(|span| inline_markdown(&span.text, span.marks.as_ref()))
        .collect()
}

fn escape_html_attr(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn attr_string(block: &Block, key: &str) -> Option<String> {
    block
        .attrs
        .as_ref()?
        .get(key)?
        .as_str()
        .map(ToOwned::to_owned)
}

fn document_to_markdown(document: &Document) -> String {
    document
        .blocks
        .iter()
        .map(|block| {
            let text = if block.block_type == BlockType::CodeBlock {
                block_plain_text(block)
            } else {
                spans_to_markdown(&block.text)
            };
            let prefix = "  ".repeat(block.indent.unwrap_or(0) as usize);
            match block.block_type {
                BlockType::Heading => format!(
                    "{}{} {}",
                    prefix,
                    "#".repeat(block.level.unwrap_or(1) as usize),
                    text
                ),
                BlockType::Quote => format!("{prefix}> {text}"),
                BlockType::Divider => format!("{prefix}---"),
                BlockType::Todo => format!(
                    "{}{} {}",
                    prefix,
                    if block.checked.unwrap_or(false) {
                        "[x]"
                    } else {
                        "[ ]"
                    },
                    text
                ),
                BlockType::BulletedList => format!("{prefix}- {text}"),
                BlockType::NumberedList => format!("{prefix}1. {text}"),
                BlockType::CodeBlock => format!("{prefix}```\n{text}\n{prefix}```"),
                BlockType::Callout => format!("{prefix}> [!note] {text}"),
                BlockType::Image => {
                    let alt = attr_string(block, "alt").unwrap_or_else(|| text.clone());
                    let url = attr_string(block, "url").unwrap_or_default();
                    if url.is_empty() {
                        format!("{prefix}![{alt}]()")
                    } else {
                        format!("{prefix}![{alt}]({url})")
                    }
                }
                BlockType::Toggle => format!(
                    "{prefix}<details>\n{prefix}<summary>{text}</summary>\n{prefix}</details>"
                ),
                BlockType::Table => text
                    .lines()
                    .map(|line| format!("{prefix}{line}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                BlockType::Bookmark => {
                    let url = attr_string(block, "url").unwrap_or_default();
                    format!(
                        "{prefix}<Bookmark url=\"{}\">{text}</Bookmark>",
                        escape_html_attr(&url)
                    )
                }
                BlockType::Embed => {
                    let url = attr_string(block, "url").unwrap_or_default();
                    format!("{prefix}<Embed url=\"{}\" />", escape_html_attr(&url))
                }
                BlockType::File => {
                    let url = attr_string(block, "url").unwrap_or_default();
                    let name = attr_string(block, "name").unwrap_or_else(|| text.clone());
                    format!(
                        "{prefix}<File href=\"{}\" name=\"{}\" />",
                        escape_html_attr(&url),
                        escape_html_attr(&name)
                    )
                }
                BlockType::PageLink => {
                    let href = attr_string(block, "href").unwrap_or_default();
                    format!("{prefix}[{text}]({href})")
                }
                BlockType::Raw => format!("{prefix}{text}"),
                BlockType::Paragraph => format!("{prefix}{text}"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn append_span(spans: &mut Vec<TextSpan>, text: String, marks: Option<Vec<TextMark>>) {
    if text.is_empty() {
        return;
    }
    let sorted_marks = normalize_marks(marks);
    if let Some(previous) = spans.last_mut() {
        if previous.marks == sorted_marks {
            previous.text.push_str(&text);
            return;
        }
    }
    spans.push(text_span(text, sorted_marks));
}

fn mark_with_attr(mark_type: TextMarkType, key: &str, value: impl Into<String>) -> TextMark {
    let mut attrs = BTreeMap::new();
    attrs.insert(key.to_string(), value.into());
    TextMark {
        mark_type,
        attrs: clean_mark_attrs(attrs),
    }
}

fn attr_value(input: &str, name: &str) -> Option<String> {
    let double = format!("{name}=\"");
    if let Some(start) = input.find(&double) {
        let start = start + double.len();
        let end = input[start..].find('"')?;
        return Some(input[start..start + end].to_string());
    }
    let single = format!("{name}='");
    if let Some(start) = input.find(&single) {
        let start = start + single.len();
        let end = input[start..].find('\'')?;
        return Some(input[start..start + end].to_string());
    }
    None
}

fn parse_markdown_link(input: &str) -> Option<(String, String, usize)> {
    if !input.starts_with('[') {
        return None;
    }
    let label_end = input[1..].find("](")? + 1;
    let href_start = label_end + 2;
    let href_end = input[href_start..].find(')')? + href_start;
    Some((
        input[1..label_end].to_string(),
        input[href_start..href_end].to_string(),
        href_end + 1,
    ))
}

fn parse_image_markdown(input: &str) -> Option<(String, String)> {
    if !input.starts_with("![") {
        return None;
    }
    let label_end = input[2..].find("](")? + 2;
    let href_start = label_end + 2;
    let href_end = input[href_start..].find(')')? + href_start;
    Some((
        input[2..label_end].to_string(),
        input[href_start..href_end].to_string(),
    ))
}

fn parse_self_closing_attr(input: &str, tag: &str, attr: &str) -> Option<String> {
    let prefix = format!("<{tag} ");
    if !input.starts_with(&prefix) || !input.trim_end().ends_with("/>") {
        return None;
    }
    attr_value(input, attr)
}

fn inline_markdown_to_spans(input: &str) -> Vec<TextSpan> {
    let mut spans = Vec::new();
    let mut index = 0usize;
    while index < input.len() {
        let rest = &input[index..];
        if rest.starts_with("<span") {
            if let Some(open_end) = rest.find('>') {
                let open = &rest[..open_end + 1];
                if let Some(close_start) = rest[open_end + 1..].find("</span>") {
                    let inner_start = index + open_end + 1;
                    let inner_end = inner_start + close_start;
                    let consumed = open_end + 1 + close_start + "</span>".len();
                    let mut inner_spans = inline_markdown_to_spans(&input[inner_start..inner_end]);
                    for span in &mut inner_spans {
                        let mut marks = span.marks.clone().unwrap_or_default();
                        if open.contains("data-link-style=\"icon\"")
                            || open.contains("data-link-style='icon'")
                        {
                            let mut attrs = BTreeMap::new();
                            if let Some(icon) = attr_value(open, "data-link-icon") {
                                attrs.insert("icon".to_string(), icon);
                            }
                            remove_mark_type(&mut marks, TextMarkType::IconLink);
                            marks.push(TextMark {
                                mark_type: TextMarkType::IconLink,
                                attrs: clean_mark_attrs(attrs),
                            });
                        }
                        if let Some(color) = attr_value(open, "data-color") {
                            remove_mark_type(&mut marks, TextMarkType::TextColor);
                            marks.push(mark_with_attr(TextMarkType::TextColor, "color", color));
                        }
                        if let Some(color) = attr_value(open, "data-bg") {
                            remove_mark_type(&mut marks, TextMarkType::BackgroundColor);
                            marks.push(mark_with_attr(
                                TextMarkType::BackgroundColor,
                                "color",
                                color,
                            ));
                        }
                        span.marks = normalize_marks(Some(marks));
                    }
                    spans.extend(inner_spans);
                    index += consumed;
                    continue;
                }
            }
        }
        if let Some((label, href, consumed)) = parse_markdown_link(rest) {
            let mut link_spans = inline_markdown_to_spans(&label);
            for span in &mut link_spans {
                let mut marks = span.marks.clone().unwrap_or_default();
                remove_mark_type(&mut marks, TextMarkType::Link);
                marks.push(mark_with_attr(TextMarkType::Link, "href", href.clone()));
                span.marks = normalize_marks(Some(marks));
            }
            spans.extend(link_spans);
            index += consumed;
            continue;
        }
        if rest.starts_with("***") {
            if let Some(end) = input[index + 3..].find("***") {
                let end = index + 3 + end;
                append_span(
                    &mut spans,
                    input[index + 3..end].to_string(),
                    Some(vec![
                        text_mark(TextMarkType::Bold),
                        text_mark(TextMarkType::Italic),
                    ]),
                );
                index = end + 3;
                continue;
            }
        }
        if rest.starts_with("**") {
            if let Some(end) = input[index + 2..].find("**") {
                let end = index + 2 + end;
                append_span(
                    &mut spans,
                    input[index + 2..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Bold)]),
                );
                index = end + 2;
                continue;
            }
        }
        if rest.starts_with('*') {
            if let Some(end) = input[index + 1..].find('*') {
                let end = index + 1 + end;
                append_span(
                    &mut spans,
                    input[index + 1..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Italic)]),
                );
                index = end + 1;
                continue;
            }
        }
        if rest.starts_with('`') {
            if let Some(end) = input[index + 1..].find('`') {
                let end = index + 1 + end;
                append_span(
                    &mut spans,
                    input[index + 1..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Code)]),
                );
                index = end + 1;
                continue;
            }
        }
        if rest.starts_with("~~") {
            if let Some(end) = input[index + 2..].find("~~") {
                let end = index + 2 + end;
                append_span(
                    &mut spans,
                    input[index + 2..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Strikethrough)]),
                );
                index = end + 2;
                continue;
            }
        }
        if rest.starts_with("==") {
            if let Some(end) = input[index + 2..].find("==") {
                let end = index + 2 + end;
                append_span(
                    &mut spans,
                    input[index + 2..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Highlight)]),
                );
                index = end + 2;
                continue;
            }
        }
        if rest.starts_with("<u>") {
            if let Some(end) = input[index + 3..].find("</u>") {
                let end = index + 3 + end;
                append_span(
                    &mut spans,
                    input[index + 3..end].to_string(),
                    Some(vec![text_mark(TextMarkType::Underline)]),
                );
                index = end + 4;
                continue;
            }
        }
        let marker = input[index + 1..]
            .find(|character| {
                character == '*'
                    || character == '`'
                    || character == '~'
                    || character == '='
                    || character == '<'
                    || character == '['
            })
            .map(|next| index + 1 + next)
            .unwrap_or(input.len());
        append_span(&mut spans, input[index..marker].to_string(), None);
        index = marker;
    }
    if spans.is_empty() {
        vec![text_span("", None)]
    } else {
        spans
    }
}

fn markdown_line_to_block(line: &str) -> Block {
    let leading_spaces = line
        .chars()
        .take_while(|character| *character == ' ')
        .count() as i32;
    let indent = leading_spaces / 2;
    let content = line.trim_start();
    if content.starts_with("### ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Heading),
            level: Some(3),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(&content[4..]))),
            ..Default::default()
        });
    }
    if content.starts_with("## ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Heading),
            level: Some(2),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(&content[3..]))),
            ..Default::default()
        });
    }
    if content.starts_with("# ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Heading),
            level: Some(1),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(&content[2..]))),
            ..Default::default()
        });
    }
    if content.trim() == "---" {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Divider),
            indent: Some(indent),
            ..Default::default()
        });
    }
    if let Some((alt, url)) = parse_image_markdown(content) {
        let mut attrs = BTreeMap::new();
        attrs.insert("alt".to_string(), Value::String(alt.clone()));
        attrs.insert("url".to_string(), Value::String(url));
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Image),
            indent: Some(indent),
            text: Some(TextInput::String(alt)),
            attrs: Some(attrs),
            ..Default::default()
        });
    }
    if let Some(url) = parse_self_closing_attr(content, "Embed", "url") {
        let mut attrs = BTreeMap::new();
        attrs.insert("url".to_string(), Value::String(url.clone()));
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Embed),
            indent: Some(indent),
            text: Some(TextInput::String(url)),
            attrs: Some(attrs),
            ..Default::default()
        });
    }
    if content.starts_with("<File ") {
        let mut attrs = BTreeMap::new();
        if let Some(url) = attr_value(content, "href") {
            attrs.insert("url".to_string(), Value::String(url));
        }
        if let Some(name) = attr_value(content, "name") {
            attrs.insert("name".to_string(), Value::String(name.clone()));
            return create_block(CreateBlockInput {
                block_type: Some(BlockType::File),
                indent: Some(indent),
                text: Some(TextInput::String(name)),
                attrs: Some(attrs),
                ..Default::default()
            });
        }
    }
    if let Some(rest) = content
        .strip_prefix("[x] ")
        .or_else(|| content.strip_prefix("[X] "))
    {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Todo),
            checked: Some(true),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    if let Some(rest) = content.strip_prefix("[ ] ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Todo),
            checked: Some(false),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    if let Some(rest) = content.strip_prefix("> [!note] ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Callout),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    if content.starts_with('|') && content.ends_with('|') {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Table),
            indent: Some(indent),
            text: Some(TextInput::String(content.to_string())),
            ..Default::default()
        });
    }
    if let Some(rest) = content.strip_prefix("> ") {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::Quote),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    if let Some(rest) = content
        .strip_prefix("- ")
        .or_else(|| content.strip_prefix("* "))
    {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::BulletedList),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    let numbered = content.split_once(". ").filter(|(left, _)| {
        !left.is_empty() && left.chars().all(|character| character.is_ascii_digit())
    });
    if let Some((_, rest)) = numbered {
        return create_block(CreateBlockInput {
            block_type: Some(BlockType::NumberedList),
            indent: Some(indent),
            text: Some(TextInput::Spans(inline_markdown_to_spans(rest))),
            ..Default::default()
        });
    }
    create_block(CreateBlockInput {
        block_type: Some(BlockType::Paragraph),
        indent: Some(indent),
        text: Some(TextInput::Spans(inline_markdown_to_spans(content))),
        ..Default::default()
    })
}

fn markdown_to_document(markdown: &str, title: &str) -> Document {
    let mut blocks = Vec::new();
    let mut code_block: Option<(i32, Vec<String>)> = None;
    for line in markdown.split('\n') {
        let leading_spaces = line
            .chars()
            .take_while(|character| *character == ' ')
            .count() as i32;
        let indent = leading_spaces / 2;
        let content = line.trim_start();
        if content.starts_with("```") {
            if let Some((code_indent, lines)) = code_block.take() {
                blocks.push(create_block(CreateBlockInput {
                    block_type: Some(BlockType::CodeBlock),
                    indent: Some(code_indent),
                    text: Some(TextInput::String(lines.join("\n"))),
                    ..Default::default()
                }));
            } else {
                code_block = Some((indent, Vec::new()));
            }
            continue;
        }
        if let Some((_, lines)) = code_block.as_mut() {
            lines.push(line.to_string());
            continue;
        }
        blocks.push(markdown_line_to_block(line));
    }
    if let Some((code_indent, lines)) = code_block.take() {
        blocks.push(create_block(CreateBlockInput {
            block_type: Some(BlockType::CodeBlock),
            indent: Some(code_indent),
            text: Some(TextInput::String(lines.join("\n"))),
            ..Default::default()
        }));
    }
    create_document(CreateDocumentInput {
        title: Some(title.to_string()),
        blocks: Some(blocks),
    })
}

fn block_specs() -> Vec<Command> {
    vec![
        Command {
            name: "paragraph",
            label: "Text",
            description: "Plain paragraph text",
            block_type: BlockType::Paragraph,
            level: None,
            icon: "T",
            placeholder: "Type '/' for commands",
            markdown_shortcut: None,
        },
        Command {
            name: "heading-1",
            label: "Heading 1",
            description: "Large section heading",
            block_type: BlockType::Heading,
            level: Some(1),
            icon: "H1",
            placeholder: "Heading 1",
            markdown_shortcut: Some("# "),
        },
        Command {
            name: "heading-2",
            label: "Heading 2",
            description: "Medium section heading",
            block_type: BlockType::Heading,
            level: Some(2),
            icon: "H2",
            placeholder: "Heading 2",
            markdown_shortcut: Some("## "),
        },
        Command {
            name: "heading-3",
            label: "Heading 3",
            description: "Small section heading",
            block_type: BlockType::Heading,
            level: Some(3),
            icon: "H3",
            placeholder: "Heading 3",
            markdown_shortcut: Some("### "),
        },
        Command {
            name: "quote",
            label: "Quote",
            description: "Quoted text block",
            block_type: BlockType::Quote,
            level: None,
            icon: "Q",
            placeholder: "Quote",
            markdown_shortcut: Some("> "),
        },
        Command {
            name: "divider",
            label: "Divider",
            description: "Horizontal divider",
            block_type: BlockType::Divider,
            level: None,
            icon: "--",
            placeholder: "",
            markdown_shortcut: Some("---"),
        },
        Command {
            name: "todo",
            label: "To-do",
            description: "Checkbox item",
            block_type: BlockType::Todo,
            level: None,
            icon: "[]",
            placeholder: "To-do",
            markdown_shortcut: Some("[ ] "),
        },
        Command {
            name: "bulleted-list",
            label: "Bullet list",
            description: "Bulleted list item",
            block_type: BlockType::BulletedList,
            level: None,
            icon: "*",
            placeholder: "List item",
            markdown_shortcut: Some("- "),
        },
        Command {
            name: "numbered-list",
            label: "Numbered list",
            description: "Numbered list item",
            block_type: BlockType::NumberedList,
            level: None,
            icon: "1.",
            placeholder: "Numbered item",
            markdown_shortcut: Some("1. "),
        },
        Command {
            name: "code-block",
            label: "Code block",
            description: "Preformatted code or text",
            block_type: BlockType::CodeBlock,
            level: None,
            icon: "{}",
            placeholder: "Code",
            markdown_shortcut: Some("```"),
        },
        Command {
            name: "callout",
            label: "Callout",
            description: "Highlighted note block",
            block_type: BlockType::Callout,
            level: None,
            icon: "!",
            placeholder: "Callout",
            markdown_shortcut: Some("! "),
        },
        Command {
            name: "image",
            label: "Image",
            description: "Image with alt text and caption",
            block_type: BlockType::Image,
            level: None,
            icon: "Img",
            placeholder: "Paste an image URL",
            markdown_shortcut: Some("!["),
        },
        Command {
            name: "toggle",
            label: "Toggle",
            description: "Collapsible section",
            block_type: BlockType::Toggle,
            level: None,
            icon: ">",
            placeholder: "Toggle title",
            markdown_shortcut: Some("> "),
        },
        Command {
            name: "table",
            label: "Table",
            description: "Markdown table",
            block_type: BlockType::Table,
            level: None,
            icon: "Tbl",
            placeholder: "Header | Header",
            markdown_shortcut: Some("|"),
        },
        Command {
            name: "bookmark",
            label: "Bookmark",
            description: "Link preview card",
            block_type: BlockType::Bookmark,
            level: None,
            icon: "Bm",
            placeholder: "Bookmark title",
            markdown_shortcut: None,
        },
        Command {
            name: "embed",
            label: "Embed",
            description: "Embedded external content",
            block_type: BlockType::Embed,
            level: None,
            icon: "<>",
            placeholder: "Embed URL",
            markdown_shortcut: None,
        },
        Command {
            name: "file",
            label: "File",
            description: "File attachment",
            block_type: BlockType::File,
            level: None,
            icon: "File",
            placeholder: "File name",
            markdown_shortcut: None,
        },
        Command {
            name: "page-link",
            label: "Page link",
            description: "Link to another document",
            block_type: BlockType::PageLink,
            level: None,
            icon: "@",
            placeholder: "Page title",
            markdown_shortcut: Some("@"),
        },
        Command {
            name: "raw",
            label: "Raw",
            description: "Raw MDX or host markup",
            block_type: BlockType::Raw,
            level: None,
            icon: "{}",
            placeholder: "Raw content",
            markdown_shortcut: None,
        },
    ]
}

fn text_mark_specs() -> Vec<TextMarkSpec> {
    vec![
        TextMarkSpec {
            mark: TextMarkType::Bold,
            label: "Bold",
            description: "Strong emphasis",
            kind: "toggle",
            shortcut: "mod+b",
            tag: "strong",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Italic,
            label: "Italic",
            description: "Soft emphasis",
            kind: "toggle",
            shortcut: "mod+i",
            tag: "em",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Underline,
            label: "Underline",
            description: "Underlined text",
            kind: "toggle",
            shortcut: "mod+u",
            tag: "u",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Code,
            label: "Code",
            description: "Inline code",
            kind: "toggle",
            shortcut: "mod+e",
            tag: "code",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Strikethrough,
            label: "Strikethrough",
            description: "Crossed-out text",
            kind: "toggle",
            shortcut: "mod+shift+x",
            tag: "s",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Highlight,
            label: "Highlight",
            description: "Highlighted text",
            kind: "toggle",
            shortcut: "mod+shift+h",
            tag: "mark",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::Link,
            label: "Link",
            description: "Inline hyperlink",
            kind: "link",
            shortcut: "mod+k",
            tag: "a",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::IconLink,
            label: "Icon link",
            description: "Link presentation with a leading icon",
            kind: "icon-link",
            shortcut: "mod+shift+k",
            tag: "span",
            values: None,
        },
        TextMarkSpec {
            mark: TextMarkType::TextColor,
            label: "Text color",
            description: "Named text color",
            kind: "color",
            shortcut: "",
            tag: "span",
            values: Some(vec![
                "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
                "red",
            ]),
        },
        TextMarkSpec {
            mark: TextMarkType::BackgroundColor,
            label: "Background",
            description: "Named background color",
            kind: "color",
            shortcut: "",
            tag: "span",
            values: Some(vec![
                "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
                "red",
            ]),
        },
    ]
}

fn block_type_slug(block_type: BlockType) -> &'static str {
    match block_type {
        BlockType::Paragraph => "paragraph",
        BlockType::Heading => "heading",
        BlockType::Quote => "quote",
        BlockType::Divider => "divider",
        BlockType::Todo => "todo",
        BlockType::BulletedList => "bulleted-list",
        BlockType::NumberedList => "numbered-list",
        BlockType::CodeBlock => "code-block",
        BlockType::Callout => "callout",
        BlockType::Image => "image",
        BlockType::Toggle => "toggle",
        BlockType::Table => "table",
        BlockType::Bookmark => "bookmark",
        BlockType::Embed => "embed",
        BlockType::File => "file",
        BlockType::PageLink => "page-link",
        BlockType::Raw => "raw",
    }
}

fn command_to_search_input(command: &Command) -> CommandSearchInput {
    CommandSearchInput {
        name: command.name.to_string(),
        label: command.label.to_string(),
        description: command.description.to_string(),
        block_type: command.block_type,
        level: command.level,
        icon: Some(command.icon.to_string()),
        markdown_shortcut: command.markdown_shortcut.map(ToOwned::to_owned),
        group: None,
        slash_menu: Some(true),
    }
}

fn compact_search_value(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| !matches!(character, ' ' | '\t' | '\n' | '\r' | '_' | '-'))
        .collect()
}

fn command_search_aliases(command: &CommandSearchInput) -> Vec<String> {
    let mut aliases = vec![command.name.clone()];
    if let Some(level) = command.name.strip_prefix("heading-") {
        aliases.push(format!("h{level}"));
    }
    if command.block_type == BlockType::Heading {
        if let Some(level) = command.level {
            aliases.push(format!("h{level}"));
        }
    }
    aliases.push(block_type_slug(command.block_type).to_string());
    if let Some(icon) = &command.icon {
        aliases.push(icon.clone());
    }
    if let Some(shortcut) = &command.markdown_shortcut {
        aliases.push(shortcut.clone());
    }
    match command.block_type {
        BlockType::BulletedList => aliases.extend(["bullet".to_string(), "ul".to_string()]),
        BlockType::NumberedList => aliases.extend(["number".to_string(), "ol".to_string()]),
        BlockType::Todo => aliases.extend(["task".to_string(), "checkbox".to_string()]),
        BlockType::CodeBlock => aliases.extend(["codeblock".to_string(), "pre".to_string()]),
        BlockType::Callout => aliases.extend(["note".to_string(), "notice".to_string()]),
        _ => {}
    }
    aliases.retain(|value| !value.trim().is_empty());
    aliases
}

fn command_search_score(command: &CommandSearchInput, query: &str) -> f64 {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty() {
        return 0.0;
    }
    let compact_query = compact_search_value(&normalized);
    for alias in command_search_aliases(command) {
        let compact_alias = compact_search_value(&alias);
        if compact_alias == compact_query {
            return 0.0;
        }
        if compact_alias.starts_with(&compact_query) {
            return 0.5;
        }
    }

    let mut haystacks = vec![
        command.name.replace('-', " "),
        command.label.clone(),
        command.description.clone(),
        command
            .group
            .as_ref()
            .map_or_else(String::new, ToOwned::to_owned),
        block_type_slug(command.block_type).replace('-', " "),
        command
            .markdown_shortcut
            .as_ref()
            .map_or_else(String::new, ToOwned::to_owned),
    ];
    haystacks.retain(|value| !value.trim().is_empty());

    let mut best = f64::INFINITY;
    for value in haystacks {
        let value = value.to_lowercase();
        if value == normalized {
            best = best.min(0.0);
        } else if value.starts_with(&normalized) {
            best = best.min(1.0);
        } else if let Some(index) = value.find(&normalized) {
            best = best.min(2.0 + index as f64 / 100.0);
        }
    }
    best
}

fn search_editor_command_names(commands: Vec<CommandSearchInput>, query: &str) -> Vec<String> {
    let normalized = query.trim();
    let mut indexed: Vec<(usize, CommandSearchInput)> = commands
        .into_iter()
        .enumerate()
        .filter(|(_, command)| command.slash_menu.unwrap_or(true))
        .collect();

    if normalized.is_empty() {
        return indexed
            .into_iter()
            .map(|(_, command)| command.name)
            .collect();
    }

    indexed.retain(|(_, command)| command_search_score(command, normalized).is_finite());
    indexed.sort_by(|(left_index, left), (right_index, right)| {
        let left_score = command_search_score(left, normalized);
        let right_score = command_search_score(right, normalized);
        left_score
            .partial_cmp(&right_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left_index.cmp(right_index))
    });
    indexed
        .into_iter()
        .map(|(_, command)| command.name)
        .collect()
}

fn find_editor_command(query: &str) -> Vec<Command> {
    let commands = block_specs();
    if query.trim().is_empty() {
        return commands;
    }
    let names = search_editor_command_names(
        commands.iter().map(command_to_search_input).collect(),
        query,
    );
    commands
        .into_iter()
        .filter_map(|command| {
            names
                .iter()
                .position(|name| name == command.name)
                .map(|position| (position, command))
        })
        .collect::<BTreeMap<usize, Command>>()
        .into_values()
        .collect()
}
