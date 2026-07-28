import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import colors from "colors";
import type { MaimaiData, MaimaiSheet, MaimaiSong } from "./types";

export const publicDir = join(import.meta.dir, "..", "public");
export const dataPath = join(publicDir, "data.json");
export const requestIntervalMs = 1_000;
export const maxFetchRetries = 5;
export const initialRetryDelayMs = 1_000;

export const categories = [
  "https://gamerch.com/maimai/533381", // POPS＆アニメ
  "https://gamerch.com/maimai/533382", // niconico＆ボーカロイド
  "https://gamerch.com/maimai/533383", // 東方Project
  "https://gamerch.com/maimai/533385", // ゲーム＆バラエティ
  "https://gamerch.com/maimai/533386", // maimai
  "https://gamerch.com/maimai/533825", // オンゲキ＆CHUNITHM
];

export const difficultyByBackgroundColor: Record<string, string> = {
  "#98fb98": "basic",
  "#ffa500": "advanced",
  "#fa8080": "expert",
  "#ee82ee": "master",
  "#ffceff": "remaster",
};

const difficultyColor: Record<string, string> = {
  basic: "#98fb98",
  advanced: "#ffa500",
  expert: "#fa8080",
  master: "#ee82ee",
  remaster: "#ffceff",
};

export const ignoredLevelBackgroundColor = "#00ced1";

export type SongLink = {
  url: string;
  title: string;
  artist: string;
};

export type Rating = {
  type: string;
  difficulty: string;
  level: string;
  internalLevelValue: number;
};

let lastRequestTime = 0;

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitForRateLimit = async () => {
  const waitMs = lastRequestTime + requestIntervalMs - Date.now();

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  lastRequestTime = Date.now();
};

const fetchTextOnce = async (url: string) => {
  await waitForRateLimit();

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
};

export const fetchText = async (url: string) => {
  let retryDelayMs = initialRetryDelayMs;

  for (let attempt = 1; attempt <= maxFetchRetries; attempt += 1) {
    try {
      return await fetchTextOnce(url);
    } catch (error) {
      if (attempt === maxFetchRetries) {
        throw error;
      }

      console.warn(
        colors.yellow(
          `Failed to fetch ${url}. Retry ${attempt}/${maxFetchRetries - 1} in ${retryDelayMs}ms.`,
        ),
      );

      await sleep(retryDelayMs);
      retryDelayMs *= 2;
    }
  }

  throw new Error(`Failed to fetch ${url}`);
};

export const decodeHtml = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

