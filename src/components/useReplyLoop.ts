"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* When a reply gets asked for, so that double-texting works.
 *
 * Sending used to ask for a reply straight away and lock the composer until it
 * came back, so two texts in a row were impossible: the second could not be
 * sent, and if it could have been it would have got its own separate answer.
 * People text in runs. So a send now waits for a short pause first, and every
 * message sent inside that pause is answered together, as one turn.
 *
 * Typing holds it too. Someone halfway through their second message has not
 * finished talking, and a reply landing on top of them is an interruption.
 *
 * A message sent while a reply is already being written is not lost and not
 * interrupted: the reply finishes, and then the loop goes round again for what
 * arrived during it. Only `restart` throws a reply away -- that is for an edit,
 * where what was being answered no longer exists.
 */

/** How long after a send before asking for a reply. */
export const REPLY_PAUSE_MS = 1600;
/** How long a reply waits once someone starts typing again. */
export const TYPING_PAUSE_MS = 3500;

export function useReplyLoop(run: (signal: AbortSignal) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const again = useRef(false);

  /* The latest `run`, so a timer set several renders ago still reads the
     thread as it is now rather than as it was when the timer started. */
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    []
  );

  async function fire() {
    timer.current = null;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setBusy(true);
    try {
      await runRef.current(ctrl.signal);
    } finally {
      const wasCurrent = inFlight.current === ctrl;
      if (wasCurrent) inFlight.current = null;
      if (!inFlight.current) setBusy(false);
      if (wasCurrent && again.current) {
        again.current = false;
        schedule();
      }
    }
  }

  function schedule(delay = REPLY_PAUSE_MS) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fire(), delay);
  }

  /** Someone is typing: push back a reply that has not started yet. */
  function hold() {
    if (timer.current) schedule(TYPING_PAUSE_MS);
  }

  /** Drop whatever is being written and answer the thread as it is now. */
  function restart(delay = 250) {
    inFlight.current?.abort();
    inFlight.current = null;
    again.current = false;
    schedule(delay);
  }

  return { busy, schedule, hold, restart };
}
