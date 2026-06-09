export type SetupCommandKind = "guided" | "check" | "plan" | "apply" | "system";

export type SetupArgs = {
  kind: SetupCommandKind;
  json: boolean;
  yes: boolean;
  dryRun: boolean;
  check: boolean;
  noBrew: boolean;
  help: boolean;
};

export function parseSetupArgs(argv: readonly string[]): SetupArgs {
  const first = argv[0];
  const kind = setupKind(first);
  const flags = first === undefined || kind === "guided" ? argv : argv.slice(1);
  const parsed: SetupArgs = {
    kind,
    json: false,
    yes: false,
    dryRun: false,
    check: false,
    noBrew: false,
    help: false,
  };

  for (const flag of flags) {
    switch (flag) {
      case "--json":
        parsed.json = true;
        break;
      case "--yes":
      case "-y":
        parsed.yes = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--check":
        parsed.check = true;
        break;
      case "--no-brew":
        parsed.noBrew = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown setup option: ${flag}`);
    }
  }

  validateSetupArgs(parsed);
  return parsed;
}

export function setupUsage(): string {
  return [
    "Usage:",
    "  wosm setup",
    "  wosm setup check [--json] [--no-brew]",
    "  wosm setup plan [--json]",
    "  wosm setup apply --yes",
    "  wosm setup apply --dry-run",
    "  wosm setup system --check",
    "  wosm setup system --yes",
    "",
  ].join("\n");
}

function setupKind(value: string | undefined): SetupCommandKind {
  if (value === undefined) return "guided";
  if (value === "check" || value === "plan" || value === "apply" || value === "system") {
    return value;
  }
  if (value.startsWith("-")) return "guided";
  throw new Error(`Unknown setup command: ${value}`);
}

function validateSetupArgs(args: SetupArgs): void {
  if (args.kind === "guided") {
    if (args.dryRun) {
      throw new Error("wosm setup --dry-run is not supported. Use: wosm setup apply --dry-run.");
    }
    if (args.check) {
      throw new Error("wosm setup --check is not supported. Use: wosm setup check.");
    }
    if (args.json) {
      throw new Error("wosm setup --json is not supported. Use: wosm setup check --json.");
    }
    if (args.yes) {
      throw new Error("wosm setup --yes is not supported. Use: wosm setup apply --yes.");
    }
    if (args.noBrew) {
      throw new Error("wosm setup --no-brew is not supported. Use: wosm setup check --no-brew.");
    }
  }
  if (args.json && args.kind !== "check" && args.kind !== "plan") {
    throw new Error("--json is supported for wosm setup check and wosm setup plan.");
  }
  if (args.kind === "check" && args.dryRun) {
    throw new Error("wosm setup check cannot use --dry-run.");
  }
  if (args.kind === "plan" && args.dryRun) {
    throw new Error("wosm setup plan cannot use --dry-run.");
  }
  if (args.kind === "apply" && !args.yes && !args.dryRun) {
    throw new Error("wosm setup apply requires --yes or --dry-run.");
  }
  if (args.kind === "system" && !args.check && !args.yes && !args.help) {
    throw new Error("wosm setup system requires --check or --yes.");
  }
  if (args.kind === "system" && args.check && args.yes) {
    throw new Error("wosm setup system cannot use --check and --yes together.");
  }
  if ((args.kind === "check" || args.kind === "plan") && args.yes) {
    throw new Error(`wosm setup ${args.kind} cannot use --yes.`);
  }
}
