"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { ImportPersona } from "@/components/ImportPersona";
import { safeFilename, transcriptMarkdown } from "@/lib/export";
import {
  addMemories, builtinMuses, download, findMuse, loadState, relevantMemories, saveState,
  type SoloMessage, type SoloMuse, type SoloState,
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

type View = { kind: "home" } | { kind: "chat"; museId: string } | { kind: "import" };

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
        onCreate={(muse) => {
          const id = `made-${Date.now()}`;
          update({ ...state, muses: [{ ...muse, id, builtin: false }, ...state.muses] });
          setView({ kind: "chat", museId: id });
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
    />
  );
}

/* ------------------------------------------------------------------ home */

function SoloHome({
  state, update, onOpen, onImport,
}: {
  state: SoloState;
  update: (s: SoloState) => void;
  onOpen: (id: string) => void;
  onImport: () => void;
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
                  <MuseCard key={m.id} muse={m} state={state} onOpen={onOpen} />
                ))}
              </div>
            </>
          )}

          <h2 className="section-title">Or start with someone here</h2>
          <div className="card-grid">
            {rest.map((m) => (
              <MuseCard key={m.id} muse={m} state={state} onOpen={onOpen} />
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
  muse, state, onOpen,
}: { muse: SoloMuse; state: SoloState; onOpen: (id: string) => void }) {
  const log = state.conversations[muse.id] ?? [];
  const last = log[log.length - 1];
  const remembered = state.memories.filter((m) => m.museId === muse.id).length;

  return (
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
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

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
        const withMuse: SoloMessage[] = [
          ...withUser,
          { id: `m-${Date.now()}`, from: "muse", content: reply, at: new Date().toISOString() },
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

function lastAt(state: SoloState, museId: string): number {
  const log = state.conversations[museId];
  if (!log?.length) return 0;
  return new Date(log[log.length - 1].at).getTime();
}
