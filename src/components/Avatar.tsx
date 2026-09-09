/* §48: every Muse needs to feel visually distinct, and MVP may use generated
   avatars. The hue is derived from the name, so a Muse looks the same
   everywhere without storing an image or calling anything. */

function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const hue = hueOf(name);
  return (
    <div
      className={large ? "avatar avatar-lg" : "avatar"}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 74%), hsl(${(hue + 48) % 360} 58% 62%))`,
      }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}
