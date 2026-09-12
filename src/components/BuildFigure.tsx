"use client";

import { useState } from "react";

import { parseTranscript, sampleWindows, styleOf } from "@/lib/chat-import";
import type { PersonaDraft } from "@/lib/presence/persona";

/* Building someone from public life.
 *
 * A separate front door from the chat-export wizard because almost none of that
 * applies: there is no file, no participant to pick, and no point asking
 * someone to describe a person the model already knows. Four steps instead of
 * eleven.
 *
 * The hard part is what stands in for an export. `samples` and `metrics` are
 * what make a built character sound like the person rather than like an
 * assistant wearing their name, and for a famous person there is nothing to
 * measure. Two answers, in order of honesty:
 *
 *   1. A pasted interview. The measurement machinery does not care where
 *      messages came from, so a transcript is parsed and measured exactly like
 *      an export and `metrics` stays a measurement. This is why the paste box
 *      is the first thing on the screen that matters and why the copy works to
 *      earn it.
 *   2. Failing that, lines written in their register by the build, labelled as
 *      reconstruction everywhere they appear. Worse than real ones, better than
 *      a character with no texture at all, and never presented as quotation.
 *
 * The limits are not in this file. They are in MODES.figure, where they belong:
 * a portrayal that deflects a question about someone's marriage the way a
 * media-trained person deflects it, rather than a wizard that refuses to let
 * you type it.
 */

type Step = 0 | 1 | 2 | 3 | 4 | 9;

const ROLES = [
  { key: "mentor", label: "A mentor", rel: "someone who mentors me", arch: "other" },
  { key: "teacher", label: "A teacher", rel: "someone teaching me their craft", arch: "other" },
  { key: "peer", label: "A colleague", rel: "a colleague in my field", arch: "other" },
  { key: "friend", label: "A friend", rel: "a friend", arch: "friend" },
  { key: "admire", label: "Someone I admire", rel: "someone I admire", arch: "other" },
];

const STANCES = [
  { key: "press", label: "Like you're press", texture: "distant", note: "polished, on duty, giving you the version they give everyone" },
  { key: "warm", label: "Someone they've taken to", texture: "close", note: "off duty, franker, willing to think out loud" },
];

