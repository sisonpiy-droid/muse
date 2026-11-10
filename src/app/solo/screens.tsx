"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar, hueOf } from "@/components/Avatar";
import { OutreachPanel } from "@/components/OutreachPanel";
import { Welcome } from "@/components/Welcome";
import { arrange, toggleArchive, togglePin } from "@/lib/solo/chatlist";
import { safeFilename } from "@/lib/export";
import { MADE_TAB, TABS } from "@/lib/personas";
import { settingsOf } from "@/lib/proactive/client";
import { bondOf } from "@/lib/solo/life";
import { photoUrl } from "@/lib/solo/photos";
import {
  allMuses, deleteCircle, download, findMuse, inTab, membersOf, memoriesOf, parseBackup, tabOf,
  type SoloCircle, type SoloMessage, type SoloMuse, type SoloState,
} from "@/lib/solo/store";

import type { Update } from "./page";

/* The places in the app, and the screens you browse from.
 *
 * Four destinations -- Home, Discover, Chats, Create -- plus "You" for the
 * account and this device's data. A sidebar on a wide screen, a tab bar on a
 * phone. Everything here is drawn from what is actually stored: the people who
 * ship with the app, the ones you made, and your own conversations. Nothing is
 * ranked by popularity, because there is no such number to rank by.
 */

export const CIRCLES_TAB = "Circles";
const ALL = "Everyone";

export type Place = "home" | "discover" | "chats" | "create" | "you";

export type Nav = {
  onHome: () => void;
  onDiscover: (cat?: string) => void;
  onChats: () => void;
  onCreate: () => void;
  onAccount: () => void;
  onOpen: (id: string) => void;
  onProfile: (id: string) => void;
  onCall: (id: string) => void;
  onEdit: (id: string) => void;
  /** With a tab, whoever is made goes straight into it. */
  onImport: (tab?: string) => void;
  onInvent: (tab?: string) => void;
  onFigure: (tab?: string) => void;
  onOpenCircle: (id: string) => void;
  onNewCircle: () => void;
  /** Set when this device is signed in and syncing. */
  cloudEmail: string | null;
};

/* Clock reads live out here, so a component's render stays pure. */
const now = () => Date.now();
const hourNow = () => new Date().getHours();
const dayNumber = () => Math.floor(Date.now() / 86_400_000);
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ------------------------------------------------------------- unread */

/* Unread, the way a chat list counts it: texts of theirs since you last had
   that chat open. Kept per device. */
const seenKey = (id: string) => `muse-seen-${id}`;
export function markSeen(id: string) {
  try { localStorage.setItem(seenKey(id), String(Date.now())); } catch { /* the count just stays */ }
}
function seenAt(id: string): number | null {
  try { const v = localStorage.getItem(seenKey(id)); return v ? Number(v) : null; } catch { return null; }
}

/** How a message reads in one line: the text, or what kind of thing it was. */
function lineOf(m: SoloMessage): string {
  return m.voiceNote ? "\u{1F3A4} Voice message" : m.video ? "\u{1F3A5} Video" : m.image ? "\u{1F4F7} Photo" : m.song ? `\u{1F3B5} ${m.song.title}` : m.content;
}

const shownOf = (state: SoloState, id: string) => {
  const t = now();
  return (state.conversations[id] ?? []).filter((m) => !m.showAt || Date.parse(m.showAt) <= t);
};

/* What a row says: the last line as a preview, and how many of theirs you have
   not seen. Null for a conversation with nothing shown yet. */
function chatInfo(state: SoloState, id: string, circle?: SoloCircle) {
  const shown = shownOf(state, id);
  const last = shown.at(-1);
  if (!last) return null;
  const who = last.from === "user" ? "You: " : circle && last.speakerId ? `${findMuse(state, last.speakerId)?.name.split(" ")[0] ?? ""}: ` : "";
  /* Never opened since this was added: only what they said after your last text counts. */
  const seen = seenAt(id) ?? Date.parse(shown.findLast((m) => m.from === "user")?.at ?? "") ?? 0;
  const unread = Math.min(99, shown.filter((m) => m.from !== "user" && Date.parse(m.at) > (Number.isFinite(seen) ? seen : 0)).length);
  return { last, preview: `${who}${lineOf(last)}`, unread };
}

