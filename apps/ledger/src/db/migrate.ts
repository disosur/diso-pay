import { loadConfig } from "../config.ts";
import { openDatabase } from "./index.ts";
import { log } from "../logger.ts";

const config = loadConfig();
const { sqlite } = openDatabase(config.databasePath);

log.info("database migrated", { path: config.databasePath });
sqlite.close();
