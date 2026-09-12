/* The voices a character can speak in.
 *
 * Gemini's prebuilt voices are named after stars and moons — Kore, Fenrir,
 * Callirrhoe — which tells someone choosing one absolutely nothing. Every name
 * here is described by how it sounds and who it suits, because the question a
 * user is actually answering is "what does Aditi sound like", not "which moon".
 *
 * The ids are verified against the API rather than copied from documentation:
 * two names that appear in the published list return 200 with no audio in them,
 * so anything not confirmed working is left out.
 *
 * Pitched at Hinglish and Indian English as much as anything else, because that
 * is what the characters being built here actually speak. Gemini detects the
 * language from the text, so no voice is tied to one.
 */

export interface Voice {
  /** The prebuilt voice name the API expects. */
  id: string;
  /** What to call it on screen. */
  label: string;
  /** How it sounds, in the terms someone picking one would use. */
  note: string;
  /** Rough pitch, only so the list can be grouped into something scannable. */
  range: "lower" | "higher";
}

export const VOICES: Voice[] = [
  { id: "Kore",         label: "Warm",        note: "even and friendly, the default for most people", range: "higher" },
  { id: "Leda",         label: "Young",       note: "lighter and quicker, sounds early twenties",     range: "higher" },
  { id: "Aoede",        label: "Breezy",      note: "airy and unhurried, easy to listen to",          range: "higher" },
  { id: "Callirrhoe",   label: "Soft",        note: "gentle and close, good for someone tender",      range: "higher" },
  { id: "Despina",      label: "Bright",      note: "upbeat and animated, talks with their hands",    range: "higher" },
  { id: "Zephyr",       label: "Clear",       note: "crisp and articulate, slightly formal",          range: "higher" },
  { id: "Vindemiatrix", label: "Gentle",      note: "quiet and measured, never raises it",            range: "higher" },
  { id: "Sulafat",      label: "Rich",        note: "fuller and warmer, sounds a bit older",          range: "higher" },

  { id: "Puck",         label: "Playful",     note: "quick and mischievous, always half joking",      range: "lower" },
  { id: "Charon",       label: "Steady",      note: "low and unbothered, says less",                  range: "lower" },
  { id: "Fenrir",       label: "Gruff",       note: "rough-edged and blunt",                          range: "lower" },
  { id: "Enceladus",    label: "Breathy",     note: "soft-spoken and close, almost a murmur",         range: "lower" },
  { id: "Umbriel",      label: "Easy",        note: "relaxed and unhurried, nothing to prove",        range: "lower" },
  { id: "Algieba",      label: "Deep",        note: "the lowest of them, slow and deliberate",        range: "lower" },
];

export const DEFAULT_VOICE = "Kore";

export const voiceById = (id: string | undefined): Voice =>
  VOICES.find((v) => v.id === id) ?? VOICES.find((v) => v.id === DEFAULT_VOICE)!;

export const isVoice = (id: string): boolean => VOICES.some((v) => v.id === id);

/* Speech is billed by the character and takes about a second per sentence to
   generate, so a long reply is both slow and expensive to play. Text past this
   is cut at a sentence end rather than refused: hearing most of a message beats
   a button that does nothing. */
export const MAX_SPOKEN_CHARS = 1200;

export function forSpeech(text: string): string {
  const clean = text.trim();
  if (clean.length <= MAX_SPOKEN_CHARS) return clean;
  const cut = clean.slice(0, MAX_SPOKEN_CHARS);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > MAX_SPOKEN_CHARS * 0.6 ? cut.slice(0, lastStop + 1) : cut;
}
