#!/usr/bin/env node
import { runHookRunner } from "./index.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  runHookRunner(process.argv.slice(2), {
    stdin: await readStdinIfAvailable(),
    env: process.env,
  }).then((result) => {
    if (result.stdout.length > 0) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr.length > 0) {
      process.stderr.write(result.stderr);
    }
    process.exitCode = result.code;
  });
}

async function readStdinIfAvailable(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
