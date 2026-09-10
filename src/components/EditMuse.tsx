"use client";

import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import {
  ARCHETYPES, DEFAULT_FEELINGS, MOODS, TEXTURES, WARMTHS,
  type Feelings,
} from "@/lib/presence/persona";
import type { MusePatch, SoloMuse } from "@/lib/solo/store";

/* Changing who someone is, and how they are.
 *
 * Two things that sound similar and are not. The top half is the persona --
 * who this person is, permanently, the same material the build wizard collects.
 * The bottom half is their standing state: what is going on with them at the
 * moment, which is meant to change every so often while the persona does not.
 *
 * Both are on one screen because the alternative is making someone guess which
 * of two menus holds the thing they want to change.
 *
 * Nothing is written until Save. Editing in place while a conversation is open
 * would mean half-finished changes taking effect mid-thread, and a character
 * whose personality shifted between two messages for no visible reason.
 */

const labelStyle = {
  display: "block",
  fontSize: "0.72rem",
  color: "var(--faint)",
  marginBottom: "0.5rem",
} as const;

export function EditMuse({
  muse, feelings, resettable, onSave, onReset, onCancel,
}: {
  muse: SoloMuse;
  feelings: Feelings;
  /** True when this is a starter with something to revert -- a changed profile,
   *  a standing state, or both. Never true for a character the user built:
   *  there is no original to go back to. */
  resettable: boolean;
  onSave: (patch: MusePatch, feelings: Feelings) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const p = muse.persona;
  const was = {
    name: muse.name,
    rel: muse.relationshipType,
    description: muse.description,
    traits: muse.traits ?? [],
    brief: p?.brief ?? muse.brief ?? "",
    samples: p?.samples ?? muse.samples ?? "",
    extra: p?.extra ?? muse.extra ?? "",
    arch: p?.arch ?? muse.arch ?? "other",
    texture: p?.texture ?? muse.texture ?? "close",
  };

  const [name, setName] = useState(was.name);
  const [rel, setRel] = useState(was.rel);
  const [description, setDescription] = useState(was.description);
  const [traits, setTraits] = useState<string[]>(was.traits);
  const [trait, setTrait] = useState("");
  const [brief, setBrief] = useState(was.brief);
  const [samples, setSamples] = useState(was.samples);
  const [extra, setExtra] = useState(was.extra);
  const [arch, setArch] = useState(was.arch);
  const [texture, setTexture] = useState(was.texture);
  const [feel, setFeel] = useState<Feelings>(feelings ?? DEFAULT_FEELINGS);

  /* Functional updates throughout. Three quick chip clicks all read the same
     stale array otherwise, and only the last one survives. */
  const dropTrait = (t: string) => setTraits((cur) => cur.filter((x) => x !== t));
  const addTrait = () => {
    const t = trait.trim().toLowerCase();
    if (!t) return;
    setTraits((cur) => (cur.includes(t) || cur.length >= 8 ? cur : [...cur, t]));
    setTrait("");
  };

  const dirty =
    name !== was.name ||
    rel !== was.rel ||
    description !== was.description ||
    traits.join("|") !== was.traits.join("|") ||
    brief !== was.brief ||
    samples !== was.samples ||
    extra !== was.extra ||
    arch !== was.arch ||
    texture !== was.texture ||
    feel.mood !== feelings.mood ||
    feel.warmth !== feelings.warmth ||
    feel.note !== feelings.note;

  function save() {
    if (!name.trim()) return;
    onSave(
      {
        name: name.trim(),
        relationshipType: rel.trim() || "someone close",
        description: description.trim() || muse.description,
        traits,
        brief: brief.trim(),
        samples: samples.trim(),
        extra: extra.trim(),
        arch,
        texture,
      },
      { ...feel, note: feel.note.trim() }
    );
  }

  const chips = (
    options: Record<string, { label: string }>,
    value: string,
    set: (k: string) => void
  ) => (
    <div className="tags">
      {Object.entries(options).map(([k, v]) => (
        <button
          key={k}
          type="button"
          className="tag"
          aria-pressed={value === k}
          onClick={() => set(k)}
          style={value === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <p className="mark">Edit</p>
        <button className="link-btn" onClick={onCancel}>Cancel</button>
      </header>

      <div className="row" style={{ gap: "0.75rem", marginTop: "1.5rem", alignItems: "center" }}>
        <Avatar name={name || muse.name} />
        <div style={{ minWidth: 0 }}>
          <h1 className="display" style={{ fontSize: "1.6rem", margin: 0 }}>{name || muse.name}</h1>
          <p className="fine" style={{ margin: 0 }}>
            {muse.builtin
              ? "One of the people who came with the app. Changes stay in this browser, and the original is always one tap away."
              : "Someone you built. Editing keeps everything they remember."}
          </p>
        </div>
      </div>

      {/* ----------------------------------------------------- who they are */}
      <h2 className="section-title">Who they are</h2>

      <div className="pair">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="field">
          <span>What they are to you</span>
          <input
            className="input"
            value={rel}
            onChange={(e) => setRel(e.target.value)}
            placeholder="best friend"
            maxLength={40}
          />
        </label>
      </div>

      <label className="field">
        <span>One line, for their card</span>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
      </label>

      <div className="field">
        <span style={labelStyle}>Traits</span>
        {traits.length > 0 && (
          <div className="tags">
            {traits.map((t) => (
              <button
                key={t}
                type="button"
                className="tag"
                onClick={() => dropTrait(t)}
                aria-label={`Remove ${t}`}
              >
                {t} &times;
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: "0.5rem", maxWidth: "22rem" }}>
          <input
            className="input"
            value={trait}
            onChange={(e) => setTrait(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrait(); } }}
            placeholder={traits.length >= 8 ? "That is plenty" : "Add a trait"}
            maxLength={30}
            disabled={traits.length >= 8}
            aria-label="Add a trait"
          />
          <button className="btn-ghost" type="button" onClick={addTrait} disabled={!trait.trim()}>
            Add
          </button>
        </div>
      </div>

      <label className="field" style={{ marginTop: "1.25rem" }}>
        <span>How they talk, and what they are like</span>
        <textarea
          className="input"
          rows={7}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Written to them, in the second person. &ldquo;You write in short lowercase bursts, two or three in a row rather than one tidy message...&rdquo;"
          maxLength={6000}
        />
      </label>
      <p className="fine" style={{ marginTop: "-0.4rem" }}>
        The field that does the most work. Be forensic about mechanics &mdash; capitalisation,
        punctuation, message length, whether they send four short messages or one long one.
      </p>

      <label className="field" style={{ marginTop: "1.25rem" }}>
        <span>Things they actually say</span>
        <textarea
          className="input"
          rows={6}
          value={samples}
          onChange={(e) => setSamples(e.target.value)}
          placeholder={"One message per line.\nok but what did you actually say to him\nno. not what you meant. what you SAID"}
          maxLength={14000}
        />
      </label>
      <p className="fine" style={{ marginTop: "-0.4rem" }}>
        Real lines, not descriptions of them. This is what gets copied rather than paraphrased, so
        four blunt examples beat a paragraph about their sense of humour.
      </p>

      <label className="field" style={{ marginTop: "1.25rem" }}>
        <span>Also true of them</span>
        <textarea
          className="input"
          rows={4}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Habits, opinions, what they always steer the conversation back to."
          maxLength={4000}
        />
      </label>

      <div className="pair" style={{ marginTop: "1.25rem" }}>
        <div>
          <span style={labelStyle}>What kind of relationship</span>
          {chips(ARCHETYPES, arch, setArch)}
        </div>
        <div>
          <span style={labelStyle}>And how it feels</span>
          {chips(TEXTURES, texture, setTexture)}
        </div>
      </div>

      {/* ---------------------------------------------------- how they feel */}
      <h2 className="section-title">How they&rsquo;re feeling</h2>
      <p className="fine" style={{ marginTop: "-0.4rem" }}>
        A standing state, not a one-off. It carries between conversations and stays true until you
        change it. For something that only applies to today, use{" "}
        <em>Change how this goes</em> in the chat instead.
      </p>

      <div style={{ marginTop: "1.25rem" }}>
        <span style={labelStyle}>What sort of period they&rsquo;re having</span>
        {chips(MOODS, feel.mood, (k) => setFeel((f) => ({ ...f, mood: k })))}
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <span style={labelStyle}>Where things stand between you</span>
        {chips(WARMTHS, feel.warmth, (k) => setFeel((f) => ({ ...f, warmth: k })))}
      </div>

      <label className="field" style={{ marginTop: "1.25rem" }}>
        <span>What is going on with them right now</span>
        <textarea
          className="input"
          rows={3}
          value={feel.note}
          onChange={(e) => setFeel((f) => ({ ...f, note: e.target.value }))}
          placeholder="Her thesis is due in a fortnight and she has not slept properly in a week."
          maxLength={600}
        />
      </label>
      <p className="fine" style={{ marginTop: "-0.4rem" }}>
        They will not announce any of this. It shows up in what they notice first and how much
        patience they have.
      </p>

      {/* ----------------------------------------------------------- saving */}
      <div className="row" style={{ marginTop: "2rem", gap: "0.75rem" }}>
        <button className="btn" onClick={save} disabled={!name.trim() || !dirty}>
          {dirty ? "Save changes" : "Nothing changed"}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        {resettable && (
          <button
            className="link-btn"
            onClick={() => {
              if (confirm(`Put ${muse.name} back to how they shipped?\n\nThis undoes your changes and clears how they are feeling. Your conversation and everything they remember is kept.`)) {
                onReset();
              }
            }}
          >
            Reset to original
          </button>
        )}
      </div>

      <p className="fine" style={{ marginTop: "2rem" }}>
        Changes apply from your next message. Nothing already said changes, and {muse.name} keeps
        everything they remember about you.
      </p>
    </main>
  );
}
