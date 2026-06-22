/**
 * Entrance-effect presets for the ranking reel — a second axis the user picks
 * alongside genre (which controls colour/background). The effect only governs
 * how each avatar *enters* (and whether speed-lines / how strong the flash is);
 * everything else is shared. Shotstack stage only animates offset + opacity, so
 * every entrance is expressed through those.
 */
const ease = (easing: string) => ({ interpolation: "bezier", easing });

/** the avatar's resting y after it settles (slightly above centre) */
const SETTLE = -0.02;

export interface ReelEffect {
  id: string;
  name: string;
  /** radial speed-line burst on entry */
  speedlines: boolean;
  /** avatar entrance keyframes (offset + optional fade-in), settling to SETTLE */
  avatarAnim: (i: number) => { offset: object; opacity?: object[] };
  /** peak white-flash opacity on entry (0 = no flash) */
  flashPeak: (rank: number) => number;
}

export const REEL_EFFECTS: ReelEffect[] = [
  {
    // current default: fighting-game character-select energy
    id: "fighter",
    name: "格ゲー",
    speedlines: true,
    avatarAnim: (i) => ({
      offset: {
        x: [{ from: i % 2 === 0 ? 0.6 : -0.6, to: 0, start: 0, length: 0.42, ...ease("easeOutBack") }],
        y: SETTLE,
      },
    }),
    flashPeak: (rank) => (rank === 1 ? 1 : 0.85),
  },
  {
    // soft, premium: rises up from below while fading in, no speed-lines
    id: "elegant",
    name: "エレガント",
    speedlines: false,
    avatarAnim: () => ({
      offset: {
        y: [{ from: 0.08, to: SETTLE, start: 0, length: 0.7, ...ease("easeOutSine") }],
      },
      opacity: [{ from: 0, to: 1, start: 0, length: 0.5, ...ease("easeOutSine") }],
    }),
    flashPeak: (rank) => (rank === 1 ? 0.5 : 0.3),
  },
  {
    // playful: drops in from the top with an easeOutBack bounce
    id: "drop",
    name: "ドロップ",
    speedlines: false,
    avatarAnim: () => ({
      offset: {
        y: [{ from: -0.55, to: SETTLE, start: 0, length: 0.5, ...ease("easeOutBack") }],
      },
    }),
    flashPeak: (rank) => (rank === 1 ? 1 : 0.8),
  },
];

export function getEffect(id?: string): ReelEffect {
  return REEL_EFFECTS.find((e) => e.id === id) ?? REEL_EFFECTS[0];
}
