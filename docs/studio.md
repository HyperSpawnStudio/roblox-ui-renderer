# Comparing with Roblox Studio

`rur compare` mounts the same UI in a running Studio (a temporary GUI under CoreGui, removed afterwards),
captures Studio's viewport losslessly, renders it offline at the same scale and writes the difference. It
needs a running Roblox Studio and a Studio MCP bridge, on Windows or macOS ([macOS](#macos)).

```powershell
$env:RUR_STUDIO_MCP_PORT = "<port>"
node cli/rur.mjs compare --story <file> --viewport 1200x900 --time 1
node cli/rur.mjs compare --fixture fixtures/corners.luau --viewport 800x480 --time 0.2 --background 20,20,26
```

Output in `out/compare/<name>/`: `studio.png`, `rur/` (a normal render), `diff.png`, `side-by-side.png` and
`report.json`: pixel agreement (`pixels.exactPercent`: the share of pixels whose largest channel difference
is at most 2 of 255), `layout` (every GuiObject's rect matched by path) and `propMismatches` (visual
properties that differ).

## The Studio MCP bridge

rur talks to Studio through an MCP server on a local TCP port: newline-delimited JSON-RPC 2.0, an
`initialize` handshake, then `tools/call` with two tools:

| Tool | Arguments | Result |
|---|---|---|
| `list_roblox_studios` | none | text content holding `{ "studios": [{ "id", "name" }] }`, the open Studio windows |
| `execute_luau` | `studio_id`, `datamodel_type` (`"Edit"`), `code` | text content holding what the chunk returned |

Any bridge that serves these over TCP works; the maintainers run their own. On macOS,
`node tools/studio-mcp-bridge.mjs --port 44755` is one: it serves Studio's own MCP server (StudioMCP, which
Studio runs while Assistant > Manage MCP Servers > "Enable Studio as MCP server" is on) on 127.0.0.1.
Settings:

| Variable | Meaning |
|---|---|
| `RUR_STUDIO_MCP_PORT` | the bridge's port on 127.0.0.1 (required) |
| `RUR_STUDIO` | the Studio to use: its id or part of its window title (default: the only one open; `--studio` overrides) |
| `RUR_STUDIO_LOCK` | the lock file every Studio user takes (default `<temp>/rur/studio.lock`) |
| `RUR_FOCUS=1` | bring Studio to the front for captures (it renders the same unfocused) |

`node tools/studio-mcp.cjs list` lists the open Studios through the bridge; `node tools/studio-mcp.cjs luau
<file.luau>` runs a probe in one.

## What a compare does

- Everything it mounts lives under `CoreGui` and is removed afterwards; nothing is saved and no script is
  edited.
- Studio's frame clock and the order it iterates siblings are recorded and replayed offline, so animation
  and table iteration order don't show up as rendering differences (`--no-clock`, `--ideal`).
- Studio's viewport is nudged to whole logical pixels (a fractional viewport blurs captures), using
  `tools/wincap/` (PowerShell and PrintWindow) on Windows; on macOS it is left as it is.
- Captures are reused while everything they depend on is unchanged (`studio-capture.json` beside
  `studio.png`: the mount, the Studio instance and DPI, and a hash of every source the story loaded).
  `--recapture` always captures; `--reuse-only` never touches Studio.
- Only one capture can use Studio at a time: wrap other tools that mount GUI in Studio with
  `node tools/studio-lock.mjs <command...>`.

## macOS

The capture is `cli/maccap.mjs`. Studio's viewport has no window of its own on macOS, so each compare first
mounts a full-viewport magenta frame under CoreGui, finds it in a capture of Studio's document window and
removes it (a fraction of a second), then mounts the story and captures that rectangle. Captures use
ScreenCaptureKit through `tools/maccap/maccap.swift`, which rur compiles on first use (`swiftc`, from Xcode or
the Command Line Tools; macOS 14 or later):

- **Screen Recording permission** for the app that runs rur (Terminal, an editor, an agent), in System
  Settings > Privacy & Security. Without it window titles are unreadable and captures fail.
- **Lossless sRGB.** The capture asks for sRGB output, which returns the values Studio drew (256 random
  colours and a full-viewport fill came back exact on a P3 display, 2026-11-06). `screencapture -l` does
  not: it colour-matches into the display's space, so sRGB 255,0,255 came back as 234,51,247.
- **Scale.** `Camera.ViewportSize` is in points; the capture is at the display's backing scale, so a
  Retina display compares at 2x (`--dpi` overrides). Moving Studio's window between captures is fine;
  resizing it is caught and the compare is run again.
- Studio need not be in front, and `--focus` does nothing. Studio's own GUI under CoreGui (the view
  selector) sits below the comparison's; anything drawn above the viewport's GUI inside the compared area
  (a floating toolbar or panel) is reported as a warning.
- The projection-stretch calibration uses a 1200x780 viewport; on a smaller Studio viewport it is skipped.

Measured on Apple Silicon with Studio 0.746 (2026-11-06): `corners` 99.996 % exact pixels, `layout-list` and
`image-probe-slice` 100 %, layouts all exact. `gradients` is 60 %: Studio draws its radial, conical and tiled
UIGradients, which rur draws as plain linear ones, and its linear midpoints differ too (not yet checked against Windows
Studio of the same version).

## Parity work

To measure a rule: write a fixture that shows it ([stories.md](stories.md#writing-a-fixture)), compare it,
look at `diff.png` and `node tools/analysis/compare_crop.mjs`, change the renderer or layout, and compare
again (the capture is reused). `tools/sweep/attribute.mjs <compare dir>` attributes differing pixels to
causes (text, strokes, images, shadows, ...). Re-record the goldens only after Studio shows the change is
right.
