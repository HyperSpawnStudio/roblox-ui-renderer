// cli/maccap.mjs: finding Studio's viewport in a window capture by its marker, on synthetic captures (runs on
// every platform: no Studio, ScreenCaptureKit or swiftc involved).
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { MARKER, findMarker, locateViewport, coveredPixels, cropPng } from "../../cli/maccap.mjs";

function capture(width, height, fill) {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = fill(x, y);
			const k = (y * width + x) * 4;
			png.data[k] = r;
			png.data[k + 1] = g;
			png.data[k + 2] = b;
			png.data[k + 3] = 255;
		}
	}
	return png;
}

const CHROME = [40, 40, 44];
const inside = (x, y, r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// A 2x window: chrome around a 400x300-point viewport at physical (60, 90), marked with a colour-converted
// magenta (a window in another colour space shifts it by a few levels)
{
	const viewport = { x: 60, y: 90, width: 800, height: 600 };
	const png = capture(1000, 760, (x, y) => (inside(x, y, viewport) ? [251, 3, 250] : CHROME));
	assert.deepEqual(findMarker(png), { ...viewport, count: 800 * 600 });
	const rect = locateViewport(png, 400, 300, [1.5, 2, 1]);
	assert.equal(rect.scale, 2, "the scale whose physical size the marker is");
	assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [60, 90, 800, 600]);
	assert.equal(coveredPixels(png, rect).count, 0);
	// a fractional logical size rounds like the Windows capture's
	assert.equal(locateViewport(png, 400.2, 299.8, [2]).width, 800);
	assert.throws(() => locateViewport(png, 400, 300, [1]), /800x600 px at 60,90, none of 400x300 \(1x\)/);
}

// A focus outline over the viewport's edge pixels: the box is short by them and is centred back
{
	const viewport = { x: 20, y: 30, width: 600, height: 400 };
	const outline = { x: 22, y: 32, width: 596, height: 396 };
	const png = capture(700, 500, (x, y) => (inside(x, y, outline) ? MARKER : inside(x, y, viewport) ? [0, 120, 215] : CHROME));
	const rect = locateViewport(png, 600, 400, [1]);
	assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [20, 30, 600, 400]);
}

// Something Studio draws over the viewport (a floating toolbar at the top right): located all the same, and
// reported only where it falls inside the compared area
{
	const viewport = { x: 10, y: 10, width: 800, height: 500 };
	const selector = { x: 730, y: 20, width: 60, height: 60 };
	const png = capture(820, 520, (x, y) => (inside(x, y, selector) ? [200, 200, 200] : inside(x, y, viewport) ? MARKER : CHROME));
	const rect = locateViewport(png, 800, 500, [1]);
	assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [10, 10, 800, 500]);
	assert.equal(coveredPixels(png, { x: rect.x, y: rect.y, width: 600, height: 500 }).count, 0, "left of the selector");
	assert.deepEqual(coveredPixels(png, rect), { count: 3600, x: 720, y: 10, width: 60, height: 60 });
}

// No marker, and a marker colour elsewhere in the window that is not a viewport
{
	assert.throws(() => locateViewport(capture(100, 100, () => CHROME), 50, 50, [1]), /marker is not in Studio's window capture/);
	const png = capture(400, 400, (x, y) => ((x < 20 && y < 20) || (x > 380 && y > 380) ? MARKER : CHROME));
	assert.throws(() => locateViewport(png, 400, 400, [1]), /covers 761 of the 160000 px/);
}

// cropPng keeps rows and columns in place
{
	const png = capture(30, 20, (x, y) => [x, y, 7]);
	const out = cropPng(png, { x: 5, y: 4, width: 10, height: 6 });
	assert.equal(out.width, 10);
	assert.equal(out.height, 6);
	assert.deepEqual([...out.data.subarray(0, 4)], [5, 4, 7, 255]);
	const last = (5 * 10 + 9) * 4;
	assert.deepEqual([...out.data.subarray(last, last + 4)], [14, 9, 7, 255]);
}

console.log("maccap: ok");
