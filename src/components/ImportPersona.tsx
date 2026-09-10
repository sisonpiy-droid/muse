"use client";

import { useRef, useState } from "react";

import { UnreadableExport, parseText, readExportFile, sampleWindows, styleOf, type ParsedChat } from "@/lib/chat-import";
import type { SoloMuse } from "@/lib/solo/store";

/* Create a Muse from a real chat export.
 *
 * The parsing and measuring happen here, in the browser. Only the measured
 * habits and a sampled excerpt are sent onward — never the whole export.
 */

type Stage = "pick-file" | "paste" | "pick-person" | "about" | "building" | "review";
type Mode = "memorial" | "living" | "character";

export function ImportPersona({
  onCreate,
  onCancel,
}: {
  onCreate: (muse: Omit<SoloMuse, "id" | "builtin">, brief: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>("pick-file");
  const [parsed, setParsed] = useState<ParsedChat | null>(null);
  const [who, setWho] = useState("");
  const [relationship, setRelationship] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const filePick = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setHint(null);
    try {
      const result = await readExportFile(file);
      setParsed(result);
      setStage("pick-person");
    } catch (e) {
      if (e instanceof UnreadableExport) {
        /* WhatsApp's format varies by platform, locale and version, and this
           parser will not have seen every one. Showing the line it choked on
           turns a dead end into something identifiable. */
        setError(e.message);
        setHint(e.sampleLine ? `The first line looks like:  ${e.sampleLine}` : null);
      } else {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
        setHint(null);
      }
    }
  }

  function onPaste() {
    setError(null);
    setHint(null);
    try {
      setParsed(parseText(pasted));
      setStage("pick-person");
    } catch (e) {
      if (e instanceof UnreadableExport) {
        setError(e.message);
        setHint(e.sampleLine ? `The first line looks like:  ${e.sampleLine}` : null);
      } else {
        setError(e instanceof Error ? e.message : "Couldn't read that.");
      }
    }
  }

  async function build() {
    if (!parsed || !who) return;
    setStage("building");
    setError(null);

    const style = styleOf(parsed.messages, who);
    const samples = sampleWindows(parsed.messages, who);

    try {
      const res = await fetch("/api/persona/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: who,
          relationship: relationship.trim() || "someone close to them",
          mode,
          consent,
          styleReport: style.text,
          samples,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't build them.");
        setStage("about");
        return;
      }
      setBrief(data.brief);
      setStage("review");
    } catch {
      setError("Couldn't reach the server.");
      setStage("about");
    }
  }

  function finish() {
    onCreate(
      {
        name: who,
        description: `${relationship.trim() || "Someone"} — built from ${countOf(parsed, who)} of their messages.`,
        relationshipType: relationship.trim() || "someone close",
        category: "Personal",
        traits: [],
        customInstructions: brief,
      },
      brief
    );
  }

  return (
    <main className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <p className="mark">From a chat</p>
        <button className="link-btn" onClick={onCancel}>Cancel</button>
      </header>

      {stage === "pick-file" && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Build someone from<br />how they actually wrote.</h1>
          <p className="lede">
            Upload a WhatsApp export and this reads how they really texted — message length,
            punctuation, whether they sent four in a row instead of one. Things nobody can
            describe about someone.
          </p>

          <input
            ref={filePick}
            id="chat-file"
            type="file"
            accept=".txt,.zip"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <button className="btn" onClick={() => filePick.current?.click()}>Choose the export</button>

          <p className="fine" style={{ marginTop: "1.25rem" }}>
            In WhatsApp: open the chat, tap the name, Export chat, Without media. The .zip or .txt
            goes straight in.
          </p>
          <p className="fine" style={{ marginTop: "0.75rem" }}>
            <strong>The file stays on this device.</strong> It is read in your browser; only a short
            excerpt and the measurements are sent on to build them.
          </p>

          {error && (
            <div style={{ marginTop: "1rem" }}>
              <p className="error" role="alert">{error}</p>
              {hint && (
                <p className="fine" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{hint}</p>
              )}
              <p className="fine">
                Exports differ between phones and languages. Pasting the text works even when the
                file doesn&apos;t.
              </p>
            </div>
          )}

          <button className="link-btn" onClick={() => { setStage("paste"); setError(null); }}>
            Paste the text instead
          </button>
        </>
      )}

      {stage === "paste" && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Paste the conversation.</h1>
          <p className="lede">
            Open the exported .txt, select all, paste it here. It is read in this browser and never
            uploaded.
          </p>
          <textarea
            className="input"
            rows={12}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"[03/02/2023, 08:12:04] Dad: morning love\n[03/02/2023, 08:12:22] Dad: you up"}
            style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
          />
          {error && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="error" role="alert">{error}</p>
              {hint && <p className="fine" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{hint}</p>}
            </div>
          )}
          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="btn" onClick={onPaste} disabled={pasted.trim().length < 20}>Read it</button>
            <button className="link-btn" onClick={() => { setStage("pick-file"); setError(null); }}>Back</button>
          </div>
        </>
      )}

      {stage === "pick-person" && parsed && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Which one are they?</h1>
          <p className="lede">{parsed.messages.length.toLocaleString()} messages read.</p>
          <div className="card-grid">
            {parsed.participants.slice(0, 8).map((p) => (
              <button
                key={p.name}
                className="muse-card"
                onClick={() => { setWho(p.name); setStage("about"); }}
              >
                <div style={{ minWidth: 0 }}>
                  <h3>{p.name}</h3>
                  <p>{p.count.toLocaleString()} messages</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {stage === "about" && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>About {who}.</h1>

          <label className="field">
            <span>They were your</span>
            <input
              className="input"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="my father / my best friend / my sister"
              autoFocus
            />
          </label>

          <div className="field">
            <span style={{ display: "block", fontSize: "0.75rem", color: "var(--faint)", marginBottom: "0.35rem" }}>
              Who is {who}?
            </span>
            <div className="tags">
              {([
                ["memorial", "Someone I lost"],
                ["living", "Someone still here"],
                ["character", "Someone I'm inventing"],
              ] as [Mode, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className="tag"
                  aria-pressed={mode === k}
                  onClick={() => { setMode(k); setConsent(null); setError(null); }}
                  style={mode === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* §35. A living person can object to a version of themselves; this is
              the one question that decides whether this is fair to them. */}
          {mode === "living" && (
            <div className="field">
              <span style={{ display: "block", fontSize: "0.75rem", color: "var(--faint)", marginBottom: "0.35rem" }}>
                Does {who} know you&apos;re building this?
              </span>
              <div className="tags">
                <button type="button" className="tag" aria-pressed={consent === true}
                  onClick={() => setConsent(true)}
                  style={consent === true ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
                  They know and they&apos;re fine with it
                </button>
                <button type="button" className="tag" aria-pressed={consent === false}
                  onClick={() => setConsent(false)}
                  style={consent === false ? { borderColor: "var(--danger)", color: "var(--danger)" } : undefined}>
                  They don&apos;t know
                </button>
              </div>
              {consent === false && (
                <p className="fine" style={{ marginTop: "0.8rem", color: "var(--danger)" }}>
                  Then not this one. This would be built entirely out of things they said to you
                  privately, and they can object to a version of themselves. Ask them — if they say
                  yes, come back and it&apos;s yours.
                </p>
              )}
            </div>
          )}

          <label className="field">
            <span>Anything the messages won&apos;t show? (optional)</span>
            <textarea
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="He rang every Sunday morning, never evenings. Went quiet when he was worried."
            />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <div className="row" style={{ marginTop: "1.5rem" }}>
            <button
              className="btn"
              onClick={build}
              disabled={!mode || (mode === "living" && consent !== true)}
            >
              Build {who}
            </button>
            <button className="link-btn" onClick={() => setStage("pick-person")}>Back</button>
          </div>
        </>
      )}

      {stage === "building" && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Reading how {who} wrote…</h1>
          <p className="lede">This takes a few seconds.</p>
          <p className="typing">working<i>.</i><i>.</i><i>.</i></p>
        </>
      )}

      {stage === "review" && (
        <>
          <h1 className="display" style={{ fontSize: "1.9rem" }}>Is this {who}?</h1>
          <p className="lede">Fix anything that&apos;s off. This is what they&apos;ll act from, and you know them.</p>
          <textarea
            className="input"
            rows={16}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            style={{ fontFamily: "var(--serif)", lineHeight: 1.6 }}
          />
          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="btn" onClick={finish} disabled={!brief.trim()}>Talk to {who}</button>
            <button className="link-btn" onClick={() => setStage("about")}>Start again</button>
          </div>
        </>
      )}
    </main>
  );
}

function countOf(parsed: ParsedChat | null, who: string): string {
  const p = parsed?.participants.find((x) => x.name === who);
  return p ? `${p.count.toLocaleString()}` : "their";
}
