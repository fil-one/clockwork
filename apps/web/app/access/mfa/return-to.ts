/** Only resume the local Team review; its page revalidates the proposed change. */
export function mfaReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 700 ||
    !/^\/internal\/team(?:\?|$)/u.test(value)
  )
    return undefined;
  try {
    // Reject ambiguous browser paths and header controls, including encoded forms.
    for (const character of decodeURIComponent(value)) {
      const code = character.charCodeAt(0);
      if (code <= 32 || code === 127 || character === "\\" || character === "#")
        return undefined;
    }
    const parsed = new URL(value, "https://clockwork.invalid");
    if (
      parsed.origin !== "https://clockwork.invalid" ||
      parsed.pathname !== "/internal/team" ||
      parsed.hash
    )
      return undefined;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}
