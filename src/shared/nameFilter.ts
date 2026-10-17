/**
 * A small blocklist for player names (D-035, milestone 3.4): strangers meet in public
 * lobbies, so names that insult or harass are replaced. Deliberately short and specific —
 * only words that are offensive wherever they appear inside a name, so ordinary names don't
 * get caught ("Bassist", "Grapes", "Nazir" and "Cucumber" pass). Moderation beyond this is Phase 5.
 */

/** Matched inside the name after normalizing (see `normalize`). Lowercase letters only. */
const BLOCKED: readonly string[] = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "asshole",
  "whore",
  "slut",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "rapist",
  "hitler",
  "kike",
  "chink",
  "tranny",
  "porn",
  "pussy",
  "penis",
  "vagina",
  "dildo",
  "killyourself",
  "kys",
];

// Digits and symbols people use to dodge filters, read as the letters they stand for.
const LOOKALIKES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
};

/** Lowercase letters only, lookalikes replaced, accents removed, spaces and dots dropped. */
function normalize(name: string): string {
  let out = "";
  for (const ch of name.normalize("NFKD").toLowerCase()) {
    const mapped = LOOKALIKES[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

/** True when the name contains a blocked word (also spelled with spaces, dots or 3 for e). */
export function isBlockedName(name: string): boolean {
  const flat = normalize(name);
  // "kys" only as the whole name: inside words it is too common ("Kyshawn").
  return BLOCKED.some((word) => (word === "kys" ? flat === word : flat.includes(word)));
}