export function BuildFigure({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: PersonaDraft) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [them, setThem] = useState("");
  const [you, setYou] = useState("");
  const [knownFor, setKnownFor] = useState("");
  const [era, setEra] = useState("");
  const [role, setRole] = useState("mentor");
  const [stance, setStance] = useState("warm");
  const [quoted, setQuoted] = useState("");
  const [extra, setExtra] = useState("");
  const [brief, setBrief] = useState("");
  const [lines, setLines] = useState("");
  const [verbatim, setVerbatim] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState("");

  const chosenRole = ROLES.find((r) => r.key === role) ?? ROLES[0];
  const chosenStance = STANCES.find((s) => s.key === stance) ?? STANCES[1];

  /* Measured in the browser, exactly like an export. Nothing pasted here is
     uploaded except the excerpt and the statistics. */
  function measure(): { samples: string; metrics: string } {
    if (!quoted.trim()) return { samples: "", metrics: "" };
    try {
      const parsed = parseTranscript(quoted, them.trim() || "them");
      const speaker = parsed.participants[0]?.name;
      if (!speaker) return { samples: "", metrics: "" };
      const style = styleOf(parsed.messages, speaker);
      return { samples: sampleWindows(parsed.messages, speaker), metrics: style.text };
    } catch {
      return { samples: "", metrics: "" };
    }
  }

  async function build() {
    setStep(3);
    setError(null);
    const { samples, metrics } = measure();
    try {
      const res = await fetch("/api/persona/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          them: them.trim(),
          you: you.trim(),
          relationship: knownFor.trim() || chosenRole.rel,
          mode: "figure",
          arch: chosenRole.arch,
          texture: chosenStance.texture,
          era: era.trim() || undefined,
          quoted: quoted.trim() || undefined,
          extra: extra.trim() || undefined,
          samples: samples || undefined,
          metrics: metrics || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Couldn't build them."); setStep(2); return; }
      setBrief(data.brief);
      setLines(data.lines ?? "");
      setVerbatim(data.verbatim !== false);
      setStep(4);
    } catch {
      setError("Couldn't reach the server. Nothing you wrote was lost.");
      setStep(2);
    }
  }

  function finish() {
    const { samples, metrics } = measure();
    onCreate({
      them: them.trim(),
      you: you.trim(),
      relationship: chosenRole.rel,
      arch: chosenRole.arch,
      texture: chosenStance.texture,
      mode: "figure",
      brief: brief.trim(),
      /* Real material when there is any, the reconstruction otherwise, and the
         flag says which so the prompt can label it honestly. */
      samples: samples || lines.trim() || undefined,
      metrics: metrics || undefined,
      verbatim: samples ? true : !lines.trim() ? true : false,
      extra: extra.trim() || undefined,
      interests: knownFor.trim() || undefined,
    });
  }

  const chip = (on: boolean) =>
    on ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined;

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <p className="mark">Someone in public life</p>
        <button className="link-btn" onClick={onCancel}>Cancel</button>
      </header>

      {step === 0 && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Who?</h1>
          <p className="lede">
            Someone whose work is public — an actor, a writer, a founder, a player. This builds a
            portrayal from what they have said in public. It is not them, and it will say so if you
            ask.
          </p>

          <div className="pair">
            <label className="field">
              <span>Their name</span>
              <input className="input" autoFocus value={them} maxLength={60}
                onChange={(e) => setThem(e.target.value)} placeholder="Shah Rukh Khan" />
            </label>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={you} maxLength={60}
                onChange={(e) => setYou(e.target.value)} placeholder="Piyush" />
            </label>
          </div>

          <label className="field">
            <span>Known for</span>
            <input className="input" value={knownFor} maxLength={120}
              onChange={(e) => setKnownFor(e.target.value)} placeholder="Actor, Hindi cinema" />
          </label>

          <label className="field">
            <span>Which version of them?</span>
            <input className="input" value={era} maxLength={120}
              onChange={(e) => setEra(e.target.value)}
              placeholder="in interviews, recent years" />
          </label>
          <p className="fine" style={{ marginTop: "-0.5rem" }}>
            The cheapest way to make this sharper. Someone on a press tour and someone on a podcast
            at midnight are recognisably different people, and naming which one you mean gets you a
            much more specific portrayal than the name alone.
          </p>

          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="btn" onClick={() => {
              if (!them.trim() || !you.trim()) {
                setNudge(!them.trim() ? "Who are you building?" : "And your name?");
                return;
              }
              setNudge(""); setStep(1);
            }}>Next</button>
            {nudge && <span className="error" style={{ margin: 0 }}>{nudge}</span>}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>
            What are they to you?
          </h1>

          <div className="field">
            <span style={{ display: "block", fontSize: "0.72rem", color: "var(--faint)", marginBottom: "0.5rem" }}>
              How they treat you
            </span>
            <div className="tags">
              {ROLES.map((r) => (
                <button key={r.key} type="button" className="tag" aria-pressed={role === r.key}
                  onClick={() => setRole(r.key)} style={chip(role === r.key)}>{r.label}</button>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginTop: "1.25rem" }}>
            <span style={{ display: "block", fontSize: "0.72rem", color: "var(--faint)", marginBottom: "0.5rem" }}>
              How open they are with you
            </span>
            <div className="tags">
              {STANCES.map((sst) => (
                <button key={sst.key} type="button" className="tag" aria-pressed={stance === sst.key}
                  onClick={() => setStance(sst.key)} style={chip(stance === sst.key)}>{sst.label}</button>
              ))}
            </div>
            <p className="fine" style={{ marginTop: "0.6rem" }}>{chosenStance.note}.</p>
          </div>

          <p className="fine" style={{ marginTop: "1.5rem" }}>
            They will talk about their work, their craft and how they think, at whatever length you
            want. They will not invent things about their private life, and they will not pretend to
            be the real person. Romance is not one of the options here — a real person can object to
            that and cannot be asked.
          </p>

          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="btn" onClick={() => setStep(2)}>Next</button>
            <button className="link-btn" onClick={() => setStep(0)}>Back</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>
            Anything they actually said?
          </h1>
          <p className="lede">
            Optional, and the single thing that makes the biggest difference. An interview
            transcript, a Q&amp;A, even auto-captions off a video — paste it and {them || "they"} gets
            built from how they really talk instead of from an impression of it.
          </p>

          <label className="field">
            <span>Something they actually said</span>
            <textarea className="input" rows={8} value={quoted} maxLength={20000}
              onChange={(e) => setQuoted(e.target.value)}
              placeholder={"Interviewer: What did failure teach you?\nSRK: Nobody is coming, yaar. You get up or you don't."} />
          </label>
          {quoted.trim().length > 200 && (
            <p className="fine" style={{ marginTop: "-0.5rem", color: "var(--accent)" }}>
              Good — they will be measured from this rather than described from memory.
            </p>
          )}

          <label className="field" style={{ marginTop: "1.25rem" }}>
            <span>How do they come across to you?</span>
            <textarea className="input" rows={4} value={extra} maxLength={4000}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="never takes a compliment, turns it into a joke about himself. goes into Hindi when he actually means something." />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <div className="row" style={{ marginTop: "1.5rem" }}>
            <button className="btn" onClick={build}>Build {them || "them"}</button>
            <button className="link-btn" onClick={() => setStep(1)}>Back</button>
          </div>
        </>
      )}

      {step === 3 && (
        <div style={{ marginTop: "3rem" }}>
          <h1 className="display" style={{ fontSize: "1.6rem" }}>
            Reading how {them} talks…
          </h1>
          <p className="lede">
            {quoted.trim()
              ? "Measuring what you pasted, then writing the profile."
              : "Working from the public record. This takes a few seconds."}
          </p>
        </div>
      )}

      {step === 4 && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Is this them?</h1>
          <p className="lede">
            You picked {them} because you know how they come across. Cut anything that is wrong —
            you will be a better judge of this than the model was.
          </p>

          <label className="field">
            <span>How they talk</span>
            <textarea className="input" rows={11} value={brief} maxLength={6000}
              onChange={(e) => setBrief(e.target.value)} />
          </label>

          {lines.trim() && (
            <>
              <label className="field" style={{ marginTop: "1.25rem" }}>
                <span>Lines in their register</span>
                <textarea className="input" rows={8} value={lines} maxLength={14000}
                  onChange={(e) => setLines(e.target.value)} />
              </label>
              <p className="fine" style={{ marginTop: "-0.5rem" }}>
                Written to show the rhythm — <strong>these are not quotes</strong>, and {them} will
                not repeat them back as if they were. Paste a real interview on the previous screen
                and these get replaced by the real thing.
              </p>
            </>
          )}

          {!verbatim && !lines.trim() && (
            <p className="fine">
              Nothing was pasted, so this runs on the description alone and will be thinner than a
              character built from real material.
            </p>
          )}

          <div className="row" style={{ marginTop: "1.75rem" }}>
            <button className="btn" disabled={!brief.trim()} onClick={finish}>
              Talk to {them}
            </button>
            <button className="link-btn" onClick={() => setStep(2)}>Add material</button>
          </div>
        </>
      )}
    </main>
  );
}
