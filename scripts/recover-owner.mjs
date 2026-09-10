import path from "node:path";
import fs from "node:fs";
import { recoverAbandonedOwner } from "../build/owner-recovery.js";
const directory = process.env.AE_MCP_BRIDGE_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error("Set AE_MCP_BRIDGE_DIR to the configured bridge directory.");
console.log(JSON.stringify(await recoverAbandonedOwner(fs.realpathSync(directory)), null, 2));
