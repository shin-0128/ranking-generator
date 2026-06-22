/**
 * Font axis for the ranking reel — a third pick (alongside genre + effect) so
 * leased reels don't all look the same. Each entry hosts an OFL-licensed JP
 * font on our deploy; `family` MUST match the font file's internal name (that's
 * what Shotstack's HTML renderer keys on in CSS font-family). `file` is the
 * path under ASSET_BASE.
 */
export interface ReelFont {
  id: string;
  name: string;
  family: string;
  file: string;
}

export const REEL_FONTS: ReelFont[] = [
  { id: "gothic", name: "ゴシック", family: "Noto Sans JP", file: "NotoSansJP-Bold.otf" },
  { id: "mincho", name: "明朝", family: "Shippori Mincho", file: "fonts/ShipporiMincho-Bold.ttf" },
  { id: "round", name: "丸ゴシック", family: "M PLUS Rounded 1c", file: "fonts/MPLUSRounded1c-Bold.ttf" },
  { id: "impact", name: "極太", family: "Dela Gothic One", file: "fonts/DelaGothicOne-Regular.ttf" },
  { id: "hand", name: "手書き", family: "Yusei Magic", file: "fonts/YuseiMagic-Regular.ttf" },
  { id: "pop", name: "ポップ", family: "Mochiy Pop One", file: "fonts/MochiyPopOne-Regular.ttf" },
];

export function getFont(id?: string): ReelFont {
  return REEL_FONTS.find((f) => f.id === id) ?? REEL_FONTS[0];
}
