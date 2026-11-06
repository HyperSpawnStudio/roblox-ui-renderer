// Lossless capture of a Roblox Studio viewport on macOS (cli/studio.mjs captureViewportMac): the counterpart of
// tools/wincap. A Studio window there has no child window for its viewport, so the viewport is found by a marker:
// a full-screen frame of one colour mounted under CoreGui, located in a capture of the window, then removed before
// the capture that is kept.
//
// tools/maccap/maccap.swift lists Studio's windows and captures one: ScreenCaptureKit, the window's own pixels at
// its backing scale whatever covers it, in sRGB (`screencapture -l` colour-matches into the display's space, so
// Studio's colours change on a P3 display). It is compiled on first use into <state dir>/maccap/ (swiftc, from
// Xcode or the Command Line Tools; macOS 14 or later) and needs the Screen Recording permission for the app
// running rur.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { stateDir } from "./paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "tools", "maccap", "maccap.swift");

// The marker's colour and how far a captured channel may be from it
export const MARKER = [255, 0, 255];
const MARKER_TOLERANCE = 24;

function helper() {
	const source = fs.readFileSync(SOURCE);
	const binary = path.join(stateDir(), "maccap", `maccap-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`);
	if (fs.existsSync(binary)) return binary;
	fs.mkdirSync(path.dirname(binary), { recursive: true });
	const result = spawnSync("swiftc", ["-O", SOURCE, "-o", `${binary}.tmp`], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`building tools/maccap/maccap.swift failed (swiftc from Xcode or the Command Line Tools is needed): ${result.error ? result.error.message : (result.stderr || result.stdout).trim()}`);
	fs.renameSync(`${binary}.tmp`, binary);
	return binary;
}

export function studioWindows(filter = "") {
	const result = spawnSync(helper(), ["windows", ...(filter ? [filter] : [])], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`listing Studio's windows failed: ${(result.stderr || result.stdout || "").trim()}`);
	return JSON.parse(result.stdout);
}

// The document window of the Studio named `studioName` (the MCP's name: the place file or the place's name, which
// its window title contains)
export function studioWindow(studioName) {
	const name = String(studioName || "").replace(/\s*\(placeId:.*$/, "").replace(/\s*-\s*Roblox Studio$/, "");
	const matches = studioWindows(name);
	if (matches.length) return matches[0];
	const all = studioWindows();
	const titles = all.map(window => `"${window.title}" (${window.width}x${window.height})`).join(", ") || "none";
	if (all.length && all.every(window => !window.title)) {
		throw new Error(`Studio's window titles are not readable: give the app running rur the Screen Recording permission (System Settings > Privacy & Security > Screen Recording)`);
	}
	throw new Error(`no Studio window titled like "${name}"; Studio windows on screen: ${titles}`);
}

export function captureWindow(windowId, outFile) {
	fs.rmSync(outFile, { force: true });
	const result = spawnSync(helper(), ["capture", String(windowId), outFile], { encoding: "utf8" });
	if (result.status !== 0 || !fs.existsSync(outFile)) {
		throw new Error(`capturing Studio's window ${windowId} failed: ${(result.stderr || result.stdout || "").trim() || "no image (is the Screen Recording permission granted?)"}`);
	}
	return PNG.sync.read(fs.readFileSync(outFile));
}

// The bounding box of the marker's pixels and how many there are
export function findMarker(png, colour = MARKER, tolerance = MARKER_TOLERANCE) {
	let left = Infinity, top = Infinity, right = -1, bottom = -1, count = 0;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const k = (y * png.width + x) * 4;
			if (Math.abs(png.data[k] - colour[0]) > tolerance || Math.abs(png.data[k + 1] - colour[1]) > tolerance || Math.abs(png.data[k + 2] - colour[2]) > tolerance) continue;
			count++;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
		}
	}
	return count ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1, count } : null;
}

// The pixels in `rect` that are not the marker's: what Studio draws over its viewport there, as a count and
// their bounding box (relative to `rect`)
export function coveredPixels(png, rect, colour = MARKER, tolerance = MARKER_TOLERANCE) {
	let left = Infinity, top = Infinity, right = -1, bottom = -1, count = 0;
	for (let y = rect.y; y < rect.y + rect.height; y++) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			const k = (y * png.width + x) * 4;
			if (Math.abs(png.data[k] - colour[0]) <= tolerance && Math.abs(png.data[k + 1] - colour[1]) <= tolerance && Math.abs(png.data[k + 2] - colour[2]) <= tolerance) continue;
			count++;
			left = Math.min(left, x - rect.x);
			right = Math.max(right, x - rect.x);
			top = Math.min(top, y - rect.y);
			bottom = Math.max(bottom, y - rect.y);
		}
	}
	return count ? { count, x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : { count: 0 };
}

// The viewport in a window capture: the marker's box, at the first display scale whose physical size it is
// (within `slack` px: Studio may draw a focus outline over the viewport's edge pixels). What Studio draws over
// the viewport inside the box, above its GUI (a floating toolbar), is left to the caller (coveredPixels).
export function locateViewport(png, width, height, scales, slack = 4) {
	const box = findMarker(png);
	if (!box) throw new Error("the viewport marker is not in Studio's window capture (is the viewport visible, and in Edit mode?)");
	for (const scale of scales) {
		const w = Math.round(width * scale), h = Math.round(height * scale);
		if (Math.abs(box.width - w) <= slack && Math.abs(box.height - h) <= slack) {
			if (box.count < box.width * box.height * 0.5) throw new Error(`the viewport marker covers ${box.count} of the ${box.width * box.height} px in its box: something else in Studio's window has its colour`);
			// a box short of the size by the outline's pixels: centred on the marker
			const x = Math.max(0, Math.min(png.width - w, box.x - Math.round((w - box.width) / 2)));
			const y = Math.max(0, Math.min(png.height - h, box.y - Math.round((h - box.height) / 2)));
			return { x, y, width: w, height: h, scale, marker: box };
		}
	}
	const tried = scales.map(scale => `${Math.round(width * scale)}x${Math.round(height * scale)} (${scale}x)`).join(", ");
	throw new Error(`the viewport marker is ${box.width}x${box.height} px at ${box.x},${box.y}, none of ${tried}`);
}

export function cropPng(png, rect) {
	const out = new PNG({ width: rect.width, height: rect.height });
	for (let y = 0; y < rect.height; y++) {
		png.data.copy(out.data, y * rect.width * 4, ((rect.y + y) * png.width + rect.x) * 4, ((rect.y + y) * png.width + rect.x + rect.width) * 4);
	}
	return out;
}
