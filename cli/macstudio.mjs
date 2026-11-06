// Roblox Studio installs on macOS, newest first. The updater keeps the current build in
// ~/Library/Roblox/UnzippedBundle; /Applications and ~/Applications may hold an older copy from the
// installer, so the newest app by its executable's date wins (native/src/resolve.rs and
// roblox-object-renderer's ror-assets pick the same one).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function macStudioDirs(home = os.homedir()) {
	return [path.join(home, "Library", "Roblox", "UnzippedBundle"), "/Applications", path.join(home, "Applications")];
}

// The RobloxStudio.app bundles in `dirs` that have Studio's executable, newest first
export function macStudioApps(dirs = macStudioDirs()) {
	return dirs
		.map(dir => path.join(dir, "RobloxStudio.app"))
		.flatMap(app => {
			try {
				return [{ app, time: fs.statSync(path.join(app, "Contents", "MacOS", "RobloxStudio")).mtimeMs }];
			} catch {
				return [];
			}
		})
		.sort((a, b) => b.time - a.time)
		.map(entry => entry.app);
}
