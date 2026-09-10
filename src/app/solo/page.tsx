"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { CircleChat } from "@/components/CircleChat";
import { ImportPersona } from "@/components/ImportPersona";
import { MessageActions } from "@/components/MessageActions";
import {
  DEFAULT_VIBE, MOODS, REGISTERS, TOPICS, splitBurst, vibeSummary, type Vibe,
} from "@/lib/presence/persona";
import { safeFilename, transcriptMarkdown } from "@/lib/export";
import {
  addMemories, builtinMuses, circleOf, deleteCircle, deleteConversation, deleteFrom,
  deleteMessage, deleteMuse, download, editMessage,
  findMuse, knownTo, loadState, membersOf, relevantMemories, saveState,
  type SoloCircle, type SoloMessage, type SoloMuse, type SoloState,
} from "@/lib/solo/store";

/* Solo MUSE — the whole product with no database and no account.
 *
 * Everything lives in this browser: the conversations, the memories, the
 * relationship. One server function does the model call, because the API key
 * must not be shipped to the client (§50).
 *
 * What this trades away is real: no accounts, so no second device and no way to
 * recover a cleared browser. What it keeps is the thing the product is for —
 * personalities that remember you and get more personal as you talk.
 */

type View =
  | { kind: "home" }
  | { kind: "chat"; museId: string }
  | { kind: "import" }
  | { kind: "circle"; circleId: string }
  | { kind: "new-circle" };

export default function SoloPage() {
  const [state, setState] = useState<SoloState | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });

  useEffect(() => { setState(loadState()); }, []);

  function update(next: SoloState) {
    setState(next);
    saveState(next);
  }

  // Nothing renders until localStorage has been read, so the first paint is
  // never a wrong empty state that flips a tick later.
  if (!state) return <main className="shell" />;

  if (view.kind === "import") {
    return (
      <ImportPersona
        onCancel={() => setView({ kind: "home" })}
        onCreate={(draft) => {
          const id = `made-${Date.now()}`;
          /* The card fields are only for display; everything the model reads
             comes from `persona`, which is Presence's whole profile. */
          update({
            ...state,
            userName: state.userName ?? draft.you,
            muses: [
              {
                id,
                builtin: false,
                persona: draft,
                name: draft.them,
                description: draft.relationship?.trim() || "Built from their messages.",
                relationshipType: draft.relationship?.trim() || "someone close",
                category: "Personal",
                traits: [],
              },
              ...state.muses,
            ],
          });
          setView({ kind: "chat", museId: id });
        }}
      />
    );
  }

  if (view.kind === "circle") {
    const circle = circleOf(state, view.circleId);
    if (!circle) { setView({ kind: "home" }); return null; }
    return (
      <CircleChat circle={circle} state={state} update={update} onBack={() => setView({ kind: "home" })} />
    );
  }

  if (view.kind === "new-circle") {
    return (
      <NewCircle
        state={state}
        onCancel={() => setView({ kind: "home" })}
        onCreate={(name, memberIds) => {
          const id = `circle-${Date.now()}`;
          update({
            ...state,
            circles: [
              { id, name, memberIds, createdAt: new Date().toISOString() },
              ...(state.circles ?? []),
            ],
          });
          setView({ kind: "circle", circleId: id });
        }}
      />
    );
  }

  if (view.kind === "chat") {
    const muse = findMuse(state, view.museId);
    if (!muse) { setView({ kind: "home" }); return null; }
    return (
      <SoloChat
        muse={muse}
        state={state}
        update={update}
        onBack={() => setView({ kind: "home" })}
      />
    );
  }

  return (
    <SoloHome
      state={state}
      update={update}
      onOpen={(id) => setView({ kind: "chat", museId: id })}
      onImport={() => setView({ kind: "import" })}
      onOpenCircle={(id) => setView({ kind: "circle", circleId: id })}
      onNewCircle={() => setView({ kind: "new-circle" })}
    />
  );
}

/* ------------------------------------------------------------------ home */

