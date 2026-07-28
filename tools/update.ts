import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  categories,
  fetchText,
  findSong,
  parseCategory,
  parseLatestUpdateTime,
  parseRatings,
  type SongLink,
  updateSong,
} from "./rating";
import { dataSource, type MaimaiData } from "./types";
import { artworkDir, downloadFile, getSongArtworkUrl } from "./download";

const publicDir = join(import.meta.dir, "..", "public");
const localDataPath = join(publicDir, "data.json");

const dataSourceUrl = new URL(
  dataSource.dataPath,
  `${dataSource.baseUrl}/`,
).toString();

const main = async () => {
  const localData = JSON.parse(
    await readFile(localDataPath, "utf8"),
  ) as MaimaiData;
  const localSongIds = new Set(localData.songs.map((song) => song.songId));

  console.log(`Fetching upstream data from ${dataSourceUrl}...`);
  const upstreamResponse = await fetch(dataSourceUrl);
  if (!upstreamResponse.ok) {
    throw new Error(
      `Failed to fetch upstream data: ${upstreamResponse.statusText}`,
    );
  }
  const upstreamData = (await upstreamResponse.json()) as MaimaiData;

  const missingSongs = upstreamData.songs.filter(
    (song) => !localSongIds.has(song.songId),
  );

  if (missingSongs.length === 0) {
    console.log("Up to date.");
    return;
  }

  console.log(
    `Found ${missingSongs.length} missing song(s). Appending to local database...`,
  );

  localData.songs.push(...missingSongs);

  console.log("Downloading artworks for missing songs...");
  const artworkUrls = new Map<string, string>();
  for (const song of missingSongs) {
    const artworkUrl = getSongArtworkUrl(song);
    if (artworkUrl && song.imageName) {
      artworkUrls.set(song.imageName, artworkUrl);
    }
  }

  await Promise.all(
    [...artworkUrls].map(([imageName, artworkUrl]) =>
      downloadFile(artworkUrl, join(artworkDir, basename(imageName))),
    ),
  );
  console.log(`Downloaded ${artworkUrls.size} artworks.`);

  const missingSongsSet = new Set(missingSongs);

  console.log("Fetching gamerch catalog...");
  const songLinks = new Map<string, SongLink>();
  for (const category of categories) {
    const links = parseCategory(await fetchText(category));
    links.forEach((link) => songLinks.set(link.url, link));
    console.log(`Fetched ${links.length} songs from ${category}`);
  }

  let updatedSheets = 0;

  for (const link of songLinks.values()) {
    const song = findSong(localData, link);

    if (!song || !missingSongsSet.has(song)) {
      continue;
    }

    if (song.sheets.every((sheet) => sheet.lastUpdateTime)) {
      continue;
    }

    const html = await fetchText(link.url);
    const updateTime = parseLatestUpdateTime(html);
    const ratings = parseRatings(html);

    const updated = updateSong(song, ratings, updateTime);
    if (updated > 0) {
      updatedSheets += updated;
      console.log(`Updated ratings for newly added song: ${song.title}`);
    }
  }

  localData.updateTime = new Date().toISOString();

  await writeFile(localDataPath, JSON.stringify(localData, null, 2));
  console.log(
    `Appended ${missingSongs.length} songs and updated ${updatedSheets} sheets.`,
  );
};

await main();
