/**
 * Plain text, tidied: line endings made the same, control characters dropped,
 * runs of blank lines squeezed to one, and the ends trimmed. What people write
 * in an update or a comment goes through this before it is checked or saved.
 */
export function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
