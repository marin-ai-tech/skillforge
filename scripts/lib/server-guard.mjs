#!/usr/bin/env node
// Server guard for scripts/simulate-mvp.mjs. Starts the server entry given as argv[2] and keeps it
// alive only while our stdin is open. The parent never writes to stdin: it ends the pipe to stop the server, and when
// the parent is terminated abruptly the OS closes the pipe — either way the server is stopped, never left behind.
import { spawn } from "node:child_process";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: server-guard.mjs <server entry>");
  process.exit(2);
}

const server = spawn(process.execPath, [entry], {
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
});

let stopping = false;
function stopServer() {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null && server.signalCode === null) server.kill();
  // Hard stop if the server does not exit in time.
  setTimeout(() => {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }, 8000).unref();
}

process.stdin.on("end", stopServer);
process.stdin.on("close", stopServer);
process.stdin.on("error", stopServer);
process.stdin.resume();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, stopServer);

server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
