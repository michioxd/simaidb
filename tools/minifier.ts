import { dataPath } from "./rating";
import type { MaimaiData } from "./types";
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";

async function main() {
    const localData = JSON.parse(
        await readFile(dataPath, "utf8"),
      ) as MaimaiData;

    await writeFile(dataPath, JSON.stringify(localData, null, 0));

    console.log("OK");
}

main();
