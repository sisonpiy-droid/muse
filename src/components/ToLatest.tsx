"use client";

import { useEffect, useState } from "react";

/* Scrolled up to read something older: one tap back to the newest message.
   Sits on the composer's top edge, and only while you are far from the end. */

const FAR_PX = 600;

export function ToLatest() {
  const [far, setFar] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      setFar(el.scrollHeight - el.scrollTop - el.clientHeight > FAR_PX);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!far) return null;
  return (
    <button
      className="to-latest"
      aria-label="Go to the latest message"
      onClick={() => window.scrollTo({ top: (document.scrollingElement ?? document.documentElement).scrollHeight, behavior: "smooth" })}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
      </svg>
    </button>
  );
}
