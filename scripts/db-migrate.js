import { loadConfig } from "../src/config.js";
import { createStore } from "../src/store.js";

const config = loadConfig();
const store = await createStore(config.dataFile);
const state = await store.read();
store.close?.();

console.log(JSON.stringify({
  dataFile: config.dataFile,
  schemaVersion: state.schemaVersion,
  migrated: true
}, null, 2));
