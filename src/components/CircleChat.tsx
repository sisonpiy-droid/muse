"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { REGISTERS, hasFeelings, splitBurst } from "@/lib/presence/persona";
import type { Update } from "@/app/solo/page";
import {
  deleteFrom, deleteMessage, editMessage, feelingsOf, membersOf, newMessage,
  type SoloCircle, type SoloMessage, type SoloMuse, type SoloState,
} from "@/lib/solo/store";
import { MessageActions } from "./MessageActions";

/* A circle: several people in one conversation.
 *
 * Who speaks is decided here rather than by the model. Asking a model "who
 * should reply?" costs an extra call and it answers "everyone", which is how
 * group chats in these products end up as four assistants taking turns
 * answering the same question.
 *
 * So: one or two people reply to any given message, chosen by who was
 * addressed by name, then who has been quietest. It is a crude rule and it
 * reads far better than everyone piling in.
 */

export function CircleChat({
  circle, state, update, onBack,
}: {
  circle: SoloCircle;
  state: SoloState;
  update: Update;
  onBack: () => void;
}) {
  const members = membersOf(state, circle);
  const log = state.conversations[circle.id] ?? [];
  const [draft, setDraft] = useState("");
  const [speaking, setSpeaking] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length, speaking]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || members.length < 2) return;

    setBusy(true);
    setError(null);
    setDraft("");
    if (box.current) box.current.style.height = "auto";

    let running: SoloMessage[] = [...log, newMessage("user", content)];
    /* Written against whatever is current rather than the snapshot this turn
       opened with. A circle turn runs several speakers back to back and can take
       half a minute, and anything committed elsewhere in that window -- a memory
       landing, an edit -- was being overwritten by a stale copy. */
    const commit = (msgs: SoloMessage[]) =>
      update((cur) => ({ ...cur, conversations: { ...cur.conversations, [circle.id]: msgs } }));

    commit(running);

    const speakers = chooseSpeakers(members, content, running);

    for (const m of speakers) {
      if (!m.persona) continue;
      let acc = "";
      try {
        const res = await fetch("/api/solo/circle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            circleName: circle.name,
            speaker: { id: m.id, persona: { ...m.persona, you: m.persona.you || state.userName || "them" } },
            /* Capped to what the route accepts. Circles built before the
               limit existed can be larger, and sending the full roster would
               reject every turn forever rather than just crowding the room. */
            others: members
              .filter((o) => o.id !== m.id)
              .slice(0, 7)
              .map((o) => ({ id: o.id, name: o.name, relationship: o.relationshipType })),
            /* The whole room's transcript, including what anyone said earlier
               in this same turn -- so the second speaker is replying to the
               first rather than to the same message twice. */
            log: running.slice(-40).map((x) => ({
              from: x.from, speakerId: x.speakerId, content: x.content.slice(0, 8000),
            })),
            names: Object.fromEntries(members.map((o) => [o.id, o.name])),
            userName: state.userName,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            register: "texts",
            /* Each speaker brings their own standing state into the room. One
               person can be having a bad month while everyone else is fine,
               which is most group chats. */
            feelings: hasFeelings(feelingsOf(state, m.id)) ? feelingsOf(state, m.id) : null,
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Something went wrong. Try again.");
          break;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split(/\r?\n/).find((l) => l.startsWith("data:"));
            if (!line) continue;
            let evt: { type?: string; text?: string; message?: string };
            try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (evt.type === "delta" && evt.text) {
              acc += evt.text;
              setSpeaking({ name: m.name, text: acc });
            } else if (evt.type === "error") {
              setError(evt.message ?? "Something went wrong.");
            }
          }
        }

        const said = acc.trim();
        setSpeaking(null);
        if (said) {
          const parts = splitBurst(said, REGISTERS.texts.burst);
          running = [
            ...running,
            ...parts.map((c) => newMessage("muse", c, m.id)),
          ];
          commit(running);
        }
      } catch {
        setError("You're offline.");
        break;
      }
    }

    setSpeaking(null);
    setBusy(false);
  }

  return (
    <main className="shell" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="chat-head">
        <button className="link-btn" onClick={onBack} aria-label="Back" style={{ textDecoration: "none" }}>←</button>
        <div className="stack-avatars">
          {members.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} />)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1>{circle.name}</h1>
          <div className="rel">{members.map((m) => m.name).join(", ")}</div>
        </div>
      </header>

      <div className="thread" role="log" aria-live="polite" aria-label={`Conversation in ${circle.name}`}>
        {log.length === 0 && (
          <div className="empty" style={{ marginTop: "2rem" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>
              {members.map((m) => m.name).join(", ")} are all here.
            </p>
            <p className="fine">
              They know each other. Say something, or name one of them to talk to them directly.
            </p>
          </div>
        )}

        {log.map((m) => (
          <div key={m.id} className={m.from === "user" ? "turn turn-user" : "turn turn-muse"}>
            {m.from === "muse" && (
              <span className="who">{nameOf(m.speakerId ?? "")}</span>
            )}
            {m.content}
            {m.edited && <span className="stamp"> · edited</span>}
            <MessageActions
              content={m.content}
              onEdit={(text) => update(editMessage(state, circle.id, m.id, text))}
              onDelete={() => update(deleteMessage(state, circle.id, m.id))}
              onDeleteFrom={() => update(deleteFrom(state, circle.id, m.id))}
            />
          </div>
        ))}

        {speaking && (
          <div className="turn turn-muse">
            <span className="who">{speaking.name}</span>
            {speaking.text}
          </div>
        )}
        {busy && !speaking && <p className="typing">someone is typing<i>.</i><i>.</i><i>.</i></p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div ref={foot} />
      </div>

      <div className="composer">
        <label className="sr-only" htmlFor="circle-composer">Write to {circle.name}</label>
        <textarea
          id="circle-composer"
          ref={box}
          rows={1}
          value={draft}
          placeholder={`Write to ${circle.name}`}
          onChange={(e) => {
            setDraft(e.target.value);
            const el = box.current;
            if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); }
          }}
        />
        <button className="send" onClick={() => send(draft)} disabled={busy || !draft.trim()}>Send</button>
      </div>
    </main>
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Who replies to this message. Named people first, then whoever has been
 *  quietest, capped at two so the room does not shout. Outside the component
 *  so the Math.random() below is not something the compiler has to reason
 *  about for render. */
function chooseSpeakers(members: SoloMuse[], text: string, recent: SoloMessage[]): SoloMuse[] {
  const named = members.filter((m) => new RegExp(`\\b${escapeRe(m.name)}\\b`, "i").test(text));
  if (named.length) return named.slice(0, 2);

  const lastSpokeAt = new Map<string, number>();
  recent.forEach((m, i) => { if (m.speakerId) lastSpokeAt.set(m.speakerId, i); });
  const quietestFirst = [...members].sort(
    (a, b) => (lastSpokeAt.get(a.id) ?? -1) - (lastSpokeAt.get(b.id) ?? -1)
  );
  // Two most of the time, one sometimes, so the rhythm is not mechanical.
  return quietestFirst.slice(0, Math.random() < 0.35 ? 1 : 2);
}