function SoloHome({
  state, update, onOpen, onImport, onOpenCircle, onNewCircle,
}: {
  state: SoloState;
  update: (s: SoloState) => void;
  onOpen: (id: string) => void;
  onImport: () => void;
  onOpenCircle: (id: string) => void;
  onNewCircle: () => void;
}) {
  const [name, setName] = useState(state.userName ?? "");
  const muses = [...state.muses, ...builtinMuses()];

  const talked = muses
    .filter((m) => (state.conversations[m.id]?.length ?? 0) > 0)
    .sort((a, b) => lastAt(state, b.id) - lastAt(state, a.id));
  const rest = muses.filter((m) => !(state.conversations[m.id]?.length ?? 0));

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <p className="mark">Muse</p>
        <span className="fine">no account · this browser only</span>
      </header>

      {!state.userName && (
        <div style={{ marginTop: "2rem" }}>
          <h1 className="display">Who do you want<br />to talk to?</h1>
          <p className="lede">
            Build someone from a real chat export, or start with one of four already here. They
            remember what you tell them, and everything stays in this browser.
          </p>
          <div className="row" style={{ maxWidth: "22rem" }}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should they call you?"
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) update({ ...state, userName: name.trim() }); }}
            />
            <button className="btn" disabled={!name.trim()} onClick={() => update({ ...state, userName: name.trim() })}>
              Start
            </button>
          </div>
        </div>
      )}

      {state.userName && (
        <>
          <h2 className="section-title">Build someone real</h2>
          <button className="muse-card" onClick={onImport} style={{ borderStyle: "dashed" }}>
            <div style={{ minWidth: 0 }}>
              <h3>From a chat export</h3>
              <p>
                Upload a WhatsApp export and MUSE reads how they actually wrote — length,
                punctuation, the habits nobody can describe.
              </p>
            </div>
          </button>

          {talked.length > 0 && (
            <>
              <h2 className="section-title">Continue talking</h2>
              <div className="card-grid">
                {talked.map((m) => (
                  <MuseCard key={m.id} muse={m} state={state} update={update} onOpen={onOpen} />
                ))}
              </div>
            </>
          )}

          <h2 className="section-title">Circles</h2>
          <div className="card-grid">
            {(state.circles ?? []).map((c) => (
              <button key={c.id} className="muse-card" onClick={() => onOpenCircle(c.id)}>
                <div className="stack-avatars">
                  {membersOf(state, c).slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} />)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{c.name}</h3>
                  <span className="rel">{membersOf(state, c).map((m) => m.name).join(", ")}</span>
                  <p>{(state.conversations[c.id]?.length ?? 0)} messages</p>
                </div>
              </button>
            ))}
            {(state.circles ?? []).length > 0 && (
              <div className="card-actions">
                {(state.circles ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (confirm(`Delete the circle "${c.name}" and its conversation? The people in it are kept.`)) {
                        update(deleteCircle(state, c.id));
                      }
                    }}
                  >
                    delete {c.name}
                  </button>
                ))}
              </div>
            )}
            <button className="muse-card" onClick={onNewCircle} style={{ borderStyle: "dashed" }}>
              <div style={{ minWidth: 0 }}>
                <h3>Put people in a room together</h3>
                <p>
                  Pick two or more. They will know each other, talk to each other, and take sides.
                </p>
              </div>
            </button>
          </div>

          <h2 className="section-title">Or start with someone here</h2>
          <div className="card-grid">
            {rest.map((m) => (
              <MuseCard key={m.id} muse={m} state={state} update={update} onOpen={onOpen} />
            ))}
          </div>

          <div className="row" style={{ marginTop: "2.5rem", gap: "0.75rem" }}>
            <button
              className="btn-ghost"
              onClick={() => download(
                safeFilename("muse-solo", "json"),
                JSON.stringify(state, null, 2),
                "application/json"
              )}
            >
              Export everything
            </button>
            <button
              className="link-btn"
              onClick={() => {
                if (!confirm("Delete every conversation and memory in this browser? This cannot be undone.")) return;
                update({ userName: state.userName, muses: [], conversations: {}, memories: [] });
              }}
            >
              Delete everything
            </button>
          </div>
        </>
      )}

      <p className="fine" style={{ marginTop: "2.5rem" }}>
        Every Muse is an AI. Nothing is stored on a server — clearing this browser&apos;s data deletes
        it all, and there is no way to get it back.
      </p>
    </main>
  );
}

