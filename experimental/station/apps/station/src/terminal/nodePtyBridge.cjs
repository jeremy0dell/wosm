#!/usr/bin/env node

const nodePty = require("node-pty");
const readline = require("node:readline");

const [, , encodedOptions] = process.argv;

if (!encodedOptions) {
  process.stderr.write("Missing node-pty bridge options.\n");
  process.exit(2);
}

const options = JSON.parse(Buffer.from(encodedOptions, "base64url").toString("utf8"));
const pty = nodePty.spawn(options.command, options.args, {
  cols: options.cols,
  cwd: options.cwd,
  env: options.env,
  name: options.name,
  rows: options.rows,
});

send({
  type: "ready",
  pid: pty.pid,
});

pty.onData((data) => {
  send({
    type: "data",
    data,
  });
});

pty.onExit((event) => {
  send({
    type: "exit",
    exitCode: event.exitCode,
    signal: event.signal,
  });
  process.exit(0);
});

const commands = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

commands.on("line", (line) => {
  const command = JSON.parse(line);

  switch (command.type) {
    case "write":
      pty.write(command.data);
      break;
    case "resize":
      pty.resize(command.cols, command.rows);
      break;
    case "kill":
      pty.kill(command.signal);
      break;
  }
});

process.on("SIGTERM", () => {
  pty.kill();
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
