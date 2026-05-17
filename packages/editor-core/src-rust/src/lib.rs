use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cell::Cell;
use wasm_bindgen::prelude::*;

const MAX_BLOCK_INDENT: i32 = 6;
const MARK_ORDER: [TextMark; 6] = [
    TextMark::Bold,
    TextMark::Italic,
    TextMark::Code,
    TextMark::Underline,
    TextMark::Strikethrough,
    TextMark::Highlight,
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
        "findEditorCommand" => unary::<String, _>(payload, |query| Ok(find_editor_command(&query))),
        "getBlockPlainText" => unary::<Block, _>(payload, |block| Ok(block_plain_text(&block))),
        "getSelectionFocus" => unary::<Selection, _>(payload, |selection| Ok(selection.focus)),
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
        "isSelectionCollapsed" => {
            unary::<Selection, _>(payload, |selection| Ok(selection.anchor == selection.focus))
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
                mark: TextMark,
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
}

impl Default for BlockType {
    fn default() -> Self {
        Self::Paragraph
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TextMark {
    Bold,
    Italic,
    Code,
    Underline,
    Strikethrough,
    Highlight,
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TransactionKind {
    InsertBlock,
    UpdateText,
    SplitBlock,
    MergeBlock,
    DeleteBlock,
    MoveBlock,
    SetBlockIndent,
    ToggleTextMark,
    ToggleTodo,
    SetBlockType,
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

#[derive(Clone, Debug, Serialize)]
struct TextMarkSpec {
    mark: TextMark,
    label: &'static str,
    description: &'static str,
    shortcut: &'static str,
    tag: &'static str,
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

fn normalize_marks(marks: Option<Vec<TextMark>>) -> Option<Vec<TextMark>> {
    let marks = marks?;
    let ordered: Vec<TextMark> = MARK_ORDER
        .iter()
        .copied()
        .filter(|mark| marks.contains(mark))
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
        block.text = vec![text_span(text, None)];
        Some(create_collapsed_selection(block_id, offset))
    });
    transaction(TransactionKind::UpdateText, before, after, selection)
}

fn toggle_text_mark(
    document: Document,
    block_id: &str,
    start_offset: i32,
    end_offset: i32,
    mark: TextMark,
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
            if !span
                .marks
                .as_ref()
                .is_some_and(|marks| marks.contains(&mark))
            {
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
                marks.retain(|candidate| *candidate != mark);
            } else if !marks.contains(&mark) {
                marks.push(mark);
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
    if marks.is_some_and(|marks| marks.contains(&TextMark::Code)) {
        next = format!("`{next}`");
    }
    if marks
        .is_some_and(|marks| marks.contains(&TextMark::Bold) && marks.contains(&TextMark::Italic))
    {
        next = format!("***{next}***");
    } else if marks.is_some_and(|marks| marks.contains(&TextMark::Bold)) {
        next = format!("**{next}**");
    } else if marks.is_some_and(|marks| marks.contains(&TextMark::Italic)) {
        next = format!("*{next}*");
    }
    if marks.is_some_and(|marks| marks.contains(&TextMark::Underline)) {
        next = format!("<u>{next}</u>");
    }
    if marks.is_some_and(|marks| marks.contains(&TextMark::Strikethrough)) {
        next = format!("~~{next}~~");
    }
    if marks.is_some_and(|marks| marks.contains(&TextMark::Highlight)) {
        next = format!("=={next}==");
    }
    next
}

fn spans_to_markdown(spans: &[TextSpan]) -> String {
    spans
        .iter()
        .map(|span| inline_markdown(&span.text, span.marks.as_ref()))
        .collect()
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

fn inline_markdown_to_spans(input: &str) -> Vec<TextSpan> {
    let mut spans = Vec::new();
    let mut index = 0usize;
    while index < input.len() {
        let rest = &input[index..];
        if rest.starts_with("***") {
            if let Some(end) = input[index + 3..].find("***") {
                let end = index + 3 + end;
                append_span(
                    &mut spans,
                    input[index + 3..end].to_string(),
                    Some(vec![TextMark::Bold, TextMark::Italic]),
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
                    Some(vec![TextMark::Bold]),
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
                    Some(vec![TextMark::Italic]),
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
                    Some(vec![TextMark::Code]),
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
                    Some(vec![TextMark::Strikethrough]),
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
                    Some(vec![TextMark::Highlight]),
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
                    Some(vec![TextMark::Underline]),
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
    ]
}

fn text_mark_specs() -> Vec<TextMarkSpec> {
    vec![
        TextMarkSpec {
            mark: TextMark::Bold,
            label: "Bold",
            description: "Strong emphasis",
            shortcut: "mod+b",
            tag: "strong",
        },
        TextMarkSpec {
            mark: TextMark::Italic,
            label: "Italic",
            description: "Soft emphasis",
            shortcut: "mod+i",
            tag: "em",
        },
        TextMarkSpec {
            mark: TextMark::Underline,
            label: "Underline",
            description: "Underlined text",
            shortcut: "mod+u",
            tag: "u",
        },
        TextMarkSpec {
            mark: TextMark::Code,
            label: "Code",
            description: "Inline code",
            shortcut: "mod+e",
            tag: "code",
        },
        TextMarkSpec {
            mark: TextMark::Strikethrough,
            label: "Strikethrough",
            description: "Crossed-out text",
            shortcut: "mod+shift+x",
            tag: "s",
        },
        TextMarkSpec {
            mark: TextMark::Highlight,
            label: "Highlight",
            description: "Highlighted text",
            shortcut: "mod+shift+h",
            tag: "mark",
        },
    ]
}

fn find_editor_command(query: &str) -> Vec<Command> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return block_specs();
    }
    block_specs()
        .into_iter()
        .filter(|command| {
            command.label.to_lowercase().contains(&needle)
                || command.description.to_lowercase().contains(&needle)
                || command.name.contains(&needle)
        })
        .collect()
}
