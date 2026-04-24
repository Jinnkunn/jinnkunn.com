import { useCallback, useState } from "react";
import type { DragEvent, DragEventHandler } from "react";

interface RowProps {
  onDragEnter: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
  "data-drag-state"?: "dragging" | "over";
}

interface HandleProps {
  draggable: true;
  onDragStart: DragEventHandler<HTMLElement>;
  onDragEnd: DragEventHandler<HTMLElement>;
}

/** HTML5-DnD reorder primitive for the 4 admin list editors
 * (Publications / News / Teaching / Works).
 *
 * Usage:
 *   const { getRowProps, getHandleProps } = useDragReorder(entries.length, (from, to) => {
 *     const next = entries.slice();
 *     const [moved] = next.splice(from, 1);
 *     next.splice(to, 0, moved);
 *     onChange(next);
 *   });
 *
 *   <div {...getRowProps(index)}>
 *     <span {...getHandleProps(index)} className="drag-handle">⋮⋮</span>
 *     ...
 *   </div>
 *
 * Keyboard reorder is intentionally not part of this hook — keep the
 * ↑/↓ buttons on each row for non-pointer users.
 */
export function useDragReorder(
  count: number,
  onReorder: (from: number, to: number) => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reset = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const getHandleProps = useCallback(
    (index: number): HandleProps => ({
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        setDragIndex(index);
        event.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without a non-empty payload.
        event.dataTransfer.setData("text/plain", String(index));
      },
      onDragEnd: reset,
    }),
    [reset],
  );

  const getRowProps = useCallback(
    (index: number): RowProps => {
      const state: RowProps["data-drag-state"] =
        dragIndex === index
          ? "dragging"
          : dragIndex !== null && dragIndex !== index && overIndex === index
            ? "over"
            : undefined;
      return {
        onDragEnter: (event: DragEvent<HTMLElement>) => {
          if (dragIndex === null || dragIndex === index) return;
          event.preventDefault();
          setOverIndex(index);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (dragIndex === null || dragIndex === index) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          if (dragIndex === null || dragIndex === index) {
            reset();
            return;
          }
          if (index >= 0 && index < count) {
            onReorder(dragIndex, index);
          }
          reset();
        },
        "data-drag-state": state,
      };
    },
    [dragIndex, overIndex, onReorder, count, reset],
  );

  return { getHandleProps, getRowProps, dragIndex };
}
