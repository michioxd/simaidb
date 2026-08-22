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
import { toRomaji } from "./romaji";

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

  localData.categories = upstreamData.categories;
  localData.versions = upstreamData.versions;
  localData.types = upstreamData.types;
  localData.difficulties = upstreamData.difficulties;
  localData.regions = upstreamData.regions;

  let newSongsCount = 0;
  let missingSheetsCount = 0;

  for (const upstreamSong of upstreamData.songs) {
    if (!localSongIds.has(upstreamSong.songId)) {
      localData.songs.push(upstreamSong);
      newSongsCount++;
    } else {
      const localSong = localData.songs.find(
        (s) => s.songId === upstreamSong.songId,
      )!;
      for (const upstreamSheet of upstreamSong.sheets) {
        const hasSheet = localSong.sheets.some(
          (s) =>
            s.type === upstreamSheet.type &&
            s.difficulty === upstreamSheet.difficulty,
        );
        if (!hasSheet) {
          localSong.sheets.push(upstreamSheet);
          missingSheetsCount++;
        }
      }
    }
  }

  if (newSongsCount === 0 && missingSheetsCount === 0) {
    console.log("Up to date.");
    return;
  }

  console.log(
    `Found ${newSongsCount} missing song(s) and ${missingSheetsCount} missing sheet(s). Appending to local database...`,
  );

  const songsToDownloadArtwork = localData.songs.filter(
    (song) => !localSongIds.has(song.songId),
  );

  console.log("Downloading artworks for missing songs...");
  const artworkUrls = new Map<string, string>();
  for (const song of songsToDownloadArtwork) {
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

  const songsToUpdateSet = new Set(
    localData.songs.filter(
      (song) =>
        !localSongIds.has(song.songId) ||
        song.sheets.some((sheet) => !sheet.lastUpdateTime),
    ),
  );

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

    if (!song || !songsToUpdateSet.has(song)) {
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
      console.log(`Updated ratings for song: ${song.title}`);
    }
  }

  for (const song of localData.songs) {
    if (song.title && !song.romajiTitle) {
      const converted = await toRomaji(song.title);
      if (converted !== song.title) {
        song.romajiTitle = converted;
      }
    }
  }

  localData.updateTime = new Date().toISOString();

  await writeFile(localDataPath, JSON.stringify(localData));
  console.log(
    `Appended ${newSongsCount} new songs, added ${missingSheetsCount} new sheets and updated ${updatedSheets} sheets.`,
  );
};

await main();