function MuseCard({
  muse, state, update, onOpen,
}: { muse: SoloMuse; state: SoloState; update: (s: SoloState) => void; onOpen: (id: string) => void }) {
  const log = state.conversations[muse.id] ?? [];
  const last = log[log.length - 1];
  const remembered = state.memories.filter((m) => m.museId === muse.id).length;
  const hasThread = log.length > 0;

  return (
    <div className="card-wrap">
    <button className="muse-card" onClick={() => onOpen(muse.id)}>
      <Avatar name={muse.name} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: "0.5rem", justifyContent: "space-between" }}>
          <h3>{muse.name}</h3>
          {remembered > 0 && (
            <span className="stamp">remembers {remembered}</span>
          )}
        </div>
        <span className="rel">{muse.relationshipType}</span>
        <p style={last ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}>
          {last ? `${last.from === "user" ? "You: " : ""}${last.content}` : muse.description}
        </p>
        {!last && muse.traits?.length ? (
          <div className="tags">
            {muse.traits.slice(0, 4).map((t) => <span className="tag" key={t}>{t}</span>)}
          </div>
        ) : null}
      </div>
    </button>

    {/* Outside the card button — a delete control nested inside a button is
        not clickable, and screen readers announce it as one control. */}
    <div className="card-actions">
      {hasThread && (
        <button
          onClick={() => {
            if (!confirm(`Delete your conversation with ${muse.name}?

OK also forgets what they learned. Cancel keeps the memories.`)) {
              if (confirm(`Delete the conversation but keep what ${muse.name} remembers?`)) {
                update(deleteConversation(state, muse.id, false));
              }
              return;
            }
            update(deleteConversation(state, muse.id, true));
          }}
        >
          delete chat
        </button>
      )}
      {!muse.builtin && (
        <button
          onClick={() => {
            if (confirm(`Delete ${muse.name} completely? Their conversation and everything they remember goes too.`)) {
              update(deleteMuse(state, muse.id));
            }
          }}
        >
          delete {muse.name}
        </button>
      )}
    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chat */

