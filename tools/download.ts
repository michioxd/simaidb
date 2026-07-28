import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dataSource, type MaimaiData, type MaimaiSong } from "./types";

const publicDir = join(import.meta.dir, "..", "public");
export const artworkDir = join(publicDir, "artwork");
const dataUrl = new URL(
  dataSource.dataPath,
  `${dataSource.baseUrl}/`,
).toString();

export const getSongArtworkUrl = (song: MaimaiSong) => {
  if (!song.imageName) {
    return "";
  }

  return new URL(
    `img/cover/${song.imageName}`,
    `${dataSource.baseUrl}/`,
  ).toString();
};

export const downloadFile = async (url: string, filePath: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
};

if (import.meta.main) {
  const main = async () => {
    await mkdir(artworkDir, { recursive: true });

    const response = await fetch(dataUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to download ${dataUrl}: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as MaimaiData;
    await writeFile(join(publicDir, "data.json"), JSON.stringify(data));

    const artworkUrls = new Map<string, string>();

    for (const song of data.songs) {
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

    console.log(
      `Downloaded ${data.songs.length} songs and ${artworkUrls.size} artworks.`,
    );
  };

  await main();
}
