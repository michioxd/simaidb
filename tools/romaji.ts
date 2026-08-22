import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
// @ts-ignore
import Kuroshiro from "kuroshiro";
// @ts-ignore
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import colors from "colors";
import type { MaimaiData } from "./types";

const publicDir = join(import.meta.dir, "..", "public");
const dataPath = join(publicDir, "data.json");

let kuroshiro: any = null;

export async function toRomaji(text: string): Promise<string> {
  if (!kuroshiro) {
    kuroshiro = new Kuroshiro();
    await kuroshiro.init(new KuromojiAnalyzer());
  }
  return kuroshiro.convert(text, {
    to: "romaji",
    romajiSystem: "passport",
    delimiter: " ",
  });
}

const main = async () => {
  console.log(colors.cyan(`Reading data from ${dataPath}...`));
  const data = JSON.parse(await readFile(dataPath, "utf8")) as MaimaiData;

  let convertedCount = 0;
  let skippedCount = 0;

  for (const song of data.songs) {
    if (!song.title && !song.artist) {
      skippedCount++;
      continue;
    }

    let songConverted = false;

    if (song.title) {
      const converted = await toRomaji(song.title);
      if (converted !== song.title) {
        song.romajiTitle = converted;
        songConverted = true;
        console.log(
          colors.gray(`Converted title: `) +
            colors.white(song.title) +
            colors.gray(` -> `) +
            colors.green(converted),
        );
      }
    }

    if (song.artist) {
      const convertedArtist = await toRomaji(song.artist);
      if (convertedArtist !== song.artist) {
        song.romajiArtist = convertedArtist;
        songConverted = true;
        console.log(
          colors.gray(`Converted artist: `) +
            colors.white(song.artist) +
            colors.gray(` -> `) +
            colors.green(convertedArtist),
        );
      }
    }

    if (songConverted) {
      convertedCount++;
    } else {
      skippedCount++;
    }
  }

  await writeFile(dataPath, JSON.stringify(data), "utf8");

  console.log(
    "\n" +
      colors.green(`${convertedCount} converted`) +
      " - " +
      colors.yellow(`${skippedCount} skipped`),
  );
};

if (import.meta.main) {
  main().catch((err) => {
    console.error(colors.red("Error:"), err);
    process.exit(1);
  });
}