function SoloChat({
  muse, state, update, onBack,
}: { muse: SoloMuse; state: SoloState; update: (s: SoloState) => void; onBack: () => void }) {
  const log = state.conversations[muse.id] ?? [];
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [vibeOpen, setVibeOpen] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const vibe: Vibe = state.vibes?.[muse.id] ?? DEFAULT_VIBE;
  const setVibe = (next: Vibe) =>
    update({ ...state, vibes: { ...(state.vibes ?? {}), [muse.id]: next } });

  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length, streaming]);

  const memoriesFor = state.memories.filter((m) => m.museId === muse.id);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    setBusy(true);
    setError(null);
    setDraft("");
    setLastSent(content);
    if (box.current) box.current.style.height = "auto";

    const withUser: SoloMessage[] = [
      ...log,
      { id: `u-${Date.now()}`, from: "user", content, at: new Date().toISOString() },
    ];
    let next: SoloState = { ...state, conversations: { ...state.conversations, [muse.id]: withUser } };
    update(next);

    // The last few turns plus the new message, so retrieval follows the subject
    // rather than a two-word reply carrying no signal.
    const query = [...withUser.slice(-4).map((m) => m.content)].join("\n");
    const memories = relevantMemories(state, muse.id, query);

    let acc = "";
    try {
      const res = await fetch("/api/solo/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          muse: {
            name: muse.name,
            description: muse.description,
            relationshipType: muse.relationshipType,
            languages: muse.languages ?? ["English"],
            personality: {
              traits: muse.traits ?? [],
              values: muse.values, humour: muse.humour, emotionalStyle: muse.emotionalStyle,
              opinions: muse.opinions, customInstructions: muse.customInstructions,
              tone: muse.tone, formality: muse.formality, sentenceLength: muse.sentenceLength,
              catchphrases: muse.catchphrases, dialect: muse.dialect,
            },
          },
          // Bounded window, same reason as the server app (§9).
          messages: withUser.slice(-20).map((m) => ({
            role: m.from === "user" ? ("user" as const) : ("assistant" as const),
            content: m.content,
          })),
          /* Present only for someone built from real material. When it is, the
             server ignores the simple shape above and uses Presence's prompt. */
          /* `you` is filled here rather than stored: the starters are authored
             without knowing who will read them, and a built character should
             follow a rename too. */
          persona: muse.persona
            ? { ...muse.persona, you: muse.persona.you || state.userName || "them" }
            : null,
          /* Everyone they share a circle with. Being in a circle should mean
             they know those people exist in here too, not only in the group. */
          knows: knownTo(state, muse.id).map((k) => ({
            name: k.name,
            relationship: k.relationshipType,
          })),
          mood: vibe.mood,
          topic: vibe.topic,
          register: vibe.register,
          memories,
          userName: state.userName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
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
          if (evt.type === "delta" && evt.text) { acc += evt.text; setStreaming(acc); }
          else if (evt.type === "error") setError(evt.message ?? "Something went wrong.");
        }
      }

      const reply = acc.trim();
      if (reply) {
        /* Presence tells a texting persona to send several short messages
           separated by a line of ---, because that is how people actually text.
           Splitting them here is what makes that instruction mean anything;
           without it the separator just shows up in the message. */
        /* Only the registers that ask for several messages get split. A letter
           or a voice note is one piece by definition, and splitting it would
           contradict the instruction the model was just given. */
        const reg = REGISTERS[vibe.register as keyof typeof REGISTERS] ?? REGISTERS.texts;
        const burst = muse.persona ? splitBurst(reply, reg.burst) : [reply];
        const withMuse: SoloMessage[] = [
          ...withUser,
          ...burst.map((content, i) => ({
            id: `m-${Date.now()}-${i}`,
            from: "muse" as const,
            content,
            at: new Date().toISOString(),
          })),
        ];
        next = { ...state, conversations: { ...state.conversations, [muse.id]: withMuse } };
        update(next);
        setStreaming("");

        /* Extraction runs after the reply is on screen and never blocks it, the
           same shape as the server app's aftercare. */
        void (async () => {
          try {
            const r = await fetch("/api/solo/remember", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                messages: withMuse.slice(-8).map((m) => ({
                  role: m.from === "user" ? "user" : "assistant",
                  content: m.content,
                })),
                known: memoriesFor.map((m) => m.content),
              }),
            });
            const { memories: found } = await r.json();
            if (Array.isArray(found) && found.length) {
              update(addMemories(next, muse.id, found));
            }
          } catch { /* a missed memory is not worth an error banner */ }
        })();
      }
    } catch {
      setError("You're offline.");
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }

  function exportChat() {
    download(
      safeFilename(muse.name, "md"),
      transcriptMarkdown({
        museName: muse.name,
        relationshipType: muse.relationshipType,
        userName: state.userName,
        messages: log.map((m) => ({
          senderType: m.from === "user" ? "USER" : "MUSE",
          content: m.content,
          createdAt: new Date(m.at),
        })),
      }),
      "text/markdown"
    );
  }

  function exportPersona() {
    download(
      safeFilename(`${muse.name}-persona`, "json"),
      JSON.stringify({ format: "muse.persona/1", exportedAt: new Date().toISOString(), muse }, null, 2),
      "application/json"
    );
  }

  return (
    <main className="shell" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="chat-head">
        <button className="link-btn" onClick={onBack} aria-label="Back" style={{ textDecoration: "none" }}>←</button>
        <Avatar name={muse.name} />
        <div style={{ minWidth: 0 }}>
          <h1>{muse.name}</h1>
          <div className="rel">
            {muse.relationshipType}
            {memoriesFor.length > 0 && ` · remembers ${memoriesFor.length}`}
            {isDefaultVibe(vibe) ? null : (
              <span style={{ color: "var(--accent)" }}> · {vibeSummary(vibe)}</span>
            )}
          </div>
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: "0.5rem" }}>
          <button className="link-btn" onClick={exportChat} disabled={!log.length} title="Export conversation">chat ↓</button>
          <button className="link-btn" onClick={exportPersona} title="Export persona">persona ↓</button>
        </div>
      </header>

      <div className="thread" role="log" aria-live="polite" aria-label={`Conversation with ${muse.name}`}>
        {log.length === 0 && !streaming && (
          <div className="empty" style={{ marginTop: "2rem" }}>
            <p style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>{muse.description}</p>
            <p className="fine">Say anything. {muse.name} will remember it next time.</p>
          </div>
        )}

        {log.map((m) => (
          <div key={m.id} className={m.from === "user" ? "turn turn-user" : "turn turn-muse"}>
            {m.content}
            {m.edited && <span className="stamp"> · edited</span>}
            <MessageActions
              content={m.content}
              onEdit={(text) => update(editMessage(state, muse.id, m.id, text))}
              onDelete={() => update(deleteMessage(state, muse.id, m.id))}
              onDeleteFrom={() => update(deleteFrom(state, muse.id, m.id))}
            />
          </div>
        ))}

        {streaming && <div className="turn turn-muse">{streaming}</div>}
        {busy && !streaming && <p className="typing">{muse.name} is typing<i>.</i><i>.</i><i>.</i></p>}

        {error && (
          <div style={{ marginTop: "1rem" }}>
            <p className="error" role="alert">{error}</p>
            {lastSent && <button className="link-btn" onClick={() => send(lastSent)}>Try again</button>}
          </div>
        )}

        <div ref={foot} />
      </div>

      {muse.persona && (
        <div className="vibe">
          <button onClick={() => setVibeOpen(!vibeOpen)} aria-expanded={vibeOpen}>
            <span>{vibeOpen ? "Close" : "Change how this goes"}</span>
            <b>{vibeSummary(vibe)}</b>
          </button>

          {vibeOpen && (
            <div className="vibe-panel">
              <div>
                <label>What mood is {muse.name} in?</label>
                <div className="tags">
                  {Object.entries(MOODS).map(([k, v]) => (
                    <button key={k} className="tag" aria-pressed={vibe.mood === k}
                      onClick={() => setVibe({ ...vibe, mood: k })}
                      style={vibe.mood === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label>What do you want to talk about?</label>
                <div className="tags">
                  {Object.entries(TOPICS).map(([k, v]) => (
                    <button key={k} className="tag" aria-pressed={vibe.topic === k}
                      onClick={() => setVibe({ ...vibe, topic: k })}
                      style={vibe.topic === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label>How are you talking?</label>
                <div className="tags">
                  {Object.entries(REGISTERS).map(([k, v]) => (
                    <button key={k} className="tag" aria-pressed={vibe.register === k}
                      onClick={() => setVibe({ ...vibe, register: k })}
                      style={vibe.register === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="fine">
                <strong style={{ color: "var(--accent)" }}>
                  {isDefaultVibe(vibe)
                    ? "Nothing set — they will be however they are."
                    : `From your next message: ${vibeSummary(vibe)}.`}
                </strong>{" "}
                Mood suits a person having a day; if you find yourself reaching for it constantly,
                leave it on &ldquo;however they are&rdquo; and let it land where it lands.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="composer">
        <label className="sr-only" htmlFor="solo-composer">Write to {muse.name}</label>
        <textarea
          id="solo-composer"
          ref={box}
          rows={1}
          value={draft}
          placeholder={`Write to ${muse.name}`}
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

/* ---------------------------------------------------------------- helpers */


/* ---------------------------------------------------------- new circle */

function NewCircle({
  state, onCancel, onCreate,
}: {
  state: SoloState;
  onCancel: () => void;
  onCreate: (name: string, memberIds: string[]) => void;
}) {
  const everyone = [...state.muses, ...builtinMuses()];
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");

  /* Only people with a full profile can be in a circle. A Muse without one has
     no archetype or samples for the group prompt to work from, and would be the
     one flat voice in the room. */
  const eligible = everyone.filter((m) => m.persona);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const suggested = picked.length
    ? picked.map((id) => eligible.find((m) => m.id === id)?.name).filter(Boolean).join(" & ")
    : "";

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <p className="mark">New circle</p>
        <button className="link-btn" onClick={onCancel}>Cancel</button>
      </header>

      <h1 className="display" style={{ fontSize: "1.9rem" }}>Who knows who?</h1>
      <p className="lede">
        Pick two or more. Everyone in a circle knows everyone else in it — they will talk to each
        other, not just to you.
      </p>

      <div className="card-grid">
        {eligible.map((m) => (
          <button
            key={m.id}
            className="muse-card"
            onClick={() => toggle(m.id)}
            style={picked.includes(m.id) ? { borderColor: "var(--accent)" } : undefined}
          >
            <Avatar name={m.name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3>{m.name}{picked.includes(m.id) ? " ✓" : ""}</h3>
              <span className="rel">{m.relationshipType}</span>
              <p>{m.description}</p>
            </div>
          </button>
        ))}
      </div>

      {eligible.length < 2 && (
        <p className="fine" style={{ marginTop: "1rem" }}>
          You need at least two people with a full profile. Build someone from a chat export, or
          start a conversation with one of the four already here.
        </p>
      )}

      <label className="field" style={{ marginTop: "1.5rem" }}>
        <span>Call it something</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggested || "The group chat"}
        />
      </label>

      <div className="row" style={{ marginTop: "1.25rem" }}>
        <button
          className="btn"
          disabled={picked.length < 2}
          onClick={() => onCreate(name.trim() || suggested || "The group chat", picked)}
        >
          {picked.length < 2 ? "Pick at least two" : `Put ${picked.length} in a room`}
        </button>
      </div>
    </main>
  );
}

function isDefaultVibe(v: Vibe): boolean {
  return v.mood === DEFAULT_VIBE.mood && v.topic === DEFAULT_VIBE.topic && v.register === DEFAULT_VIBE.register;
}

function lastAt(state: SoloState, museId: string): number {
  const log = state.conversations[museId];
  if (!log?.length) return 0;
  return new Date(log[log.length - 1].at).getTime();
}
