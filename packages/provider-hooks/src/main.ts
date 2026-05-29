#!/usr/bin/env node
import { runProviderIngressMain } from "./command.js";
import { readStdinIfAvailable } from "./stdin.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  runProviderIngressMain(process.argv.slice(2), {
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
