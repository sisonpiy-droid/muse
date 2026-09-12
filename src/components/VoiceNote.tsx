"use client";

import { useEffect, useRef, useState } from "react";

import { speechFor } from "@/lib/solo/audio";

/* Hearing a message instead of reading it.
 *
 * One button on a Muse's own messages. Not on the user's own — reading your own
 * words back to you in someone else's voice is a strange thing to offer.
 *
 * Speech is generated on demand rather than with the reply. It costs per
 * character and takes about a second a sentence, so doing it to every message
 * would make every turn slow and expensive for something most messages do not
 * need. The first play waits; every play after that is instant and free,
 * because the audio is cached on the device.
 *
 * The button is deliberately quiet until used. A row of play controls down the
 * side of a conversation turns a thread into a media library.
 */

type State = "idle" | "loading" | "playing" | "error";

export function VoiceNote({ text, voice, name }: { text: string; voice: string; name: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  /* An object URL is a live handle to a blob; without revoking it the audio
     stays in memory for the life of the tab, and a long conversation played
     through would hold every clip at once. */
  useEffect(() => {
    return () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  async function play() {
    if (state === "loading") return;

    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }

    // Already fetched once this session: just play it again.
    if (audio.current && url.current) {
      audio.current.currentTime = 0;
      void audio.current.play();
      setState("playing");
      return;
    }

    setState("loading");
    setError(null);
    try {
      const blob = await speechFor(text, voice);
      const href = URL.createObjectURL(blob);
      url.current = href;

      const el = new Audio(href);
      el.onended = () => setState("idle");
      el.onpause = () => setState((s) => (s === "playing" ? "idle" : s));
      el.onerror = () => { setError("That wouldn't play."); setState("error"); };
      audio.current = el;

      await el.play();
      setState("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That couldn't be played.");
      setState("error");
    }
  }

  return (
    <span className="voice">
      <button
        type="button"
        onClick={play}
        aria-label={
          state === "playing" ? `Stop ${name}'s voice note` : `Hear this in ${name}'s voice`
        }
        title={state === "error" ? error ?? undefined : `Hear this in ${name}'s voice`}
        data-state={state}
      >
        {state === "loading" ? (
          <i className="voice-wait" aria-hidden />
        ) : state === "playing" ? (
          "■"
        ) : (
          "▶"
        )}
        <span className="sr-only">
          {state === "loading" ? "Preparing" : state === "playing" ? "Stop" : "Play"}
        </span>
      </button>
      {state === "error" && error && <em>{error}</em>}
    </span>
  );
}
