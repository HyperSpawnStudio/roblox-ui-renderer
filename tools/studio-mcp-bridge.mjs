#!/usr/bin/env node
// A Studio MCP bridge (docs/studio.md): serves Roblox Studio's own MCP server on a local TCP port, newline-delimited
// JSON-RPC, as rur (RUR_STUDIO_MCP_PORT: tools/studio-mcp.cjs, rur compare) and roblox-object-renderer (ROR_STUDIO_MCP)
// expect. Studio ships the server as a stdio proxy, StudioMCP, whose tools include the two they call:
// list_roblox_studios and execute_luau (studio_id, datamodel_type, code). Studio serves it only while Assistant >
// Manage MCP Servers > "Enable Studio as MCP server" is on.
//
//   node tools/studio-mcp-bridge.mjs [--port 44755]
//   RUR_STUDIO_MCP_PORT=44755 node tools/studio-mcp.cjs list
//
// One StudioMCP process serves every connection: it is started and initialized once (it needs a moment to reach
// Studio after that), each connection's initialize is answered here, and its requests go through with ids of the
// bridge's own, so replies return to the connection that asked. A StudioMCP that exits is started again on the next
// request. Listens on 127.0.0.1 only.
//
// STUDIO_MCP_BIN names the StudioMCP executable; the default is the one inside the newest RobloxStudio.app
// (macOS: cli/macstudio.mjs).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { macStudioApps } from "../cli/macstudio.mjs";

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.RUR_STUDIO_MCP_PORT || 44755);
const WARMUP_MS = Number(process.env.STUDIO_MCP_WARMUP_MS || 1500);

function studioMcpBinary() {
	if (process.env.STUDIO_MCP_BIN) return process.env.STUDIO_MCP_BIN;
	const found = macStudioApps().map(app => path.join(app, "Contents", "MacOS", "StudioMCP")).find(file => fs.existsSync(file));
	if (!found) throw new Error("no StudioMCP found: set STUDIO_MCP_BIN to Roblox Studio's StudioMCP executable");
	return found;
}

const log = message => process.stderr.write(`studio-mcp-bridge: ${message}\n`);

// The one StudioMCP, started on first use
let upstream = null;
let nextUpstreamId = 1;

function startUpstream() {
	const binary = studioMcpBinary();
	const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
	const state = { child, pending: new Map(), buffer: "", exited: false };
	child.stderr.on("data", chunk => log(`StudioMCP: ${String(chunk).trim()}`));
	child.stdout.on("data", chunk => {
		state.buffer += chunk.toString("utf8");
		let index;
		while ((index = state.buffer.indexOf("\n")) >= 0) {
			const line = state.buffer.slice(0, index).trim();
			state.buffer = state.buffer.slice(index + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			const waiter = message.id !== undefined && state.pending.get(message.id);
			if (!waiter) continue;
			state.pending.delete(message.id);
			waiter(message);
		}
	});
	child.on("exit", code => {
		state.exited = true;
		log(`StudioMCP exited (${code}); the next request starts it again`);
		for (const waiter of state.pending.values()) waiter({ error: { code: -32000, message: "StudioMCP exited" } });
		state.pending.clear();
		if (upstream === state) upstream = null;
	});
	child.stdin.on("error", () => {});
	state.send = (method, params) => new Promise(resolve => {
		const id = nextUpstreamId++;
		state.pending.set(id, resolve);
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
	});
	state.ready = state.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "studio-mcp-bridge", version: "0.1.0" } }).then(async reply => {
		if (reply.error) throw new Error(`StudioMCP initialize: ${JSON.stringify(reply.error)}`);
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
		await new Promise(resolve => setTimeout(resolve, WARMUP_MS));
		log(`StudioMCP ready (${binary}, pid ${child.pid})`);
		return reply.result;
	});
	state.ready.catch(() => {});
	return state;
}

function upstreamState() {
	if (!upstream || upstream.exited) upstream = startUpstream();
	return upstream;
}

function serve(socket) {
	let buffer = "";
	const reply = message => {
		if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
	};
	const handle = async message => {
		if (message.id === undefined) return; // notifications (initialized, cancelled) stay here
		try {
			const state = upstreamState();
			const init = await state.ready;
			if (message.method === "initialize") {
				reply({ id: message.id, result: { ...init, protocolVersion: message.params?.protocolVersion || init.protocolVersion, serverInfo: { name: "studio-mcp-bridge", version: "0.1.0" } } });
				return;
			}
			const answer = await state.send(message.method, message.params);
			reply(answer.error ? { id: message.id, error: answer.error } : { id: message.id, result: answer.result });
		} catch (error) {
			reply({ id: message.id, error: { code: -32000, message: error.message } });
		}
	};
	socket.on("data", chunk => {
		buffer += chunk.toString("utf8");
		let index;
		while ((index = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				reply({ id: null, error: { code: -32700, message: "parse error" } });
				continue;
			}
			handle(message);
		}
	});
	socket.on("error", () => {});
}

const server = net.createServer(serve);
server.on("error", error => {
	log(error.code === "EADDRINUSE" ? `port ${PORT} is in use (another bridge?); pick one with --port` : error.message);
	process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
	log(`listening on 127.0.0.1:${PORT} (RUR_STUDIO_MCP_PORT=${PORT}, ROR_STUDIO_MCP=${PORT})`);
	upstreamState();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		upstream?.child.kill();
		process.exit(0);
	});
}
