export const dataSource = {
  baseUrl: "https://dp4p6x0xfi5o9.cloudfront.net/maimai",
  dataPath: "data.json", // <baseUrl>/<dataPath>
  source: "zetaraku/arcade-songs",
  link: "https://github.com/zetaraku/arcade-songs",
};

/**
 * @see https://github.com/zetaraku/arcade-songs/blob/master/types/Sheet.ts
 * @license MIT
 */
export type MaimaiSheet = Omit<MaimaiSong, "sheets"> & {
  type?: string;
  difficulty?: string;

  level?: string;
  levelValue?: number;

  internalLevel?: string;
  internalLevelValue?: number;

  noteDesigner?: string;
  noteCounts?: Record<string, number | null>;

  regions?: Record<string, boolean>;
  regionOverrides?: Record<string, MaimaiSheet>;

  isSpecial?: boolean;

  lastUpdateTime?: string; // if not updated yet keep it undefined
};

/**
 * @see https://github.com/zetaraku/arcade-songs/blob/master/types/Song.ts
 * @license MIT
 */
export type MaimaiSong = {
  songId: string | null;

  category?: string;
  title?: string;
  artist?: string;
  bpm?: number;

  imageName?: string;

  version?: string;
  releaseDate?: string;

  isNew?: boolean;
  isLocked?: boolean;

  comment?: string;

  sheets: MaimaiSheet[];
};

/**
 * @see https://github.com/zetaraku/arcade-songs/blob/master/types/Data.ts
 * @license MIT
 */
export type MaimaiData = {
  songs: MaimaiSong[];

  categories: {
    category: string;
  }[];

  versions: {
    version: string;
    abbr?: string;
    releaseDate?: string;
  }[];

  types: {
    type: string;
    name: string;
    abbr?: string;
    iconUrl?: string;
    iconHeight?: number;
  }[];
  difficulties: {
    difficulty: string;
    name: string;
    color?: string;
    iconUrl?: string;
    iconHeight?: number;
  }[];

  regions: {
    region: string;
    name: string;
  }[];

  updateTime: string;
};
