import { createReadStream, existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import csvParser from "csv-parser";
import colors from "colors";
import type { MaimaiData, MaimaiSheet } from "./types";

const publicDir = join(import.meta.dir, "..", "public");
const localDir = join(import.meta.dir, "..", "local");
const dataPath = join(publicDir, "data.json");
const dataBackupPath = join(publicDir, "data.json.bak");
const csvPath = join(localDir, "maimai.csv");

type CsvRow = {
  id: string;
  type: string;
  base: string;
  songName: string;
  artist: string;
  genre: string;
  addVersion: string;
  addVersionNum: string;
  relVersion: string;
  utage: string;
  bpm: string;
  basic: string;
  advanced: string;
  expert: string;
  master: string;
  remaster: string;
  hidden: string;
  longMusic: string;
  basicNC: string;
  advandedNC: string;
  expertNC: string;
  masterNC: string;
  remasterNC: string;
  basicDes: string;
  advancedDes: string;
  expertDes: string;
  masterDes: string;
  remasterDes: string;
  sortName: string;
};

const DIFFICULTY_COLUMNS: { key: keyof CsvRow; difficulty: string }[] = [
  { key: "basic", difficulty: "basic" },
  { key: "advanced", difficulty: "advanced" },
  { key: "expert", difficulty: "expert" },
  { key: "master", difficulty: "master" },
  { key: "remaster", difficulty: "remaster" },
];

/**
 * Parse the internal level value from CSV string (e.g. "12.4", "13.6", "")
 * Returns null if not present.
 */
function parseInternalLevel(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const val = parseFloat(trimmed);
  if (isNaN(val)) return null;
  return val;
}

/**
 * Convert internal level value to display string.
 * >= x.6 → "x+" (e.g. 12.6 → "12+"), otherwise integer string (e.g. 12.4 → "12")
 */
function internalLevelToDisplay(val: number): string {
  const floor = Math.floor(val);
  const decimal = parseFloat((val - floor).toFixed(1));
  if (decimal >= 0.6) {
    return `${floor}+`;
  }
  return `${floor}`;
}

/**
 * Convert internal level value to levelValue number.
 * >= x.6 → x.6 (e.g. 12.9 → 12.6), otherwise x.0 (e.g. 12.4 → 12.0)
 */
function internalLevelToLevelValue(val: number): number {
  const floor = Math.floor(val);
  const decimal = parseFloat((val - floor).toFixed(1));
  if (decimal >= 0.6) {
    return floor + 0.6;
  }
  return floor;
}

function parseCsv(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row: CsvRow) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

const main = async () => {
  if (!existsSync(dataBackupPath)) {
    await copyFile(dataPath, dataBackupPath);
    console.log(colors.green(`Backup created: ${dataBackupPath}`));
  } else {
    console.log(
      colors.yellow(`Backup already exists, skipping: ${dataBackupPath}`),
    );
  }

  const data = JSON.parse(await readFile(dataPath, "utf8")) as MaimaiData;

  console.log(colors.cyan(`Parsing CSV: ${csvPath}`));
  const csvRows = await parseCsv(csvPath);
  console.log(colors.cyan(`Loaded ${csvRows.length} rows from CSV`));

  type CsvKey = string;
  const csvMap = new Map<CsvKey, CsvRow>();
  for (const row of csvRows) {
    const key: CsvKey = `${row.songName}::${row.type}`;
    csvMap.set(key, row);
  }

  let updatedCount = 0;
  let updatedSongsCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;

  for (const song of data.songs) {
    const title = song.title ?? "";

    const sheetsByType = new Map<string, MaimaiSheet[]>();
    for (const sheet of song.sheets) {
      const t = sheet.type ?? "std";
      if (!sheetsByType.has(t)) sheetsByType.set(t, []);
      sheetsByType.get(t)!.push(sheet);
    }

    for (const [sheetType, sheets] of sheetsByType) {
      const csvKey: CsvKey = `${title}::${sheetType}`;
      const csvRow = csvMap.get(csvKey);

      if (!csvRow) {
        continue;
      }

      if (csvRow.utage && csvRow.utage.trim() !== "") {
        continue;
      }

      let songUpdated = false;

      for (const sheet of sheets) {
        const diff = sheet.difficulty ?? "";

        const colEntry = DIFFICULTY_COLUMNS.find((d) => d.difficulty === diff);
        if (!colEntry) {
          continue;
        }

        const rawVal = csvRow[colEntry.key] as string;
        const newInternalLevelValue = parseInternalLevel(rawVal);

        if (newInternalLevelValue === null) {
          skippedCount++;
          continue;
        }

        const newInternalLevel = internalLevelToDisplay(newInternalLevelValue);

        const oldInternalLevel = sheet.internalLevel ?? null;
        const oldInternalLevelValue = sheet.internalLevelValue ?? null;

        const levelValueChanged =
          oldInternalLevelValue !== newInternalLevelValue;
        const levelChanged = oldInternalLevel !== newInternalLevel;

        if (!levelValueChanged && !levelChanged) {
          skippedCount++;
          continue;
        }

        const oldLevelDisplay = oldInternalLevel ?? "(none)";
        const oldLevelValueDisplay =
          oldInternalLevelValue !== null
            ? oldInternalLevelValue.toString()
            : "(none)";

        sheet.internalLevel = newInternalLevel;
        sheet.internalLevelValue = newInternalLevelValue;
        sheet.level = newInternalLevel;
        sheet.levelValue = internalLevelToLevelValue(newInternalLevelValue);
        sheet.lastUpdateTime = new Date().toISOString();

        console.log(
          colors.white(`${title} [${sheetType}/${diff}]: `) +
            colors.red(`${oldLevelDisplay} (${oldLevelValueDisplay})`) +
            colors.white(" -> ") +
            colors.green(`${newInternalLevel} (${newInternalLevelValue})`),
        );

        updatedCount++;
        songUpdated = true;
      }

      if (songUpdated) updatedSongsCount++;
    }
  }

  for (const song of data.songs) {
    const title = song.title ?? "";
    const types = [...new Set(song.sheets.map((s) => s.type ?? "std"))];

    for (const sheetType of types) {
      const csvKey: CsvKey = `${title}::${sheetType}`;
      const csvRow = csvMap.get(csvKey);

      if (!csvRow) {
        notFoundCount++;
      }
    }
  }

  await writeFile(dataPath, JSON.stringify(data), "utf8");

  console.log(
    "\n" +
      colors.green(
        `${updatedCount} sheets updated (${updatedSongsCount} songs)`,
      ) +
      " - " +
      colors.yellow(`${skippedCount} skipped`) +
      " - " +
      colors.red(`${notFoundCount} not found in csv`),
  );
};

main().catch((err) => {
  console.error(colors.red("Error:"), err);
  process.exit(1);
});
