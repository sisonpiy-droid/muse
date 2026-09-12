"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { BuildFigure } from "@/components/BuildFigure";
import { CircleChat } from "@/components/CircleChat";
import { EditMuse } from "@/components/EditMuse";
import { ImportPersona } from "@/components/ImportPersona";
import { Memories } from "@/components/Memories";
import { MessageActions } from "@/components/MessageActions";
import { VoiceNote } from "@/components/VoiceNote";
import {
  DEFAULT_VIBE, MOODS, REGISTERS, TOPICS, feelingsSummary, hasFeelings, splitBurst,
  vibeSummary, type Vibe,
} from "@/lib/presence/persona";
import { DEFAULT_VOICE } from "@/lib/presence/voices";
import { safeFilename, transcriptMarkdown } from "@/lib/export";
import {
  addMemories, allMuses, circleOf, deleteCircle, deleteConversation, deleteFrom,
  deleteMemory, deleteMessage, deleteMuse, download, editMemory, editMessage, editMuse,
  feelingsOf, findMuse, forgetAll, isEdited, knownTo, loadState, membersOf, memoriesOf,
  parseBackup, relevantMemories, resetMuse, saveState, setFeelings,
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

/* Accepts a function of the current state as well as a plain value, so a caller
   that writes back after an await cannot resurrect a stale snapshot. */
export type Update = (next: SoloState | ((cur: SoloState) => SoloState)) => void;

/** What /api/solo/chat accepts for one message. Enforced here too, because a
 *  stored message the route rejects is not a failed send -- it stays in the
 *  window and fails every send after it. */
const MAX_MESSAGE = 8000;

type View =
  | { kind: "home" }
  | { kind: "chat"; museId: string }
  | { kind: "edit"; museId: string }
  | { kind: "memories"; museId: string }
  | { kind: "import" }
  | { kind: "figure" }
  | { kind: "circle"; circleId: string }
  | { kind: "new-circle" };

export default function SoloPage() {
  const [state, setState] = useState<SoloState | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  /* Whether the last write actually landed. Everything in here is one
     localStorage key that only grows, and when the browser finally refuses it
     the app carries on working perfectly for the rest of the session and loses
     the lot on reload. Silence there is the worst failure the product has. */
  const [saveIssue, setSaveIssue] = useState<null | "quota" | "unavailable" | "nearly" | "corrupt">(null);

  /* Skips the write that would immediately follow the first read. */
  const loaded = useRef(false);

  useEffect(() => { setState(loadState()); }, []);

  /* Saving is a consequence of the state changing, not something every call site
     remembers to do. That matters for more than tidiness: memory extraction
     writes back seconds after the turn it belongs to, and it used to hand back a
     whole state object captured before the network call. Anything the user did
     while it was in flight -- a message sent, a reply received -- was silently
     discarded when it landed. Callers now pass a function of the current state
     instead, and the save happens once, here, on whatever actually committed. */
  useEffect(() => {
    if (!state) return;
    if (!loaded.current) { loaded.current = true; return; }
    const saved = saveState(state);
    const issue = saved.ok ? (saved.nearlyFull ? "nearly" : null) : saved.reason;
    /* Only when it actually changes. This runs on every state change, which is
       every keystroke-driven write, and setting the same value each time would
       schedule a render per save for no reason. */
    setSaveIssue((cur) => (cur === issue ? cur : issue));
  }, [state]);

  const update: Update = (next) =>
    setState((cur) => (typeof next === "function" ? next(cur as SoloState) : next));

  const banner = saveIssue && state && (
    <div className={saveIssue === "nearly" ? "notice" : "notice notice-bad"} role="alert">
      <div>
        {saveIssue === "quota" && (
          <>
            <strong>This browser is full, and nothing new is being saved.</strong> Everything
            since you opened the app will be gone on reload. Take a backup now, then delete a
            conversation you have finished with to make room.
          </>
        )}
        {saveIssue === "unavailable" && (
          <>
            <strong>This browser is refusing to store anything.</strong> Private browsing does
            this. Nothing said here will survive closing the tab.
          </>
        )}
        {saveIssue === "corrupt" && (
          <>
            <strong>Your saved data is here but couldn&apos;t be read.</strong> Nothing is being
            written over it, so it is not lost — but this session will not be saved either. If you
            have a backup file, restoring it from the home screen is the way back.
          </>
        )}
        {saveIssue === "nearly" && (
          <>
            <strong>Storage is nearly full.</strong> Take a backup while everything still fits,
            and clear out a conversation or two.
          </>
        )}
      </div>
      <button
        className="btn"
        hidden={saveIssue === "corrupt"}
        onClick={() => download(
          safeFilename("muse-backup", "json"),
          JSON.stringify(state, null, 2),
          "application/json"
        )}
      >
        Back up now
      </button>
    </div>
  );

  /* The banner has to ride above whichever view is showing -- running out of
     room mid-conversation is exactly when it matters and exactly when the user
     is not on the home screen. */
  const shell = (node: React.ReactNode) => (<>{banner}{node}</>);

  // Nothing renders until localStorage has been read, so the first paint is
  // never a wrong empty state that flips a tick later.
  if (!state) return <main className="shell" />;

  if (view.kind === "import") {
    return shell(
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

  if (view.kind === "figure") {
    return shell(
      <BuildFigure
        onCancel={() => setView({ kind: "home" })}
        onCreate={(draft) => {
          const id = `figure-${Date.now()}`;
          update((cur) => ({
            ...cur,
            userName: cur.userName ?? draft.you,
            muses: [
              {
                id,
                builtin: false,
                persona: draft,
                name: draft.them,
                description: draft.interests?.trim() || "Built from what they have said in public.",
                relationshipType: draft.relationship?.trim() || "someone in public life",
                category: "Public",
                traits: [],
              },
              ...cur.muses,
            ],
          }));
          setView({ kind: "chat", museId: id });
        }}
      />
    );
  }

  if (view.kind === "circle") {
    const circle = circleOf(state, view.circleId);
    if (!circle) { setView({ kind: "home" }); return null; }
    return shell(
      <CircleChat circle={circle} state={state} update={update} onBack={() => setView({ kind: "home" })} />
    );
  }

  if (view.kind === "new-circle") {
    return shell(
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

  if (view.kind === "edit") {
    const muse = findMuse(state, view.museId);
    if (!muse) { setView({ kind: "home" }); return null; }
    return shell(
      <EditMuse
        key={muse.id}
        muse={muse}
        feelings={feelingsOf(state, muse.id)}
        /* A starter with a standing state but no profile changes is still
           something to put back, so both count. */
        resettable={
          muse.builtin && (isEdited(state, muse.id) || hasFeelings(feelingsOf(state, muse.id)))
        }
        onCancel={() => setView({ kind: "chat", museId: muse.id })}
        onSave={(patch, feelings) => {
          update(setFeelings(editMuse(state, muse.id, patch), muse.id, feelings));
          setView({ kind: "chat", museId: muse.id });
        }}
        onReset={() => {
          update(resetMuse(state, muse.id));
          setView({ kind: "chat", museId: muse.id });
        }}
      />
    );
  }

  if (view.kind === "memories") {
    const muse = findMuse(state, view.museId);
    if (!muse) { setView({ kind: "home" }); return null; }
    return shell(
      <Memories
        key={muse.id}
        muse={muse}
        memories={memoriesOf(state, muse.id)}
        onEdit={(id, patch) => update((cur) => editMemory(cur, id, patch))}
        onDelete={(id) => update((cur) => deleteMemory(cur, id))}
        onForgetAll={() => update((cur) => forgetAll(cur, muse.id))}
        onBack={() => setView({ kind: "chat", museId: muse.id })}
      />
    );
  }

  if (view.kind === "chat") {
    const muse = findMuse(state, view.museId);
    if (!muse) { setView({ kind: "home" }); return null; }
    return shell(
      <SoloChat
        muse={muse}
        state={state}
        update={update}
        onBack={() => setView({ kind: "home" })}
        onEdit={() => setView({ kind: "edit", museId: muse.id })}
        onMemories={() => setView({ kind: "memories", museId: muse.id })}
      />
    );
  }

  return shell(
    <SoloHome
      state={state}
      update={update}
      onOpen={(id) => setView({ kind: "chat", museId: id })}
      onEdit={(id) => setView({ kind: "edit", museId: id })}
      onImport={() => setView({ kind: "import" })}
      onFigure={() => setView({ kind: "figure" })}
      onOpenCircle={(id) => setView({ kind: "circle", circleId: id })}
      onNewCircle={() => setView({ kind: "new-circle" })}
    />
  );
}

/* ------------------------------------------------------------------ home */

function SoloHome({
  state, update, onOpen, onEdit, onImport, onFigure, onOpenCircle, onNewCircle,
}: {
  state: SoloState;
  update: Update;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onImport: () => void;
  onFigure: () => void;
  onOpenCircle: (id: string) => void;
  onNewCircle: () => void;
}) {
  const [name, setName] = useState(state.userName ?? "");
  const muses = allMuses(state);

  const talked = muses
    .filter((m) => (state.conversations[m.id]?.length ?? 0) > 0)
    .sort((a, b) => lastAt(state, b.id) - lastAt(state, a.id));
  const rest = muses.filter((m) => !(state.conversations[m.id]?.length ?? 0));

  /* Grouped rather than one long grid. Sixteen cards in a row is a list to be
     got through; three labelled groups is a choice. Insertion order decides
     the sections, so the order in personas.ts is the order on screen. */
  const groups = rest.reduce((acc, m) => {
    const key = m.category || "Someone else";
    (acc[key] ??= []).push(m);
    return acc;
  }, {} as Record<string, SoloMuse[]>);

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
            Build someone from a real chat export, or start with one of the {muses.length} already here.
            They remember what you tell them, and everything stays in this browser.
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
          <h2 className="section-title">Build someone</h2>
          <div className="card-grid">
            <button className="muse-card" onClick={onImport} style={{ borderStyle: "dashed" }}>
              <div style={{ minWidth: 0 }}>
                <h3>From a chat export</h3>
                <p>
                  Upload a WhatsApp export and MUSE reads how they actually wrote — length,
                  punctuation, the habits nobody can describe.
                </p>
              </div>
            </button>
            <button className="muse-card" onClick={onFigure} style={{ borderStyle: "dashed" }}>
              <div style={{ minWidth: 0 }}>
                <h3>Someone in public life</h3>
                <p>
                  An actor, a writer, a founder. Built from what they have said in public, to talk
                  to about their work — as a mentor, a teacher or a friend.
                </p>
              </div>
            </button>
          </div>

          {talked.length > 0 && (
            <>
              <h2 className="section-title">Continue talking</h2>
              <div className="card-grid">
                {talked.map((m) => (
                  <MuseCard
                    key={m.id} muse={m} state={state} update={update} onOpen={onOpen} onEdit={onEdit}
                  />
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

          {Object.entries(groups).map(([category, people]) => (
            <div key={category}>
              <h2 className="section-title">{category}</h2>
              <div className="card-grid">
                {people.map((m) => (
                  <MuseCard
                    key={m.id} muse={m} state={state} update={update} onOpen={onOpen} onEdit={onEdit}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="row" style={{ marginTop: "2.5rem", gap: "0.75rem", flexWrap: "wrap" }}>
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

            {/* The other half of that button. Without it the export was a file
                nobody could use, and a cleared browser was total loss even for
                someone who had backed up. */}
            <label className="btn-ghost" style={{ cursor: "pointer" }}>
              Restore a backup
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const result = parseBackup(await file.text());
                  if (!result.ok) { alert(result.error); return; }
                  const { people, messages, memories, circles } = result.summary;
                  const has = (state.muses.length || Object.keys(state.conversations).length);
                  const warning = has
                    ? "\n\nThis REPLACES everything currently in this browser. Export first if you are not sure."
                    : "";
                  if (!confirm(
                    `Restore ${people} ${people === 1 ? "person" : "people"}, ${messages} messages, ` +
                    `${memories} memories and ${circles} ${circles === 1 ? "circle" : "circles"}?${warning}`
                  )) return;
                  update(result.state);
                }}
              />
            </label>
            <button
              className="link-btn"
              onClick={() => {
                /* It also deletes every character the user built from an
                   export, which the old wording never mentioned. */
                const built = state.muses.length;
                const msg = built
                  ? `Delete everything in this browser?\n\nThat includes the ${built} ${built === 1 ? "character" : "characters"} you built from a chat export, every conversation, and everything they remember. It cannot be undone.`
                  : "Delete every conversation and memory in this browser? This cannot be undone.";
                if (!confirm(msg)) return;
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
  muse, state, update, onOpen, onEdit,
}: {
  muse: SoloMuse;
  state: SoloState;
  update: Update;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
}) {
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
      <button className="safe" onClick={() => onEdit(muse.id)}>edit</button>
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
  muse, state, update, onBack, onEdit, onMemories,
}: {
  muse: SoloMuse;
  state: SoloState;
  update: Update;
  onBack: () => void;
  onEdit: () => void;
  onMemories: () => void;
}) {
  const log = state.conversations[muse.id] ?? [];
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Some failures are worth another go and some are not. Offering "Try again"
     on a prompt-level block just runs the user into the same wall. */
  const [canRetry, setCanRetry] = useState(true);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [vibeOpen, setVibeOpen] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const vibe: Vibe = state.vibes?.[muse.id] ?? DEFAULT_VIBE;
  const setVibe = (next: Vibe) =>
    update({ ...state, vibes: { ...(state.vibes ?? {}), [muse.id]: next } });

  /* Standing state, set on the edit screen and unchanged by anything here. Read
     fresh on every render so a change made in the middle of a conversation
     applies to the next message rather than the next reload. */
  const feelings = feelingsOf(state, muse.id);

  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length, streaming]);

  const memoriesFor = state.memories.filter((m) => m.museId === muse.id);

  /* `resend` is a retry of a message already in the thread.
   *
   * The failed attempt saved the user's message before the request went out, so
   * the retry button appending it again added a second copy every single time.
   * Two failures in a row left three. It is the saved conversation that is
   * wrong afterwards, not just the screen. */
  async function send(text: string, resend = false) {
    const content = text.trim();
    if (!content || busy) return;

    setBusy(true);
    setError(null);
    setCanRetry(true);
    setDraft("");
    setLastSent(content);
    if (box.current) box.current.style.height = "auto";

    const withUser: SoloMessage[] = resend
      ? log
      : [...log, { id: `u-${Date.now()}`, from: "user", content, at: new Date().toISOString() }];

    /* Functional, like every other write in here: a turn takes seconds and
       anything committed during it -- a memory landing, an edit -- would be
       reverted by writing back a snapshot taken before it started. */
    if (!resend) {
      update((cur) => ({
        ...cur,
        conversations: { ...cur.conversations, [muse.id]: withUser },
      }));
    }

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
            name: muse.name.slice(0, 40),
            description: muse.description.slice(0, 400),
            /* Clamped to what the route accepts rather than sent as stored.
               These caps are one-sided -- the wizard let a relationship run to
               120 characters while the route rejects past 40 -- and the reply
               path has no tolerance for a rejection: the offending value is in
               localStorage, so every future request carries it and 400s too.
               One long word typed once during setup ended the character. */
            relationshipType: muse.relationshipType.slice(0, 40) || "someone close",
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
            /* Same reasoning: one pasted message over the route's limit sat in
               the window and killed every turn after it, permanently. */
            content: m.content.slice(0, MAX_MESSAGE),
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
          /* Capped: someone in circles with nine or more other people
             exceeded the route's limit and could no longer hold a one-to-one
             conversation at all. */
          knows: knownTo(state, muse.id).slice(0, 8).map((k) => ({
            name: k.name.slice(0, 60),
            relationship: k.relationshipType.slice(0, 120),
          })),
          mood: vibe.mood,
          topic: vibe.topic,
          register: vibe.register,
          /* How they are generally, as opposed to how this conversation is
             going. Sent every turn: it is a state, not an event. */
          feelings: hasFeelings(feelings) ? feelings : null,
          /* Clamped on read as well as on write. The write-side clamp is new,
             so anything already in someone's browser is still over the limit,
             and a single one of those 400s the whole request the moment it
             ranks into the top eight. */
          memories: memories.map((m) => m.slice(0, 400)),
          userName: state.userName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        setCanRetry(true);
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
          let evt: { type?: string; text?: string; message?: string; retryable?: boolean };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "delta" && evt.text) { acc += evt.text; setStreaming(acc); }
          else if (evt.type === "error") {
            setError(evt.message ?? "Something went wrong.");
            setCanRetry(evt.retryable !== false);
          }
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
        update((cur) => ({
          ...cur,
          conversations: { ...cur.conversations, [muse.id]: withMuse },
        }));
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
                /* Bounded on the way out as well as clamped on the way in.
                   This list is only there to stop the model re-proposing
                   something already known, and sending a year of them every
                   turn is bandwidth spent on nothing. */
                known: memoriesFor.slice(-60).map((m) => m.content),
              }),
            });
            const { memories: found } = await r.json();
            if (Array.isArray(found) && found.length) {
              /* Read at commit time, not from the snapshot this turn started
                 with -- see the save effect above. */
              update((cur) => addMemories(cur, muse.id, found));
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
            {memoriesFor.length > 0 && (
              <>
                {" · "}
                {/* The count was the only sign memory existed at all, and it led
                    nowhere. It is the obvious door, so it is the door. */}
                <button className="inline-link" onClick={onMemories}>
                  remembers {memoriesFor.length}
                </button>
              </>
            )}
            {isDefaultVibe(vibe) ? null : (
              <span style={{ color: "var(--accent)" }}> · {vibeSummary(vibe)}</span>
            )}
            {hasFeelings(feelings) && (
              <span style={{ color: "var(--muted)" }}> · {feelingsSummary(feelings)}</span>
            )}
          </div>
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: "0.5rem" }}>
          <button className="link-btn" onClick={onEdit} title={`Edit ${muse.name}`}>edit</button>
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
            {/* Only on their messages. Reading your own words back to you in
                someone else's voice is a strange thing to offer. */}
            {m.from === "muse" && (
              <VoiceNote text={m.content} voice={voiceOf(muse)} name={muse.name} />
            )}
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
            {lastSent && canRetry && (
              <button className="link-btn" onClick={() => send(lastSent, true)}>Try again</button>
            )}
            {!canRetry && (
              <button className="link-btn" onClick={onEdit}>Edit {muse.name}</button>
            )}
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
                This is for today only. For something standing &mdash; what they have going on at
                the moment, or where things are between you &mdash; use <em>edit</em> at the top.
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
          maxLength={MAX_MESSAGE}
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
  const everyone = allMuses(state);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");

  /* Only people with a full profile can be in a circle. A Muse without one has
     no archetype or samples for the group prompt to work from, and would be the
     one flat voice in the room.
     
     Public figures are out too, for a different reason: circleBlock tells every
     member "You know these people and they know you", which for a real named
     person sitting in a room with the user's father is a fabricated
     relationship between a real human being and a private one. Everything else
     in the figure mode works to stop it inventing its own life; putting it in a
     circle would invent one for it. */
  const eligible = everyone.filter((m) => m.persona && m.persona.mode !== "figure");

  /* The route carries a roster of everyone else in the room and caps it, so a
     circle of nine could be created and then never produce a single reply --
     every turn rejected, permanently, with nothing saying why. Capped where the
     circle is made instead. Eight is also about where a group conversation
     stops being one. */
  const MAX_CIRCLE = 8;

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_CIRCLE ? p : [...p, id]
    );
  const full = picked.length >= MAX_CIRCLE;

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
            disabled={full && !picked.includes(m.id)}
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
          start a conversation with one of the people already here.
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
        {full && <span className="fine">Eight is the most a room holds.</span>}
      </div>
    </main>
  );
}

function isDefaultVibe(v: Vibe): boolean {
  return v.mood === DEFAULT_VIBE.mood && v.topic === DEFAULT_VIBE.topic && v.register === DEFAULT_VIBE.register;
}

/** What a character sounds like, falling back for anyone built before voice
 *  notes existed rather than leaving them mute. */
function voiceOf(muse: SoloMuse): string {
  return muse.voice ?? DEFAULT_VOICE;
}

function lastAt(state: SoloState, museId: string): number {
  const log = state.conversations[museId];
  if (!log?.length) return 0;
  return new Date(log[log.length - 1].at).getTime();
}
