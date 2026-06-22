/**
 * Reel genres = swappable colour packs (background + speed-lines + avatar ring +
 * text colours). Background and speed-line images are hosted per genre under
 * public/video/genres/<id>/; the ring colours are applied client-side when the
 * circular avatar PNG is baked. Add a genre = add an entry + its two assets.
 */
export interface ReelGenre {
  id: string;
  name: string;
  /** 第N位 + title colour */
  rankColor: string;
  nameColor: string;
  /** avatar ring gradient stops (baked client-side) */
  ringStops: [string, string, string];
}

export const REEL_GENRES: ReelGenre[] = [
  {
    id: "gold",
    name: "ゴールド",
    rankColor: "#FFD24D",
    nameColor: "#ffffff",
    ringStops: ["#FFF1B8", "#FFD24D", "#C8860B"],
  },
  {
    id: "neon",
    name: "ネオン",
    rankColor: "#5BE0FF",
    nameColor: "#eaf6ff",
    ringStops: ["#A8F0FF", "#39B7FF", "#7A4DFF"],
  },
  {
    id: "pink",
    name: "かわいい",
    rankColor: "#FF8FC7",
    nameColor: "#fff0f7",
    ringStops: ["#FFD9EC", "#FF8FC7", "#C84E9B"],
  },
  {
    id: "flame",
    name: "炎",
    rankColor: "#FF9D3D",
    nameColor: "#ffffff",
    ringStops: ["#FFE3A0", "#FF9D3D", "#C84A1A"],
  },
];

export const getGenre = (id?: string): ReelGenre =>
  REEL_GENRES.find((g) => g.id === id) ?? REEL_GENRES[0];