export const htmlToText = (html: string) =>
  decodeHtml(
    html
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

export const getCells = (rowHtml: string) =>
  [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(
    (match) => htmlToText(match[1] ?? ""),
  );

export const getLevelBackgroundColor = (rowHtml: string) => {
  const match = rowHtml.match(
    /<(?:td|th)\b[^>]*style="[^"]*background-color:\s*(#[\da-f]{6})/i,
  );
  return match?.[1]?.toLowerCase();
};

export const getDifficulty = (rowHtml: string) => {
  const backgroundColor = getLevelBackgroundColor(rowHtml);

  if (!backgroundColor || backgroundColor === ignoredLevelBackgroundColor) {
    return undefined;
  }

  return difficultyByBackgroundColor[backgroundColor];
};

export const getTables = (html: string) =>
  [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(
    (match) => match[1] ?? "",
  );

export const getRatingSections = (html: string) => {
  const sections: { type: string; table: string }[] = [];
  const headingPattern = /<h4\b[^>]*>([\s\S]*?譜面[\s\S]*?)<\/h4>/gi;
  const headings = [...html.matchAll(headingPattern)];

  headings.forEach((headingMatch, index) => {
    const heading = htmlToText(headingMatch[1] ?? "");
    const type = heading.includes("スタンダード")
      ? "std"
      : heading.includes("でらっくす")
        ? "dx"
        : undefined;

    if (!type || headingMatch.index === undefined) {
      return;
    }

    const start = headingMatch.index + headingMatch[0].length;
    const nextHeadingIndex = headings[index + 1]?.index ?? html.length;
    const sectionHtml = html.slice(start, nextHeadingIndex);
    const table = getTables(sectionHtml).find((candidate) =>
      candidate.includes("定数"),
    );

    if (table) {
      sections.push({ type, table });
    }
  });

  return sections;
};

export const parseLatestUpdateTime = (html: string) => {
  const match = html.match(
    /<div class="latest-update">[\s\S]*?<time[^>]*>[\s\S]*?(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})[\s\S]*?<\/time>/i,
  );
  return match?.[1]?.trim() ?? new Date().toISOString();
};

export const parseCategory = (html: string) => {
  const links = new Map<string, SongLink>();
  const rows = [
    ...html.matchAll(/<tr class="mu__table--row\d+">([\s\S]*?)<\/tr>/gi),
  ];

  for (const row of rows) {
    const rowHtml = row[1] ?? "";
    const link = rowHtml.match(
      /<a\b[^>]*href="([^"]+)"[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );

    if (!link) {
      continue;
    }

    const cells = getCells(rowHtml);
    const artist = cells[1];

    if (!artist) {
      continue;
    }

    const url = new URL(
      decodeHtml(link[1] ?? ""),
      "https://gamerch.com",
    ).toString();
    const title = htmlToText(link[3] ?? link[2] ?? "");
    links.set(url, { url, title, artist });
  }

  return [...links.values()];
};

export const parseRatings = (html: string) => {
  const ratings: Rating[] = [];
  const sections = getRatingSections(html);

  for (const { type, table } of sections) {
    const rows = [
      ...table.matchAll(/<tr class="mu__table--row\d+">([\s\S]*?)<\/tr>/gi),
    ].slice(2);

    rows.forEach((row) => {
      const rowHtml = row[1] ?? "";
      const difficulty = getDifficulty(rowHtml);
      const cells = getCells(rowHtml);
      const level = cells[0];
      const internalLevelValue = Number(cells[1]);

      if (!difficulty || !level || Number.isNaN(internalLevelValue)) {
        return;
      }

      ratings.push({ type, difficulty, level, internalLevelValue });
    });
  }

  return ratings;
};

export const normalize = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

export const getLevelValue = (level: string) => {
  const value = Number.parseInt(level, 10);
  return level.endsWith("+") ? value + 0.6 : value;
};

export const findSong = (data: MaimaiData, link: SongLink) => {
  const title = normalize(link.title);
  const artist = normalize(link.artist);

  return (
    data.songs.find(
      (song) =>
        normalize(song.title) === title && normalize(song.artist) === artist,
    ) ?? data.songs.find((song) => normalize(song.title) === title)
  );
};

export const formatInternalLevel = (sheet: MaimaiSheet) =>
  String(sheet.internalLevelValue ?? sheet.internalLevel ?? "?");

export const colorHex = (value: string, hex: string) => {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${red};${green};${blue}m${value}\x1b[0m`;
};

export const formatDiff = (rating: Rating) => {
  const label = `[${rating.type.toUpperCase()} ${rating.difficulty.toUpperCase()}]`;
  const color = difficultyColor[rating.difficulty];
  return color ? colorHex(label, color) : label;
};

export const updateSong = (
  song: MaimaiSong,
  ratings: Rating[],
  updateTime: string,
) => {
  let updated = 0;

  for (const rating of ratings) {
    const sheet = song.sheets.find(
      (candidate) =>
        candidate.type === rating.type &&
        candidate.difficulty === rating.difficulty,
    );

    if (!sheet) {
      continue;
    }

    if (sheet.lastUpdateTime) {
      continue;
    }

    const oldLevel = sheet.level ?? "?";
    const oldInternalLevel = formatInternalLevel(sheet);
    const didChange =
      sheet.level !== rating.level ||
      sheet.internalLevelValue !== rating.internalLevelValue;

    if (didChange) {
      console.log(
        `${song.title}: ${formatDiff(rating)} ${oldLevel} - ${oldInternalLevel} -> ${colors.green(`${rating.level} - ${rating.internalLevelValue}`)}`,
      );
      sheet.level = rating.level;
      sheet.levelValue = getLevelValue(rating.level);
      sheet.internalLevelValue = rating.internalLevelValue;
    }

    sheet.lastUpdateTime = updateTime;
    updated += 1;
  }

  return updated;
};

if (import.meta.main) {
  const main = async () => {
    const data = JSON.parse(await readFile(dataPath, "utf8")) as MaimaiData;
    const songLinks = new Map<string, SongLink>();

    for (const category of categories) {
      const links = parseCategory(await fetchText(category));
      links.forEach((link) => songLinks.set(link.url, link));
      console.log(`Fetched ${links.length} songs from ${category}`);
    }

    let updatedSheets = 0;

    for (const link of songLinks.values()) {
      const song = findSong(data, link);

      if (!song || song.sheets.every((sheet) => sheet.lastUpdateTime)) {
        continue;
      }

      const html = await fetchText(link.url);
      const updateTime = parseLatestUpdateTime(html);
      const ratings = parseRatings(html);

      updatedSheets += updateSong(song, ratings, updateTime);
    }

    await writeFile(dataPath, JSON.stringify(data));
    console.log(`Updated ${updatedSheets} sheets. Saved ${dataPath}.`);
  };

  await main();
}
