export interface IconHint {
  cx: number;
  cy: number;
  r: number;
}

export interface EntrySource {
  screenshotUrl: string;
  width: number;
  height: number;
  iconHint?: IconHint;
  detected?: IconHint[];
}

export interface ExtractedEntry {
  rank: number;
  iconImage: string;
  rawName: string;
  cleanedName: string;
  source?: EntrySource;
  pickPos?: { x: number; y: number };
  pickRadius?: number;
}

export interface NameExtractor {
  extract(imageRegion: ImageData): Promise<string>;
}