type Chat = { id: string; muse?: SoloMuse; circle?: SoloCircle; name: string; preview: string; at: number; unread: number };

/** Every conversation with something in it, people and groups together. */
function chatsOf(state: SoloState): Chat[] {
  const people = allMuses(state).map((m) => ({ id: m.id, muse: m, circle: undefined as SoloCircle | undefined, name: m.name }));
  const groups = (state.circles ?? []).map((c) => ({ id: c.id, muse: undefined as SoloMuse | undefined, circle: c, name: c.name }));
  return [...people, ...groups].flatMap((c) => {
    const info = chatInfo(state, c.id, c.circle);
    return info ? [{ ...c, preview: info.preview, at: Date.parse(info.last.at), unread: info.unread }] : [];
  });
}

/** When you last talked, the way a chat list says it: "now", "14m", "3h", "Mon", "12 Sep". */
function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${Math.floor(s / 3600)}h`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------- icons */

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}><path d={d} /></svg>
);
const ICONS: Record<Place, string> = {
  home: "M4 11.5 12 4l8 7.5M6.5 9.8V20h11V9.8",
  discover: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.6 5.4-2 5.2-5.2 2 2-5.2 5.2-2Z",
  chats: "M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12Z",
  create: "M12 5v14M5 12h14",
  you: "M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 7.5a7.5 7.5 0 0 1 15 0",
};
const PLACES: { id: Place; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  { id: "chats", label: "Chats" },
  { id: "create", label: "Create" },
];

/* ---------------------------------------------------------------- nav */

export function AppNav({ state, current, nav, tabs, openId }: {
  /** The conversation on screen: what arrives in it is being read, not unread. */
  openId?: string | null;
  state: SoloState;
  current: Place | null;
  nav: Nav;
  /** The phone's tab bar. Off inside a conversation, where the composer owns the bottom edge. */
  tabs: boolean;
}) {
  const chats = chatsOf(state).map((c) => (c.id === openId ? { ...c, unread: 0 } : c));
  const unread = chats.reduce((n, c) => n + c.unread, 0);
  const recent = arrange(chats, { pinned: state.pinned, archived: state.archived }).main.slice(0, 6);
  const to: Record<Place, () => void> = {
    home: nav.onHome, discover: () => nav.onDiscover(), chats: nav.onChats, create: nav.onCreate, you: nav.onAccount,
  };
  const item = (p: { id: Place; label: string }, cls: string) => (
    <button key={p.id} className={cls} aria-current={current === p.id ? "page" : undefined} onClick={to[p.id]}>
      <span className="nav-icon">
        <Icon d={ICONS[p.id]} />
        {p.id === "chats" && unread > 0 && <i className="nav-dot" aria-label={`${unread} unread`} />}
      </span>
      <span>{p.label}</span>
    </button>
  );

  return (
    <>
      <aside className="sidenav" aria-label="Muse">
        <button className="brand" onClick={nav.onHome} aria-label="Muse, home">Muse</button>
        <nav className="side-places" aria-label="Main">{PLACES.map((p) => item(p, "side-item"))}</nav>

        {recent.length > 0 && (
          <div className="side-recent">
            <p className="side-label">Recent</p>
            {recent.map((r) => {
              const c = chats.find((x) => x.id === r.id)!;
              return (
                <button key={c.id} className="side-chat" onClick={() => (c.circle ? nav.onOpenCircle(c.id) : nav.onOpen(c.id))}>
                  {c.circle
                    ? <span className="side-group" aria-hidden>{c.name.charAt(0).toUpperCase()}</span>
                    : <Avatar name={c.name} image={c.muse!.avatar?.id} small />}
                  <span className="side-chat-name">{c.name}</span>
                  {c.unread > 0 && <span className="chat-row-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                </button>
              );
            })}
          </div>
        )}

        <button className="side-you" aria-current={current === "you" ? "page" : undefined} onClick={nav.onAccount}>
          <span className="nav-icon"><Icon d={ICONS.you} /></span>
          <span className="side-you-text">
            <b>{state.userName ?? "You"}</b>
            <em>{nav.cloudEmail ? "Synced" : "This browser only"}</em>
          </span>
        </button>
      </aside>

      {tabs && (
        <nav className="tabbar" aria-label="Main">
          {[...PLACES, { id: "you" as Place, label: "You" }].map((p) => item(p, "tab-item"))}
        </nav>
      )}
    </>
  );
}

/* ----------------------------------------------------------- portraits */

/* A character's picture at poster size. Starters have no picture until you
   first open their chat (one is made then), so until there is one this is a
   colour of their own with their initial -- the same hue as their avatar, so
   they are recognisably the same person everywhere. */
export function Portrait({ muse, className = "" }: { muse: SoloMuse; className?: string }) {
  const hue = hueOf(muse.name);
  const image = muse.avatar?.id;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (image) void photoUrl(image).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [image]);
  return (
    <div
      className={`portrait ${className}`}
      aria-hidden
      style={{ background: `radial-gradient(130% 95% at 28% 0%, hsl(${hue} 52% 48%), hsl(${(hue + 36) % 360} 46% 17%) 78%)` }}
    >
      <span className="portrait-initial">{muse.name.trim().charAt(0).toUpperCase()}</span>
      {/* A local file from IndexedDB (an object URL): nothing for next/image to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && url && <img src={url} alt="" loading="lazy" />}
    </div>
  );
}

function PersonCard({ muse, nav, talked, tag }: { muse: SoloMuse; nav: Nav; talked: boolean; tag?: string }) {
  return (
    <article className="pcard">
      <button className="pcard-open" onClick={() => nav.onProfile(muse.id)} aria-label={`${muse.name}, ${muse.relationshipType}. See profile`}>
        <Portrait muse={muse} />
        <span className="pcard-body">
          {tag && <span className="pcard-tag">{tag}</span>}
          <b>{muse.name}</b>
          <em>{muse.relationshipType}</em>
          <span className="pcard-desc">{muse.description}</span>
        </span>
      </button>
      <button className="pcard-chat" onClick={() => nav.onOpen(muse.id)} aria-label={`${talked ? "Continue with" : "Say hi to"} ${muse.name}`}>
        {talked ? "Continue" : "Say hi"}
      </button>
    </article>
  );
}

const talkedTo = (state: SoloState, id: string) => (state.conversations[id]?.length ?? 0) > 0;

/* ---------------------------------------------------------------- home */

export function Home({ state, nav, onName }: { state: SoloState; nav: Nav; onName: (name: string) => void }) {
  const muses = allMuses(state);

  if (!state.userName) {
    return (
      <main className="shell">
        <header className="row" style={{ justifyContent: "space-between" }}><p className="mark">Muse</p></header>
        <Welcome count={muses.length} onStart={onName} />
        <div className="cast" aria-hidden>
          {muses.slice(0, 8).map((m) => <Portrait key={m.id} muse={m} />)}
        </div>
      </main>
    );
  }

  const chats = chatsOf(state);
  const resume = arrange(chats, { pinned: state.pinned, archived: state.archived }).main.slice(0, 8);
  /* People you have not spoken to yet, starting from a different one each day. */
  const fresh = muses.filter((m) => !talkedTo(state, m.id));
  const start = fresh.length ? dayNumber() % fresh.length : 0;
  const toMeet = [...fresh.slice(start), ...fresh.slice(0, start)];
  const feature = toMeet[0];
  const more = toMeet.slice(1, 5);
  const made = inTab(state, MADE_TAB);
  const circles = state.circles ?? [];
  const h = hourNow();
  const hello = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  const cats = [
    ...TABS.map((t) => ({ id: t.id as string, blurb: t.blurb as string, people: inTab(state, t.id), count: plural(inTab(state, t.id).length, "person", "people") })),
    ...(circles.length ? [{
      id: CIRCLES_TAB, blurb: "Group chats, with whoever you put in the room",
      people: [...new Set(circles.flatMap((c) => c.memberIds))].map((id) => findMuse(state, id)).filter((m): m is SoloMuse => Boolean(m)),
      count: plural(circles.length, "circle", "circles"),
    }] : []),
  ];

  return (
    <main className="shell wide">
      <header className="page-head">
        <div>
          <p className="mark">Muse</p>
          <h1 className="display">{hello}, {state.userName}.</h1>
        </div>
      </header>

      {resume.length > 0 && (
        <section aria-labelledby="h-resume">
          <div className="section-head">
            <h2 id="h-resume" className="section-title">Pick up where you left off</h2>
            <button className="more-link" onClick={nav.onChats}>All chats</button>
          </div>
          <div className="rail">
            {resume.map((r) => {
              const c = chats.find((x) => x.id === r.id)!;
              const members = c.circle ? membersOf(state, c.circle) : [];
              return (
                <button key={c.id} className="resume" onClick={() => (c.circle ? nav.onOpenCircle(c.id) : nav.onOpen(c.id))}>
                  <span className="resume-top">
                    {c.circle
                      ? <span className="stack-avatars" aria-hidden>{members.slice(0, 2).map((m) => <Avatar key={m.id} name={m.name} image={m.avatar?.id} />)}</span>
                      : <Avatar name={c.name} image={c.muse!.avatar?.id} ring={c.unread > 0} />}
                    <span className={c.unread ? "resume-time unread" : "resume-time"}>{ago(c.at)}</span>
                  </span>
                  <b>{c.name}</b>
                  <span className="resume-preview">{c.preview}</span>
                  {c.unread > 0 && <span className="chat-row-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {feature && (
        <section aria-labelledby="h-meet">
          <div className="section-head">
            <h2 id="h-meet" className="section-title">{resume.length ? "Someone you haven’t met" : "Start with someone"}</h2>
            <button className="more-link" onClick={() => nav.onDiscover()}>See everyone</button>
          </div>
          <div className="meet">
            <article className="feature">
              <Portrait muse={feature} />
              <div className="feature-text">
                <span className="pcard-tag">{tabOf(feature)}</span>
                <h3>{feature.name}</h3>
                <em>{feature.relationshipType}</em>
                <p>{feature.description}</p>
                {feature.traits?.length ? (
                  <div className="tags">{feature.traits.slice(0, 4).map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                ) : null}
                <div className="row feature-actions">
                  <button className="btn" onClick={() => nav.onOpen(feature.id)}>Say hi to {feature.name.split(" ")[0]}</button>
                  <button className="btn-ghost" onClick={() => nav.onProfile(feature.id)}>Profile</button>
                </div>
              </div>
            </article>
            {more.length > 0 && (
              <div className="pgrid pgrid-tight">
                {more.map((m) => <PersonCard key={m.id} muse={m} nav={nav} talked={false} />)}
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="h-browse">
        <h2 id="h-browse" className="section-title">Browse by who they are to you</h2>
        <div className="cats">
          {cats.map((c) => (
            <button key={c.id} className="cat" onClick={() => nav.onDiscover(c.id)}>
              <span className="stack-avatars" aria-hidden>
                {c.people.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} image={p.avatar?.id} />)}
              </span>
              <b>{c.id}</b>
              <span>{c.blurb}</span>
              <em>{c.count}</em>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="h-made">
        <div className="section-head">
          <h2 id="h-made" className="section-title">Made by you</h2>
          {made.length > 0 && <button className="more-link" onClick={() => nav.onDiscover(MADE_TAB)}>See all</button>}
        </div>
        {made.length ? (
          <div className="pgrid">
            {made.slice(0, 5).map((m) => <PersonCard key={m.id} muse={m} nav={nav} talked={talkedTo(state, m.id)} />)}
            <button className="pcard-new" onClick={nav.onCreate}>
              <span aria-hidden>+</span>
              <b>Make someone else</b>
              <em>From a chat export, public life, or your imagination</em>
            </button>
          </div>
        ) : (
          <div className="make-banner">
            <div>
              <b>Nobody yet. Make someone of your own.</b>
              <span>Invent them, build them from a chat export, or pick someone from public life.</span>
            </div>
            <button className="btn" onClick={nav.onCreate}>Create</button>
          </div>
        )}
      </section>
    </main>
  );
}

/* ------------------------------------------------------------ discover */

export function Discover({ state, update, nav, cat }: { state: SoloState; update: Update; nav: Nav; cat?: string }) {
  const [query, setQuery] = useState("");
  const circles = state.circles ?? [];
  const tabs = [ALL, ...TABS.map((t) => t.id as string), MADE_TAB, CIRCLES_TAB];
  const active = cat && tabs.includes(cat) ? cat : ALL;
  const q = query.trim().toLowerCase();
  const hit = (...text: (string | undefined)[]) => !q || text.join(" ").toLowerCase().includes(q);

  const pool = active === ALL ? allMuses(state) : active === CIRCLES_TAB ? [] : inTab(state, active);
  const people = pool.filter((m) => hit(m.name, m.description, m.relationshipType, ...(m.traits ?? [])));
  const groups = active === CIRCLES_TAB ? circles.filter((c) => hit(c.name, ...membersOf(state, c).map((m) => m.name))) : [];
  const blurb = active === ALL
    ? `${plural(allMuses(state).length, "person", "people")}, each with their own way of answering.`
    : active === MADE_TAB ? "Built from your chats, from public life, or made up."
    : active === CIRCLES_TAB ? "Group chats, with whoever you put in the room."
    : TABS.find((t) => t.id === active)?.blurb ?? "";

  return (
    <main className="shell wide">
      <header className="page-head">
        <div>
          <p className="mark">Discover</p>
          <h1 className="display">{active === ALL ? "Find your people." : active}</h1>
          <p className="lede">{blurb}</p>
        </div>
      </header>

      <input type="search" className="input search" value={query} placeholder="Search by name, or what they're like" aria-label="Search characters"
        onChange={(e) => setQuery(e.target.value)} />

      <nav className="chips" aria-label="Categories">
        {tabs.map((t) => (
          <button key={t} className="chip" aria-current={t === active ? "true" : undefined} onClick={() => nav.onDiscover(t === ALL ? undefined : t)}>
            {t}
          </button>
        ))}
      </nav>

      {active === CIRCLES_TAB ? (
        <>
          {groups.length > 0 && (
            <div className="card-grid circle-grid">
              {groups.map((c) => <CircleCard key={c.id} circle={c} state={state} update={update} onOpen={nav.onOpenCircle} />)}
            </div>
          )}
          {!groups.length && (
            <div className="empty">
              <p>{q ? `No circle matches “${query}”.` : "No circles yet. Put two or more people in a room and they talk to each other, not just to you."}</p>
              {!q && <button className="btn" onClick={nav.onNewCircle}>Start a circle</button>}
            </div>
          )}
          {groups.length > 0 && <button className="btn-ghost" style={{ marginTop: "1.25rem" }} onClick={nav.onNewCircle}>Start another circle</button>}
        </>
      ) : people.length ? (
        <div className="pgrid">
          {people.map((m) => (
            <PersonCard key={m.id} muse={m} nav={nav} talked={talkedTo(state, m.id)} tag={active === ALL ? tabOf(m) : undefined} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>{q ? `Nobody matches “${query}”.` : active === MADE_TAB ? "You haven’t made anyone yet." : "Nobody here yet."}</p>
          {q
            ? <button className="btn-ghost" onClick={() => setQuery("")}>Clear search</button>
            : <button className="btn" onClick={nav.onCreate}>Make someone</button>}
        </div>
      )}
    </main>
  );
}

function CircleCard({ circle, state, update, onOpen }: { circle: SoloCircle; state: SoloState; update: Update; onOpen: (id: string) => void }) {
  const members = membersOf(state, circle);
  return (
    <div className="card-wrap">
      <button className="muse-card" onClick={() => onOpen(circle.id)}>
        <div className="stack-avatars">
          {members.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} image={m.avatar?.id} />)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{circle.name}</h3>
          <span className="rel">{members.map((m) => m.name).join(", ")}</span>
          <p>
            {circle.topic?.trim() ? `About ${circle.topic.trim()} · ` : ""}
            {plural(state.conversations[circle.id]?.length ?? 0, "message", "messages")}
          </p>
        </div>
      </button>
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

/* --------------------------------------------------------------- chats */

export function Chats({ state, update, nav }: { state: SoloState; update: Update; nav: Nav }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const chats = chatsOf(state);
  const { main, archived } = arrange(chats, { pinned: state.pinned, archived: state.archived, query });
  const row = (id: string) => {
    const c = chats.find((x) => x.id === id)!;
    return (
      <ChatRow key={id} state={state} chat={c}
        pinned={!!state.pinned?.includes(id)} archived={!!state.archived?.includes(id)}
        onOpen={c.circle ? nav.onOpenCircle : nav.onOpen}
        onPin={() => update((cur) => togglePin(cur, id))}
        onArchive={() => update((cur) => toggleArchive(cur, id))} />
    );
  };

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <p className="mark">Chats</p>
          <h1 className="display">Your conversations</h1>
        </div>
        <button className="btn-ghost" onClick={nav.onNewCircle}>New circle</button>
      </header>

      {chats.length === 0 ? (
        <div className="empty">
          <p>No conversations yet. Pick someone and say anything; they will remember it next time.</p>
          <button className="btn" onClick={() => nav.onDiscover()}>Find someone to talk to</button>
        </div>
      ) : (
        <>
          <input type="search" className="input search" value={query} placeholder="Search chats" aria-label="Search chats"
            onChange={(e) => setQuery(e.target.value)} />
          <ul className="chat-list">{main.map((r) => row(r.id))}</ul>
          {query && !main.length && !archived.length && <p className="fine">Nothing matches &ldquo;{query}&rdquo;.</p>}
          {archived.length > 0 && (
            <>
              <button className="link-btn archived-toggle" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
                Archived ({archived.length}) {showArchived ? "▴" : "▾"}
              </button>
              {showArchived && <ul className="chat-list">{archived.map((r) => row(r.id))}</ul>}
            </>
          )}
          <p className="fine" style={{ marginTop: "1.25rem" }}>Swipe a chat left, or hover it, to pin it or put it away.</p>
        </>
      )}
    </main>
  );
}

/* One line of the chat list: who, the last thing said, when, and how many of
   theirs you have not seen. Swipe it left on a phone (or hover it on a computer)
   to pin it or put it away. */
const SWIPE_OPEN = -152;
function ChatRow({ state, chat, pinned, archived, onOpen, onPin, onArchive }: {
  state: SoloState; chat: Chat; pinned: boolean; archived: boolean;
  onOpen: (id: string) => void; onPin: () => void; onArchive: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; sideways: boolean | null } | null>(null);
  const { id, muse, circle, unread } = chat;
  const members = circle ? membersOf(state, circle) : [];

  const touchStart = (e: React.TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, from: dx, sideways: null }; };
  const touchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.touches[0].clientX - s.x, my = e.touches[0].clientY - s.y;
    /* A drag that turns out to be a scroll is a scroll. */
    if (s.sideways === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) s.sideways = Math.abs(mx) > Math.abs(my);
    if (!s.sideways) return;
    setDragging(true);
    setDx(Math.max(SWIPE_OPEN, Math.min(0, s.from + mx)));
  };
  const touchEnd = () => {
    const was = start.current?.sideways;
    start.current = null;
    setDragging(false);
    if (was) setDx((cur) => (cur < SWIPE_OPEN / 2 ? SWIPE_OPEN : 0));
  };

  return (
    <li className="chat-swipe" data-open={dx ? "1" : undefined} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}>
      <div className="chat-actions">
        <button className="chat-action pin" onClick={() => { setDx(0); onPin(); }} tabIndex={-1}>{pinned ? "Unpin" : "Pin"}</button>
        <button className="chat-action archive" onClick={() => { setDx(0); onArchive(); }} tabIndex={-1}>{archived ? "Unarchive" : "Archive"}</button>
      </div>
      <button className={dragging ? "chat-row dragging" : "chat-row"} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onClick={() => { if (dx) setDx(0); else onOpen(id); }}>
        {circle
          ? <div className="stack-avatars" aria-hidden>{members.slice(0, 2).map((m) => <Avatar key={m.id} name={m.name} image={m.avatar?.id} />)}</div>
          : <Avatar name={muse!.name} image={muse!.avatar?.id} ring={unread > 0} />}
        <div className="chat-row-text">
          <div className="chat-row-top">
            <b>{pinned && <span className="chat-row-pin" role="img" aria-label="Pinned">{"\u{1F4CC}"} </span>}{chat.name}</b>
            <span className={unread ? "chat-row-time unread" : "chat-row-time"}>{ago(chat.at)}</span>
          </div>
          <div className="chat-row-bottom">
            <span className="chat-row-preview">{chat.preview}</span>
            {unread > 0 && <span className="chat-row-badge" aria-label={`${unread} unread`}>{unread}</span>}
          </div>
        </div>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------- create */

const WAYS: { key: "invent" | "figure" | "import" | "circle"; title: string; text: string; needs: string; icon: string }[] = [
  {
    key: "invent", title: "Someone you make up",
    text: "Describe them the way you would to a friend: who they are, how they talk, what they are to you.",
    needs: "Nothing to upload",
    icon: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm6.5 12 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z",
  },
  {
    key: "figure", title: "Someone in public life",
    text: "A celebrity, a creator, or a character from a story, built from what they have said in public.",
    needs: "Just their name",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9Z",
  },
  {
    key: "import", title: "From a chat export",
    text: "Reads how someone actually wrote to you, and builds a person who texts the same way.",
    needs: "A chat export file",
    icon: "M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6",
  },
  {
    key: "circle", title: "A circle",
    text: "Put two or more people in one room. They talk to each other, not only to you.",
    needs: "Two people with a full profile",
    icon: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Zm-6 8a6 6 0 0 1 12 0M16.5 11.2a2.8 2.8 0 1 0-1-5.4M17 14.2a5.2 5.2 0 0 1 4 4.8",
  },
];

export function Create({ state, nav }: { state: SoloState; nav: Nav }) {
  const made = inTab(state, MADE_TAB);
  const run = { invent: () => nav.onInvent(), figure: () => nav.onFigure(), import: () => nav.onImport(), circle: nav.onNewCircle };
  return (
    <main className="shell wide">
      <header className="page-head">
        <div>
          <p className="mark">Create</p>
          <h1 className="display">Who do you want to talk to?</h1>
          <p className="lede">Four ways to begin. Each one walks you through it a step at a time, and you can change anything afterwards.</p>
        </div>
      </header>

      <div className="ways">
        {WAYS.map((w) => (
          <button key={w.key} className="way" onClick={run[w.key]}>
            <span className="way-icon"><Icon d={w.icon} size={26} /></span>
            <b>{w.title}</b>
            <span>{w.text}</span>
            <em>{w.needs}</em>
          </button>
        ))}
      </div>

      {made.length > 0 && (
        <section aria-labelledby="h-yours">
          <h2 id="h-yours" className="section-title">People you made</h2>
          <ul className="made-list">
            {made.map((m) => (
              <li key={m.id}>
                <button className="made-open" onClick={() => nav.onProfile(m.id)}>
                  <Avatar name={m.name} image={m.avatar?.id} />
                  <span><b>{m.name}</b><em>{m.relationshipType}</em></span>
                </button>
                <button className="link-btn" onClick={() => nav.onEdit(m.id)}>Edit</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/* ------------------------------------------------------------- profile */

/* Who someone is, before you talk to them and after. Only what is meant to be
   seen: their card, how far the two of you have got, and how many things they
   remember -- never the instructions they run on or what the memories say. */
export function Profile({ muse, state, nav, onBack, onStory, onMemories, onShown }: {
  muse: SoloMuse; state: SoloState; nav: Nav; onBack: () => void; onStory: () => void; onMemories: () => void;
  /** Called once when the profile opens: the moment to make their picture, if they have none. */
  onShown: () => void;
}) {
  useEffect(() => {
    onShown();
    // Once per profile opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muse.id]);
  const shown = shownOf(state, muse.id);
  const last = shown.at(-1);
  const bond = bondOf(state, muse.id, now(), zone());
  const remembered = memoriesOf(state, muse.id).length;
  const first = muse.name.split(" ")[0];
  const langs = muse.languages?.length ? muse.languages.join(", ") : null;

  return (
    <main className="shell profile">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <button className="link-btn back-btn" onClick={onBack}>← Back</button>
        <button className="link-btn" onClick={() => nav.onEdit(muse.id)}>Edit</button>
      </header>

      <div className="profile-hero">
        <Portrait muse={muse} className="portrait-tall" />
        <div className="profile-id">
          <span className="pcard-tag">{tabOf(muse)}</span>
          <h1 className="display">{muse.name}</h1>
          <p className="profile-rel">{muse.relationshipType}</p>
          <p className="profile-desc">{muse.description}</p>
          {muse.traits?.length ? <div className="tags">{muse.traits.map((t) => <span className="tag" key={t}>{t}</span>)}</div> : null}
          <div className="row profile-actions">
            <button className="btn" onClick={() => nav.onOpen(muse.id)}>{last ? `Continue with ${first}` : `Start chatting`}</button>
            <button className="btn-ghost" onClick={() => nav.onCall(muse.id)}>
              <Icon size={17} d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              Call
            </button>
          </div>
        </div>
      </div>

      <div className="facts">
        {bond && (
          <button className="fact" onClick={onStory}>
            <span>You and {first}</span>
            <b>{bond.label}</b>
          </button>
        )}
        <button className="fact" onClick={onMemories} disabled={!remembered}>
          <span>Remembers</span>
          <b>{remembered ? plural(remembered, "thing", "things") : "Nothing yet"}</b>
        </button>
        <div className="fact">
          <span>Last talked</span>
          <b>{last ? ago(Date.parse(last.at)) : "Never"}</b>
        </div>
        {langs && (
          <div className="fact">
            <span>Speaks</span>
            <b>{langs}</b>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <section aria-labelledby="h-lately">
          <div className="section-head">
            <h2 id="h-lately" className="section-title">Lately</h2>
            <button className="more-link" onClick={() => nav.onOpen(muse.id)}>Open chat</button>
          </div>
          <button className="lately" onClick={() => nav.onOpen(muse.id)} aria-label={`Open your chat with ${muse.name}`}>
            {shown.slice(-3).map((m) => (
              <span key={m.id} className={m.from === "user" ? "lately-line mine" : "lately-line"}>{lineOf(m)}</span>
            ))}
          </button>
        </section>
      )}

      {!shown.length && (
        <p className="fine" style={{ marginTop: "1.5rem" }}>
          {muse.name} is an AI character. Say anything to start; what you tell {first} is remembered for next time.
        </p>
      )}
    </main>
  );
}

/* ------------------------------------------------------ you: your data */

/* Shown on the account screen: the texts they send first, and this device's
   copy of everything -- back it up, bring one back, or wipe it. */
export function YourData({ state, update, cloudEmail }: { state: SoloState; update: Update; cloudEmail: string | null }) {
  return (
    <>
      <h2 className="section-title">Texts from them</h2>
      <OutreachPanel state={state} update={update} />

      <h2 className="section-title">Your data</h2>
      <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <button className="btn-ghost" onClick={() => download(safeFilename("muse-solo", "json"), JSON.stringify(state, null, 2), "application/json")}>
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
              const warning = has ? "\n\nThis REPLACES everything currently in this browser. Export first if you are not sure." : "";
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
            const built = state.muses.length;
            const msg = built
              ? `Delete everything in this browser?\n\nThat includes the ${built} ${built === 1 ? "character" : "characters"} you made, every conversation, and everything they remember. It cannot be undone.`
              : "Delete every conversation and memory in this browser? This cannot be undone.";
            if (!confirm(msg)) return;
            update({ userName: state.userName, muses: [], conversations: {}, memories: [] });
          }}
        >
          Delete everything
        </button>
      </div>

      <p className="fine" style={{ marginTop: "1.5rem" }}>
        Every Muse is an AI.{" "}
        {cloudEmail
          ? "You're signed in, so a copy of your people, chats and memories is stored on the server to sync between your devices. Photos, voice notes and videos stay on the device that made them."
          : "Your people, conversations and memories are never stored on a server — clearing this browser's data deletes them all, and there is no way to get them back."}
        {settingsOf(state).proactiveEnabled &&
          " The one exception: a text someone has scheduled to send you waits on the server until it is sent."}
      </p>
    </>
  );
}
