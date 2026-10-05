/**
 * The indefinite article for a jurisdiction / entity type, chosen by the sound
 * of its first word: "an Ontario corporation", "a Utah limited liability
 * company", "an LLC", "a UK private limited company". Short all-capital
 * tokens are read as initialisms (letter names); other words by spelling, with
 * the common "you" and "wun" sounds of U, Eu and One.
 */
export function mndaEntityArticle(value: string): "a" | "an" {
  const token = (value.trim().split(/[\s,(]+/)[0] ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (!letters) return "a";
  const first = letters.charAt(0).toLowerCase();
  if (letters.length <= 3 && letters === letters.toUpperCase())
    return "aefhilmnorsx".includes(first) ? "an" : "a";
  const word = letters.toLowerCase();
  if (first === "u") return /^u(?:n(?!i(?!n))|m|p|zb)/.test(word) ? "an" : "a";
  if (first === "e") return word.startsWith("eu") ? "a" : "an";
  if (first === "o") return /^on(?:e|ce)/.test(word) ? "a" : "an";
  return "aei".includes(first) ? "an" : "a";
}
