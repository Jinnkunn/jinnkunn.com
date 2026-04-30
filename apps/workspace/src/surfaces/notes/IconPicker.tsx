import { useEffect, useRef, useState } from "react";

const COMMON_EMOJIS = [
  "📝", "📄", "📋", "📌", "🔖", "💡", "⭐", "❤️",
  "🔥", "✨", "🎯", "🎨", "📚", "🗂", "📂", "🗒",
  "✅", "⚠️", "🚀", "💻", "🔧", "📊", "📈", "🧠",
  "🌟", "🎵", "🎬", "📷", "🍎", "☕", "🌱", "🌍",
];

export function NoteIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notes-icon-picker">
      <button
        ref={triggerRef}
        type="button"
        className="notes-icon-picker__trigger"
        aria-label={value ? "Change note icon" : "Add note icon"}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {value ? <span aria-hidden="true">{value}</span> : <PlusGlyph />}
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className="notes-icon-picker__popover"
          role="dialog"
          aria-label="Pick note icon"
        >
          <div className="notes-icon-picker__grid">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                className="notes-icon-picker__cell"
                aria-label={`Use ${emoji} as icon`}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="notes-icon-picker__footer">
            <input
              type="text"
              className="notes-icon-picker__custom"
              placeholder="Type custom"
              value={value}
              maxLength={8}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
            <button
              type="button"
              className="notes-icon-picker__clear"
              disabled={!value}
              onClick={() => {
                onChange("");
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}
