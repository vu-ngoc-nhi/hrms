// Normalizes user-entered text: Unicode NFC, trimmed, internal whitespace collapsed.
export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

// Mobile phone: only separators are removed; leading zeros and +84 are never added, removed or rewritten.
export function normalizePhone(value: string): string {
  return value.replace(/[\s.\-()]/g, "");
}
export const PHONE_RE = /^(0\d{9}|\+84\d{9})$/;
