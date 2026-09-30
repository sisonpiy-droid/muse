"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { BuildFigure } from "@/components/BuildFigure";
import { CircleChat } from "@/components/CircleChat";
import { EditMuse } from "@/components/EditMuse";
import { ImportPersona } from "@/components/ImportPersona";
import { Memories } from "@/components/Memories";
import { MessageActions } from "@/components/MessageActions";
import { QuoteBubble, ReplyBar, jumpTo } from "@/components/Quote";
import { TraitEditor } from "@/components/TraitEditor";
import { useReplyLoop } from "@/components/useReplyLoop";
import { MADE_TAB, TABS, TAB_MAX } from "@/lib/personas";
import {
  DEFAULT_VIBE, MOODS, REGISTERS, TOPICS, feelingsSummary, hasFeelings, splitBurst,
  vibeSummary, type Vibe,
} from "@/lib/presence/persona";
import { safeFilename, transcriptMarkdown } from "@/lib/export";
import {
  QUOTE_CHARS, addMemories, allMuses, attachEmbeddings, circleOf, deleteCircle, deleteConversation,
  deleteFrom, deleteMemory, deleteMessage, deleteMuse, download, editMemory, editMessage,
  editMuse, feelingsOf, findMuse, forgetAll, inTab, insertAfter, isEdited, knownTo, loadState,
  membersOf, memoriesOf, needsEmbedding, newMessage, parseBackup, promptPersona, quoteOf,
  relevantMemories, resetMuse, rewindTo, saveState, worthRecalling,
  setFeelings,
  type SoloCircle, type SoloMessage, type SoloMuse, type SoloState,
} from "@/lib/solo/store";

/** The circles live under the tabs too, as their own. */
const CIRCLES_TAB = "Circles";

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
  | { kind: "tab"; tab: string }
  | { kind: "chat"; museId: string }
  | { kind: "edit"; museId: string }
  | { kind: "memories"; museId: string }
  | { kind: "import" }
  | { kind: "invent" }
  | { kind: "figure" }
  | { kind: "circle"; circleId: string }
  | { kind: "new-circle" };

export default function SoloPage() {
  const [state, setState] = useState<SoloState | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  /* Where "back" goes from a conversation: the tab it was opened from, so
     going through three of your best friends is not three trips via home. */
  const [base, setBase] = useState<View>({ kind: "home" });
  const goBase = () => setView(base);
  const goHome = () => { setBase({ kind: "home" }); setView({ kind: "home" }); };
  const goTab = (tab: string) => { setBase({ kind: "tab", tab }); setView({ kind: "tab", tab }); };
  /* Whether the last write actually landed. Everything in here is one
     localStorage key that only grows, and when the browser finally refuses it
     the app carries on working perfectly for the rest of the session and loses
     the lot on reload. Silence there is the worst failure the product has. */
  const [saveIssue, setSaveIssue] = useState<null | "quota" | "unavailable" | "nearly" | "corrupt">(null);

  /* Skips the write that would immediately follow the first read. */
  const loaded = useRef(false);

  /* Deliberately not a lazy useState initializer: this runs during SSR too,
     where there is no localStorage, so the server and the client's first
     render must both start from null and swap in the real state after mount
     -- otherwise hydration sees different markup from the two passes. */
  // eslint-disable-next-line react-hooks/set-state-in-effect
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

  if (view.kind === "import" || view.kind === "invent") {
    return shell(
      <ImportPersona
        /* Same wizard either way. Inventing someone just skips the question it
           already knows the answer to. */
        startMode={view.kind === "invent" ? "character" : undefined}
        onCancel={goBase}
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
        onCancel={goBase}
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
      <CircleChat circle={circle} state={state} update={update} onBack={goBase} />
    );
  }

  if (view.kind === "new-circle") {
    return shell(
      <NewCircle
        state={state}
        onCancel={goBase}
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
        tabCounts={Object.fromEntries(TABS.map((t) => [t.id, inTab(state, t.id).length]))}
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
        onBack={goBase}
        onEdit={() => setView({ kind: "edit", museId: muse.id })}
        onMemories={() => setView({ kind: "memories", museId: muse.id })}
      />
    );
  }

  const nav = {
    onOpen: (id: string) => setView({ kind: "chat", museId: id }),
    onEdit: (id: string) => setView({ kind: "edit", museId: id }),
    onImport: () => setView({ kind: "import" }),
    onInvent: () => setView({ kind: "invent" }),
    onFigure: () => setView({ kind: "figure" }),
    onOpenCircle: (id: string) => setView({ kind: "circle", circleId: id }),
    onNewCircle: () => setView({ kind: "new-circle" }),
    onTab: goTab,
  };

  if (view.kind === "tab") {
    return shell(<SoloTab state={state} update={update} tab={view.tab} onHome={goHome} {...nav} />);
  }

  return shell(<SoloHome state={state} update={update} {...nav} />);
}

