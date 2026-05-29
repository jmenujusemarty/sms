import { loadConfig } from "../src/config.js";
import { createStore } from "../src/store.js";

const force = process.argv.includes("--force");
const config = loadConfig();
const store = await createStore(config.dataFile);
const result = await store.importJson(config.legacyJsonFile, { force });
store.close?.();

console.log(JSON.stringify({
  dataFile: config.dataFile,
  legacyJsonFile: config.legacyJsonFile,
  ...result
}, null, 2));
