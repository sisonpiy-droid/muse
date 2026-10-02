"use client";

import { useEffect, useState } from "react";

import { photoUrl } from "@/lib/solo/photos";

/* A photo in the thread. Sized from its stored dimensions before it loads, so
   the conversation does not jump as pictures arrive; tap to see it full screen. */
export function Photo({ id, w, h }: { id: string; w: number; h: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let live = true;
    void photoUrl(id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [id]);

  return (
    <>
      <button
        type="button"
        className="photo"
        style={{ aspectRatio: `${w} / ${h}` }}
        onClick={() => url && setBig(true)}
        aria-label="Open photo"
      >
        {/* A local file from IndexedDB (an object URL): nothing for next/image to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" /> : <span className="photo-missing">photo</span>}
      </button>
      {big && url && (
        <div className="photo-full" role="dialog" aria-label="Photo" onClick={() => setBig(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" />
        </div>
      )}
    </>
  );
}
