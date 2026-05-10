const DECORATIVE_SYMBOLS = /[⌘✦✧❤♡♥]/g;

export function cleanName(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(DECORATIVE_SYMBOLS, "")
    .trim();
}
