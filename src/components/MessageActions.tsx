"use client";

import { useState } from "react";

/* Edit and delete, on any message in any thread.
 *
 * Editing a Muse's own line is allowed on purpose. A companion that says one
 * wrong thing poisons everything after it, because the next reply is built on
 * a transcript that now contains the mistake -- fixing the line is more useful
 * than arguing with it. It is also honest about what this is: your copy of a
 * conversation, on your device.
 *
 * "Delete from here" exists because a conversation usually goes wrong at a
 * point rather than in one line, and taking it back to the fork is what people
 * actually want.
 */

export function MessageActions({
  content,
  onReply,
  onEdit,
  onDelete,
  onDeleteFrom,
}: {
  content: string;
  onReply: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onDeleteFrom: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content);

  if (editing) {
    return (
      <div className="msg-edit" onClick={(e) => e.stopPropagation()}>
        <textarea
          className="input"
          rows={3}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setEditing(false); setText(content); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              if (text.trim()) onEdit(text.trim());
              setEditing(false);
            }
          }}
        />
        <div className="row" style={{ gap: "0.5rem", marginTop: "0.4rem" }}>
          <button
            className="link-btn"
            onClick={() => { if (text.trim()) onEdit(text.trim()); setEditing(false); }}
          >
            Save
          </button>
          <button className="link-btn" onClick={() => { setEditing(false); setText(content); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="msg-actions">
      <button onClick={onReply} aria-label="Reply to this message">reply</button>
      <button onClick={() => { setText(content); setEditing(true); }} aria-label="Edit message">edit</button>
      <button onClick={onDelete} aria-label="Delete message">delete</button>
      <button
        onClick={() => {
          if (confirm("Delete this message and everything after it?")) onDeleteFrom();
        }}
        aria-label="Delete this message and everything after it"
      >
        from here
      </button>
    </span>
  );
}