/* ------------------------------------------------------------------ home */

type Nav = {
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onImport: () => void;
  onInvent: () => void;
  onFigure: () => void;
  onOpenCircle: (id: string) => void;
  onNewCircle: () => void;
  onTab: (tab: string) => void;
};

/** How many recent conversations the home screen keeps to hand. The rest of
 *  everyone is one tap away under their tab. */
const RECENT = 3;

const MADE_BLURB = "Built from your chats, from public life, or made up";
const CIRCLES_BLURB = "Group chats, with whoever you put in the room";

function blurbOf(tab: string): string {
  if (tab === MADE_TAB) return MADE_BLURB;
  if (tab === CIRCLES_TAB) return CIRCLES_BLURB;
  return TABS.find((t) => t.id === tab)?.blurb ?? "";
}

/* The home screen is doors, not people.
 *
 * It used to lay every starter out in three long sections -- twenty cards
 * reads as a list to get through rather than people you know. Now each group
 * is a tile, and the people are inside it. The only faces here are the few you
 * were talking to most recently, because opening a tab to carry on a
 * conversation you had an hour ago is a tap too many. */
function SoloHome({
  state, update, onOpen, onEdit, onImport, onInvent, onFigure, onNewCircle, onTab,
}: { state: SoloState; update: Update } & Nav) {
  const [name, setName] = useState(state.userName ?? "");
  const muses = allMuses(state);
  const circles = state.circles ?? [];

  const recent = muses
    .filter((m) => (state.conversations[m.id]?.length ?? 0) > 0)
    .sort((a, b) => lastAt(state, b.id) - lastAt(state, a.id))
    .slice(0, RECENT);

  const inCircles = [...new Set(circles.flatMap((c) => c.memberIds))]
    .map((id) => findMuse(state, id))
    .filter((m): m is SoloMuse => Boolean(m));

  const tiles = [
    ...TABS.map((t) => ({ id: t.id, people: inTab(state, t.id), count: `${inTab(state, t.id).length} people` })),
    { id: MADE_TAB, people: inTab(state, MADE_TAB), count: countOf(inTab(state, MADE_TAB).length, "person", "people") },
    { id: CIRCLES_TAB, people: inCircles, count: countOf(circles.length, "circle", "circles") },
  ];

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
          <h2 className="section-title">Make someone new</h2>
          <MakeRow onImport={onImport} onFigure={onFigure} onInvent={onInvent} onNewCircle={onNewCircle} />

          {recent.length > 0 && (
            <>
              <h2 className="section-title">Continue talking</h2>
              <div className="card-grid">
                {recent.map((m) => (
                  <MuseCard key={m.id} muse={m} state={state} update={update} onOpen={onOpen} onEdit={onEdit} />
                ))}
              </div>
            </>
          )}

          <h2 className="section-title">Your people</h2>
          <div className="tab-tiles">
            {tiles.map((t) => (
              <button key={t.id} className="tab-tile" onClick={() => onTab(t.id)}>
                <div className="stack-avatars" aria-hidden>
                  {t.people.slice(0, 3).map((p) => <Avatar key={p.id} name={p.name} />)}
                </div>
                <div className="tab-tile-text">
                  <b>{t.id}</b>
                  <span>{blurbOf(t.id)}</span>
                </div>
                <em>{t.count}</em>
              </button>
            ))}
          </div>

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

/* One tab's people. The strip across the top switches tabs without going back
 * through home, which is how people actually browse -- "who's in family,
 * actually who's in close friends". */
function SoloTab({
  state, update, tab, onHome, onOpen, onEdit, onImport, onInvent, onFigure, onOpenCircle, onNewCircle, onTab,
}: { state: SoloState; update: Update; tab: string; onHome: () => void } & Nav) {
  const all = [...TABS.map((t) => t.id as string), MADE_TAB, CIRCLES_TAB];
  const people = tab === CIRCLES_TAB ? [] : inTab(state, tab);
  const circles = state.circles ?? [];

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <button className="link-btn" onClick={onHome} style={{ textDecoration: "none" }}>← Home</button>
        <span className="fine">no account · this browser only</span>
      </header>

      <nav className="tab-strip" aria-label="Your people">
        {all.map((t) => (
          <button key={t} className="tab-pill" aria-current={t === tab ? "page" : undefined} onClick={() => onTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <h1 className="display" style={{ fontSize: "1.9rem", marginTop: "1.75rem" }}>{tab}</h1>
      <p className="lede">{blurbOf(tab)}</p>

      {tab === CIRCLES_TAB ? (
        <>
          {circles.length ? (
            <div className="card-grid">
              {circles.map((c) => (
                <CircleCard key={c.id} circle={c} state={state} update={update} onOpen={onOpenCircle} />
              ))}
            </div>
          ) : (
            <div className="empty"><p>No circles yet. Put two or more people in a room and they talk to each other, not just to you.</p></div>
          )}
          <div className="make-row" style={{ marginTop: "1rem" }}>
            <button className="make" onClick={onNewCircle}>
              <b>Start a circle</b>
              <span>Two or more, in a room together</span>
            </button>
          </div>
        </>
      ) : (
        <>
          {people.length ? (
            <div className="card-grid">
              {people.map((m) => (
                <MuseCard key={m.id} muse={m} state={state} update={update} onOpen={onOpen} onEdit={onEdit} />
              ))}
            </div>
          ) : (
            <div className="empty"><p>Nobody here yet.</p></div>
          )}
          {tab === MADE_TAB ? (
            <div style={{ marginTop: "1rem" }}>
              <MakeRow onImport={onImport} onFigure={onFigure} onInvent={onInvent} />
            </div>
          ) : (
            <p className="fine" style={{ marginTop: "1rem" }}>
              Move someone to a different tab from their edit screen. Each tab holds up to {TAB_MAX}.
            </p>
          )}
        </>
      )}
    </main>
  );
}

/* A strip, not the three full-height panels this used to be. Those pushed the
   people you actually talk to 1,329px down on a phone. */
function MakeRow({
  onImport, onFigure, onInvent, onNewCircle,
}: { onImport: () => void; onFigure: () => void; onInvent: () => void; onNewCircle?: () => void }) {
  return (
    <div className="make-row">
      <button className="make" onClick={onImport}>
        <b>From a chat export</b>
        <span>Reads how they actually wrote</span>
      </button>
      <button className="make" onClick={onFigure}>
        <b>Someone in public life</b>
        <span>Built from what they said in public</span>
      </button>
      {/* This was always possible and had no door. You had to open "From a chat
          export", get to the second question, and pick "Someone I made up" --
          behind a button that promises a file upload. */}
      <button className="make" onClick={onInvent}>
        <b>Someone you make up</b>
        <span>Invent them — no export needed</span>
      </button>
      {onNewCircle && (
        <button className="make" onClick={onNewCircle}>
          <b>A circle</b>
          <span>Two or more, in a room together</span>
        </button>
      )}
    </div>
  );
}

function CircleCard({
  circle, state, update, onOpen,
}: { circle: SoloCircle; state: SoloState; update: Update; onOpen: (id: string) => void }) {
  const members = membersOf(state, circle);
  return (
    <div className="card-wrap">
      <button className="muse-card" onClick={() => onOpen(circle.id)}>
        <div className="stack-avatars">
          {members.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} />)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{circle.name}</h3>
          <span className="rel">{members.map((m) => m.name).join(", ")}</span>
          <p>
            {circle.topic?.trim() ? `About ${circle.topic.trim()} · ` : ""}
            {state.conversations[circle.id]?.length ?? 0} messages
          </p>
        </div>
      </button>
      {/* Attached to its own card rather than pooled underneath the whole grid,
          where "delete The Group Chat" sat next to a card it had no visible
          relationship to. */}
      <div className="card-actions">
        <button
          onClick={() => {
            if (confirm(`Delete the circle "${circle.name}" and its conversation? The people in it are kept.`)) {
              update((cur) => deleteCircle(cur, circle.id));
            }
          }}
        >
          delete
        </button>
      </div>
    </div>
  );
}

function countOf(n: number, one: string, many: string): string {
  return n === 0 ? "none yet" : `${n} ${n === 1 ? one : many}`;
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
  const [error, setError] = useState<string | null>(null);
  /* Some failures are worth another go and some are not. Offering "Try again"
     on a prompt-level block just runs the user into the same wall. */
  const [canRetry, setCanRetry] = useState(true);
  const [vibeOpen, setVibeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<SoloMessage | null>(null);
  const foot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /* A reply can start seconds after the send that asked for it, and a second
     text may have landed in between. It reads the state as it is when it
     starts, not the render that scheduled it. */
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });

  const loop = useReplyLoop(reply);

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

  /* Memories written before recall worked on meaning have no vector, and
     ranking only uses vectors when every candidate has one -- so a single old
     memory would hold the whole character on word overlap forever. Filled in
     quietly on open, a batch at a time, and harmless if it never finishes. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = needsEmbedding(state, muse.id);
      if (!pending.length) return;
      const vecs = await embedTexts(pending.map((m) => m.content));
      if (!vecs || cancelled) return;
      const patch: Record<string, number[] | null> = {};
      pending.forEach((m, i) => { patch[m.id] = vecs[i]; });
      update((cur) => attachEmbeddings(cur, patch));
    })();
    return () => { cancelled = true; };
    /* Deliberately keyed on the count rather than on `state`: this should run
       when there is new work, not on every keystroke that changes anything. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muse.id, memoriesFor.length]);

  const nameOf = (m: SoloMessage) => (m.from === "user" ? "You" : muse.name);

  function sendDraft() {
    const content = draft.trim();
    if (!content) return;
    const msg = newMessage("user", content, { replyTo: replyTo?.id });
    update((cur) => ({
      ...cur,
      conversations: { ...cur.conversations, [muse.id]: [...(cur.conversations[muse.id] ?? []), msg] },
    }));
    setDraft("");
    setReplyTo(null);
    setError(null);
    if (box.current) box.current.style.height = "auto";
    loop.schedule();
  }

  /* Answers whatever the user has said since the last reply -- one message or
     several. Does nothing if the thread already ends with a reply. */
  async function reply(signal: AbortSignal) {
    const s = latest.current;
    const person = findMuse(s, muse.id) ?? muse;
    const thread = s.conversations[muse.id] ?? [];
    const last = thread[thread.length - 1];
    if (!last || last.from !== "user") return;

    setError(null);
    setCanRetry(true);

    const vibeNow: Vibe = s.vibes?.[muse.id] ?? DEFAULT_VIBE;
    const feelingsNow = feelingsOf(s, muse.id);
    const known = s.memories.filter((m) => m.museId === muse.id);

    // The last few turns, so retrieval follows the subject rather than a
    // two-word reply carrying no signal.
    const query = thread.slice(-4).map((m) => m.content).join("\n");
    /* One extra round trip before the reply, and it is what makes recall work on
       meaning rather than shared words. Falls back to overlap when it fails, so
       the cost of it going wrong is a worse memory, not a failed message. */
    /* Skipped entirely when the last few turns are "hmm" and "yeah": there is
       nothing to recall against, and a vector for filler still lands nearest to
       something. Also where most of the half-second goes. */
    const [queryVector] = worthRecalling(query) ? (await embedTexts([query])) ?? [null] : [null];
    if (signal.aborted) return;
    const memories = relevantMemories(s, muse.id, query, queryVector);

    let acc = "";
    try {
      const res = await fetch("/api/solo/chat", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          muse: {
            name: person.name.slice(0, 40),
            description: person.description.slice(0, 400),
            /* Clamped to what the route accepts rather than sent as stored.
               These caps are one-sided -- the wizard let a relationship run to
               120 characters while the route rejects past 40 -- and the reply
               path has no tolerance for a rejection: the offending value is in
               localStorage, so every future request carries it and 400s too.
               One long word typed once during setup ended the character. */
            relationshipType: person.relationshipType.slice(0, 40) || "someone close",
            languages: person.languages ?? ["English"],
            personality: {
              traits: (person.traits ?? []).slice(0, 8),
              values: person.values, humour: person.humour, emotionalStyle: person.emotionalStyle,
              opinions: person.opinions, customInstructions: person.customInstructions,
              tone: person.tone, formality: person.formality, sentenceLength: person.sentenceLength,
              catchphrases: person.catchphrases, dialect: person.dialect,
            },
          },
          // Bounded window, same reason as the server app (§9).
          messages: thread.slice(-20).map((m) => {
            const q = quoteOf(thread, m);
            return {
              role: m.from === "user" ? ("user" as const) : ("assistant" as const),
              /* Same reasoning: one pasted message over the route's limit sat in
                 the window and killed every turn after it, permanently. */
              content: m.content.slice(0, MAX_MESSAGE),
              ...(q
                ? { quote: { role: q.from === "user" ? "user" : "assistant", content: q.content.slice(0, QUOTE_CHARS) } }
                : {}),
            };
          }),
          /* Present only for someone with a full profile. When it is, the
             server ignores the simple shape above and uses Presence's prompt. */
          persona: promptPersona(person, s.userName),
          /* Everyone they share a circle with. Being in a circle should mean
             they know those people exist in here too, not only in the group. */
          /* Capped: someone in circles with nine or more other people
             exceeded the route's limit and could no longer hold a one-to-one
             conversation at all. */
          knows: knownTo(s, muse.id).slice(0, 8).map((k) => ({
            name: k.name.slice(0, 60),
            relationship: k.relationshipType.slice(0, 120),
          })),
          mood: vibeNow.mood,
          topic: vibeNow.topic,
          register: vibeNow.register,
          /* How they are generally, as opposed to how this conversation is
             going. Sent every turn: it is a state, not an event. */
          feelings: hasFeelings(feelingsNow) ? feelingsNow : null,
          /* Clamped on read as well as on write. The write-side clamp is new,
             so anything already in someone's browser is still over the limit,
             and a single one of those 400s the whole request the moment it
             ranks into the top eight. */
          memories: memories.map((m) => m.slice(0, 400)),
          userName: s.userName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        setCanRetry(true);
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
      if (signal.aborted) return;

      const text = acc.trim();
      if (!text) return;
      /* Presence tells a texting persona to send several short messages
         separated by a line of ---, because that is how people actually text.
         Splitting them here is what makes that instruction mean anything;
         without it the separator just shows up in the message. */
      /* Only the registers that ask for several messages get split. A letter
         or a voice note is one piece by definition, and splitting it would
         contradict the instruction the model was just given. */
      const reg = REGISTERS[vibeNow.register as keyof typeof REGISTERS] ?? REGISTERS.texts;
      const burst = person.persona ? splitBurst(text, reg.burst) : [text];
      const answer = burst.map((content) => newMessage("muse", content));
      update((cur) => insertAfter(cur, muse.id, last.id, answer));

      /* Extraction runs after the reply is on screen and never blocks it, the
         same shape as the server app's aftercare. */
      void learnFrom(muse.id, [...thread, ...answer].slice(-8), known, update);
    } catch {
      if (!signal.aborted) setError("You're offline.");
    } finally {
      setStreaming("");
    }
  }

  /* Editing a message changes what the conversation was about.
   *
   * Changing the stored text alone left every reply after it answering words
   * that no longer existed, and the memory made from the old version stayed.
   * So an edit to your own latest message takes the thread back to it and asks
   * again. Further up, it asks first, because redoing from there removes
   * everything said since. Either way the edited version is read for memory. */
  function editLine(m: SoloMessage, text: string) {
    const at = log.findIndex((x) => x.id === m.id);
    const after = log.slice(at + 1);
    const redo =
      m.from === "user" &&
      (!after.some((x) => x.from === "user") ||
        confirm(
          `Redo the conversation from this message?\n\nOK takes it back to here and ${muse.name} answers the new version. The ${after.length} messages after it are removed.\n\nCancel just changes the text.`
        ));

    if (redo) {
      update((cur) => rewindTo(editMessage(cur, muse.id, m.id, text), muse.id, m.id));
      setError(null);
      loop.restart();
      return;
    }

    update((cur) => editMessage(cur, muse.id, m.id, text));
    if (m.from === "user") {
      const window = log.slice(Math.max(0, at - 7), at + 1).map((x) => (x.id === m.id ? { ...x, content: text } : x));
      void learnFrom(muse.id, window, memoriesFor, update);
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

  const lastLine = log[log.length - 1];

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

        {log.map((m) => {
          const q = quoteOf(log, m);
          return (
            <div key={m.id} id={`msg-${m.id}`} className={m.from === "user" ? "turn turn-user" : "turn turn-muse"}>
              {m.replyTo && (
                <QuoteBubble who={q ? nameOf(q) : ""} text={q?.content} onJump={q ? () => jumpTo(q.id) : undefined} />
              )}
              {m.content}
              {m.edited && <span className="stamp"> · edited</span>}
              <MessageActions
                content={m.content}
                onReply={() => { setReplyTo(m); box.current?.focus(); }}
                onEdit={(text) => editLine(m, text)}
                onDelete={() => update(deleteMessage(state, muse.id, m.id))}
                onDeleteFrom={() => update(deleteFrom(state, muse.id, m.id))}
              />
            </div>
          );
        })}

        {streaming && <div className="turn turn-muse">{streaming}</div>}
        {loop.busy && !streaming && <p className="typing">{muse.name} is typing<i>.</i><i>.</i><i>.</i></p>}

        {error && (
          <div style={{ marginTop: "1rem" }}>
            <p className="error" role="alert">{error}</p>
            {canRetry && lastLine?.from === "user" && (
              <button className="link-btn" onClick={() => loop.schedule(0)}>Try again</button>
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

              <div>
                <label>What {muse.name} is like</label>
                <TraitEditor
                  traits={muse.traits ?? []}
                  onChange={(traits) => update((cur) => editMuse(cur, muse.id, { traits }))}
                  suggestions={TRAIT_IDEAS}
                />
              </div>

              <p className="fine">
                <strong style={{ color: "var(--accent)" }}>
                  {isDefaultVibe(vibe)
                    ? "Nothing set — they will be however they are."
                    : `From your next message: ${vibeSummary(vibe)}.`}
                </strong>{" "}
                Mood, subject and register are for today only. Traits stay. For something standing &mdash; what they have going on at
                the moment, or where things are between you &mdash; use <em>edit</em> at the top.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="composer">
        {replyTo && (
          <ReplyBar who={replyTo.from === "user" ? "yourself" : muse.name} text={replyTo.content} onCancel={() => setReplyTo(null)} />
        )}
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
            loop.hold();
            const el = box.current;
            if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDraft(); }
            if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
        />
        {/* Never disabled while they are typing back: a second text is how
            people talk, and it gets answered with the first. */}
        <button className="send" onClick={sendDraft} disabled={!draft.trim()}>Send</button>
      </div>
    </main>
  );
}

/* Memory extraction over a window of the thread. Never blocks anything and
 * never surfaces an error -- a missed memory is not worth a banner. `known` is
 * captured by the caller and reused for the write-back, because `replaces`
 * comes back as indexes into exactly this list; recomputing it after the round
 * trip would renumber it and delete the wrong memory. */
async function learnFrom(museId: string, window: SoloMessage[], knownMemories: SoloState["memories"], update: Update) {
  const known = knownMemories.slice(-60).map((m) => m.content);
  try {
    const r = await fetch("/api/solo/remember", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: window.map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.content })),
        known,
      }),
    });
    const { memories: found } = await r.json();
    if (!Array.isArray(found) || !found.length) return;
    /* Read at commit time, not from the snapshot this started with -- see the
       save effect above. */
    update((cur) => addMemories(cur, museId, found, known));
    /* Embedded straight away so the next turn can recall them by meaning.
       Separate from the write so a slow or failed embedding never delays the
       memory itself landing. */
    const texts = found.map((f: { content: string }) => f.content);
    const vecs = await embedTexts(texts);
    if (!vecs) return;
    update((cur) => {
      const byContent = new Map(texts.map((t: string, i: number) => [t, vecs[i]]));
      const patch: Record<string, number[] | null> = {};
      for (const m of cur.memories) {
        if (m.museId !== museId || m.embedding?.length) continue;
        const v = byContent.get(m.content);
        if (v) patch[m.id] = v;
      }
      return attachEmbeddings(cur, patch);
    });
  } catch { /* a missed memory is not worth an error banner */ }
}

/** Offered as one-tap additions wherever traits are edited. */
const TRAIT_IDEAS = ["funny", "sarcastic", "caring", "blunt", "chill", "dramatic", "flirty", "nosy", "savage", "soft"];

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

/** Vectors for some text, or null when there is no embedding model configured
 *  or the call fails. Never throws: worse recall for one turn is not worth
 *  failing a message over. */
async function embedTexts(texts: string[]): Promise<(number[] | null)[] | null> {
  if (!texts.length) return null;
  try {
    const res = await fetch("/api/solo/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) return null;
    const { vectors } = await res.json();
    return Array.isArray(vectors) ? vectors : null;
  } catch {
    return null;
  }
}

function lastAt(state: SoloState, museId: string): number {
  const log = state.conversations[museId];
  if (!log?.length) return 0;
  return new Date(log[log.length - 1].at).getTime();
}
