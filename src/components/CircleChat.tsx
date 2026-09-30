"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { QuoteBubble, ReplyBar, jumpTo } from "@/components/Quote";
import { TraitEditor } from "@/components/TraitEditor";
import { useReplyLoop } from "@/components/useReplyLoop";
import { REGISTERS, hasFeelings, splitBurst } from "@/lib/presence/persona";
import type { Update } from "@/app/solo/page";
import {
  QUOTE_CHARS, circleOf, deleteFrom, deleteMessage, editCircle, editMessage, editMuse, feelingsOf,
  insertAfter, membersOf, newMessage, promptPersona, quoteOf, rewindTo,
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
 * So: one or two people reply to any given message, chosen by who was replied
 * to or addressed by name, then who has been quietest. It is a crude rule and
 * it reads far better than everyone piling in.
 */

/** One-tap ideas for what the room is about and what it is like. */
const TOPIC_IDEAS = ["Planning a trip", "Weekend plans", "Gossip", "Something that happened at work", "Old memories"];
const ROOM_IDEAS = ["chaotic", "roasting each other", "supportive", "nostalgic", "gossipy", "late-night", "competitive"];
const TRAIT_IDEAS = ["funny", "sarcastic", "caring", "blunt", "chill", "dramatic", "nosy", "savage"];

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
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<SoloMessage | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /* Read when a turn starts, not when it was scheduled -- see SoloChat. */
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });

  const loop = useReplyLoop(turn);

  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length, speaking]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
  const whoSaid = (m: SoloMessage) => (m.from === "user" ? "You" : nameOf(m.speakerId ?? ""));

  function sendDraft() {
    const content = draft.trim();
    if (!content || members.length < 2) return;
    const msg = newMessage("user", content, { replyTo: replyTo?.id });
    update((cur) => ({
      ...cur,
      conversations: { ...cur.conversations, [circle.id]: [...(cur.conversations[circle.id] ?? []), msg] },
    }));
    setDraft("");
    setReplyTo(null);
    setError(null);
    if (box.current) box.current.style.height = "auto";
    loop.schedule();
  }

  /* One round of the room, answering everything the user has said since anyone
     last spoke -- one message or several. */
  async function turn(signal: AbortSignal) {
    const s = latest.current;
    const room = circleOf(s, circle.id) ?? circle;
    const people = membersOf(s, room);
    let running = s.conversations[room.id] ?? [];
    const last = running[running.length - 1];
    if (!last || last.from !== "user" || people.length < 2) return;

    setError(null);

    const unanswered: SoloMessage[] = [];
    for (let i = running.length - 1; i >= 0 && running[i].from === "user"; i--) unanswered.unshift(running[i]);
    /* Replying to someone's line is addressing them, as surely as naming them. */
    const repliedTo = unanswered
      .map((m) => quoteOf(running, m))
      .filter((q): q is SoloMessage => Boolean(q && q.from === "muse" && q.speakerId))
      .map((q) => q.speakerId as string);
    const speakers = chooseSpeakers(people, unanswered.map((m) => m.content).join("\n"), running, repliedTo);

    let anchor = last.id;
    for (const m of speakers) {
      const persona = promptPersona(m, s.userName);
      if (!persona || signal.aborted) continue;
      let acc = "";
      try {
        const res = await fetch("/api/solo/circle", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            circleName: room.name,
            speaker: { id: m.id, persona },
            /* Capped to what the route accepts. Circles built before the
               limit existed can be larger, and sending the full roster would
               reject every turn forever rather than just crowding the room. */
            others: people
              .filter((o) => o.id !== m.id)
              .slice(0, 7)
              .map((o) => ({
                id: o.id,
                name: o.name,
                relationship: o.relationshipType,
                traits: (o.traits ?? []).slice(0, 8),
              })),
            /* The whole room's transcript, including what anyone said earlier
               in this same turn -- so the second speaker is replying to the
               first rather than to the same message twice. */
            log: running.slice(-40).map((x) => {
              const q = quoteOf(running, x);
              return {
                from: x.from,
                speakerId: x.speakerId,
                content: x.content.slice(0, 8000),
                ...(q ? { quote: { from: q.from, speakerId: q.speakerId, content: q.content.slice(0, QUOTE_CHARS) } } : {}),
              };
            }),
            names: Object.fromEntries(people.map((o) => [o.id, o.name])),
            userName: s.userName,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            register: "texts",
            topic: room.topic?.trim() || undefined,
            roomTraits: room.traits?.length ? room.traits.slice(0, 8) : undefined,
            /* Each speaker brings their own standing state into the room. One
               person can be having a bad month while everyone else is fine,
               which is most group chats. */
            feelings: hasFeelings(feelingsOf(s, m.id)) ? feelingsOf(s, m.id) : null,
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
        let broke = false;
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
              broke = true;
              setError(evt.message ?? "Something went wrong.");
            }
          }
        }

        setSpeaking(null);
        if (signal.aborted) return;
        /* Half a line is not a line. The room moves on without it. */
        const said = broke ? "" : acc.trim();
        if (said) {
          const parts = splitBurst(said, REGISTERS.texts.burst).map((c) => newMessage("muse", c, { speakerId: m.id }));
          running = [...running, ...parts];
          /* After the line they were answering, not at the end: anything the
             user sent meanwhile stays last and gets its own turn. */
          update((cur) => insertAfter(cur, room.id, anchor, parts));
          anchor = parts[parts.length - 1].id;
        }
      } catch {
        setSpeaking(null);
        if (!signal.aborted) setError("You're offline.");
        break;
      }
    }
    setSpeaking(null);
  }

  /* Same rule as one to one: an edit to your latest message redoes the room's
     answer to it, further up it asks first. */
  function editLine(m: SoloMessage, text: string) {
    const at = log.findIndex((x) => x.id === m.id);
    const after = log.slice(at + 1);
    const redo =
      m.from === "user" &&
      (!after.some((x) => x.from === "user") ||
        confirm(
          `Redo the conversation from this message?\n\nOK takes the room back to here and they answer the new version. The ${after.length} messages after it are removed.\n\nCancel just changes the text.`
        ));
    if (redo) {
      update((cur) => rewindTo(editMessage(cur, circle.id, m.id, text), circle.id, m.id));
      setError(null);
      loop.restart();
      return;
    }
    update((cur) => editMessage(cur, circle.id, m.id, text));
  }

  const topic = circle.topic?.trim() ?? "";
  const roomTraits = circle.traits ?? [];
  const summary = [topic && `about ${topic}`, roomTraits.length ? roomTraits.join(", ") : ""]
    .filter(Boolean)
    .join(" · ") || "nothing set";

  return (
    <main className="shell" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="chat-head">
        <button className="link-btn" onClick={onBack} aria-label="Back" style={{ textDecoration: "none" }}>←</button>
        <div className="stack-avatars">
          {members.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} />)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1>{circle.name}</h1>
          <div className="rel">
            {members.map((m) => m.name).join(", ")}
            {topic && <span style={{ color: "var(--accent)" }}> · about {topic}</span>}
          </div>
        </div>
      </header>

      <div className="thread" role="log" aria-live="polite" aria-label={`Conversation in ${circle.name}`}>
        {log.length === 0 && (
          <div className="empty" style={{ marginTop: "2rem" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>
              {members.map((m) => m.name).join(", ")} are all here.
            </p>
            <p className="fine">
              They know each other. Say something, name one of them, or reply to one of their
              messages to talk to them directly.
            </p>
          </div>
        )}

        {log.map((m) => {
          const q = quoteOf(log, m);
          return (
            <div key={m.id} id={`msg-${m.id}`} className={m.from === "user" ? "turn turn-user" : "turn turn-muse"}>
              {m.from === "muse" && <span className="who">{nameOf(m.speakerId ?? "")}</span>}
              {m.replyTo && (
                <QuoteBubble who={q ? whoSaid(q) : ""} text={q?.content} onJump={q ? () => jumpTo(q.id) : undefined} />
              )}
              {m.content}
              {m.edited && <span className="stamp"> · edited</span>}
              <MessageActions
                content={m.content}
                onReply={() => { setReplyTo(m); box.current?.focus(); }}
                onEdit={(text) => editLine(m, text)}
                onDelete={() => update(deleteMessage(state, circle.id, m.id))}
                onDeleteFrom={() => update(deleteFrom(state, circle.id, m.id))}
              />
            </div>
          );
        })}

        {speaking && (
          <div className="turn turn-muse">
            <span className="who">{speaking.name}</span>
            {speaking.text}
          </div>
        )}
        {loop.busy && !speaking && <p className="typing">someone is typing<i>.</i><i>.</i><i>.</i></p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div ref={foot} />
      </div>

      <div className="vibe">
        <button onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
          <span>{panelOpen ? "Close" : "Change how this goes"}</span>
          <b>{summary}</b>
        </button>

        {panelOpen && (
          <div className="vibe-panel">
            <div>
              <label htmlFor="circle-topic">What do you want to talk about?</label>
              <input
                id="circle-topic"
                className="input"
                value={circle.topic ?? ""}
                maxLength={200}
                placeholder="Planning Goa, or roasting Kabir's new haircut"
                onChange={(e) => update((cur) => editCircle(cur, circle.id, { topic: e.target.value }))}
              />
              <div className="tags">
                {TOPIC_IDEAS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="tag"
                    aria-pressed={topic === t}
                    onClick={() => update((cur) => editCircle(cur, circle.id, { topic: topic === t ? "" : t }))}
                    style={topic === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label>What is the group like together?</label>
              <TraitEditor
                traits={roomTraits}
                onChange={(traits) => update((cur) => editCircle(cur, circle.id, { traits }))}
                suggestions={ROOM_IDEAS}
                label="Add something about the group"
              />
            </div>

            <div>
              <label>Each of them</label>
              {members.map((m) => (
                <div key={m.id} className="member-traits">
                  <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                    <Avatar name={m.name} />
                    <b>{m.name}</b>
                  </div>
                  <TraitEditor
                    traits={m.traits ?? []}
                    onChange={(traits) => update((cur) => editMuse(cur, m.id, { traits }))}
                    suggestions={TRAIT_IDEAS}
                    label={`Add a trait for ${m.name}`}
                  />
                </div>
              ))}
              <p className="fine">
                A person&rsquo;s traits are theirs everywhere, one to one as well as in here. The
                group&rsquo;s are only for this room.
              </p>
            </div>

            <p className="fine">
              <strong style={{ color: "var(--accent)" }}>Applies from your next message.</strong>
            </p>
          </div>
        )}
      </div>

      <div className="composer">
        {replyTo && (
          <ReplyBar
            who={replyTo.from === "user" ? "yourself" : nameOf(replyTo.speakerId ?? "")}
            text={replyTo.content}
            onCancel={() => setReplyTo(null)}
          />
        )}
        <label className="sr-only" htmlFor="circle-composer">Write to {circle.name}</label>
        <textarea
          id="circle-composer"
          ref={box}
          rows={1}
          value={draft}
          placeholder={`Write to ${circle.name}`}
          onChange={(e) => {
            setDraft(e.target.value);
            loop.hold();
            const el = box.current;
            if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDraft(); }
            if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
        />
        <button className="send" onClick={sendDraft} disabled={!draft.trim()}>Send</button>
      </div>
    </main>
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Who replies. Whoever was replied to or named first, then whoever has been
 *  quietest, capped at two so the room does not shout. Outside the component
 *  so the Math.random() below is not something the compiler has to reason
 *  about for render. */
function chooseSpeakers(
  members: SoloMuse[],
  text: string,
  recent: SoloMessage[],
  repliedTo: string[] = []
): SoloMuse[] {
  const addressed = members.filter(
    (m) => repliedTo.includes(m.id) || new RegExp(`\\b${escapeRe(m.name)}\\b`, "i").test(text)
  );
  if (addressed.length) return addressed.slice(0, 2);

  const lastSpokeAt = new Map<string, number>();
  recent.forEach((m, i) => { if (m.speakerId) lastSpokeAt.set(m.speakerId, i); });
  const quietestFirst = [...members].sort(
    (a, b) => (lastSpokeAt.get(a.id) ?? -1) - (lastSpokeAt.get(b.id) ?? -1)
  );
  // Two most of the time, one sometimes, so the rhythm is not mechanical.
  return quietestFirst.slice(0, Math.random() < 0.35 ? 1 : 2);
}
