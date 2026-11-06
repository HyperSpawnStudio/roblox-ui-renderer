// cli/macstudio.mjs: the newest Studio install wins on macOS, whichever folder holds it (runs on every
// platform: folders made here, no Studio involved).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macStudioApps } from "../../cli/macstudio.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rur-macstudio-"));
try {
	const app = (dir, time) => {
		const executable = path.join(root, dir, "RobloxStudio.app", "Contents", "MacOS", "RobloxStudio");
		fs.mkdirSync(path.dirname(executable), { recursive: true });
		fs.writeFileSync(executable, "");
		fs.utimesSync(executable, time, time);
		return path.join(root, dir, "RobloxStudio.app");
	};
	// an installer copy in Applications older than the updater's build
	const applications = app("Applications", new Date("2026-10-01T00:00:00Z"));
	const bundle = app("UnzippedBundle", new Date("2026-11-04T00:00:00Z"));
	fs.mkdirSync(path.join(root, "Empty", "RobloxStudio.app"), { recursive: true });
	const dirs = ["Applications", "Empty", "Missing", "UnzippedBundle"].map(dir => path.join(root, dir));
	assert.deepEqual(macStudioApps(dirs), [bundle, applications], "newest first; folders without Studio's executable left out");
	assert.deepEqual(macStudioApps([]), []);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}

console.log("macstudio: ok");
