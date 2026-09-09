#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCrawlStep } from "./steps/01-crawl.mjs";
import { runProcessStep } from "./steps/02-process.mjs";
import { runEmailStep } from "./steps/03-email.mjs";
import { runExportStep } from "./steps/04-export.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

function parseArgs(args) {
  const parsed = {
    command: args[0] || "help",
    options: {}
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed.options[key] = next;
        i++;
      } else {
        parsed.options[key] = true;
      }
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
=============================================================================
  BRIGHT DATA GOOGLE MAPS CRAWLER (AUSTRALIA) - PRODUCTION CLI
=============================================================================

Usage:
  node src/cli.mjs <command> [options]

Commands:
  run          Run the full 4-stage automated pipeline (Crawl -> Process -> Email -> Export)
  crawl        Execute Stage 1: Google Maps Discovery Crawl across Australia
  process      Execute Stage 2: Deduplication, category filtering & trust tiering
  emails       Execute Stage 3: Zero-cost website email extraction
  export       Execute Stage 4: Export Master & Outreach-ready CSV reports
  help         Display this help guide

Options:
  --preset <name>       Preset configuration: hairfolli | commercial-cleaning | beauty-spas
  --keyword <query>     Custom search keyword (e.g. "dental clinic", "gym")
  --waves <1,2,3,4>     Comma-separated location waves (e.g. --waves 1,2 for NSW)
  --state <NSW|VIC...>  Filter locations by specific Australian State
  --dry-run             Inspect coordinates and budget without making billable requests
  --max-locations <N>   Limit crawler to N locations for testing/smoke checks
  --output-dir <path>   Custom output directory (default: reports/<preset>-<date>)

Examples:
  # 1. Test inspection without spending credits:
  node src/cli.mjs crawl --dry-run

  # 2. Smoke test 1 location with Hairfolli preset:
  node src/cli.mjs crawl --preset hairfolli --max-locations 1

  # 3. Run full automated pipeline for Commercial Cleaning:
  node src/cli.mjs run --preset commercial-cleaning

  # 4. Custom niche keyword crawl in Victoria:
  node src/cli.mjs crawl --keyword "physiotherapy" --state VIC
=============================================================================
`);
}

async function loadConfig(presetName) {
  const defaultConfigPath = path.join(ROOT_DIR, "config/default.json");
  const defaultRaw = await fs.readFile(defaultConfigPath, "utf8");
  const config = JSON.parse(defaultRaw);

  if (presetName) {
    const presetPath = path.join(ROOT_DIR, `config/presets/${presetName}.json`);
    try {
      const presetRaw = await fs.readFile(presetPath, "utf8");
      config.preset = JSON.parse(presetRaw);
    } catch {
      console.warn(`⚠️ Warning: Preset '${presetName}' not found. Using defaults.`);
    }
  }

  return config;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || options.help) {
    printHelp();
    return;
  }

  const presetName = options.preset || "hairfolli";
  const config = await loadConfig(presetName);

  const runDate = new Date().toISOString().slice(0, 10);
  const defaultDirName = `${presetName}-leads-${runDate}`;
  const outputDir = options["output-dir"]
    ? path.resolve(options["output-dir"])
    : path.join(ROOT_DIR, "reports", defaultDirName);

  await fs.mkdir(outputDir, { recursive: true });

  const waves = options.waves
    ? options.waves.split(",").map(w => Number(w.trim())).filter(Boolean)
    : config.preset?.default_waves || [1, 2, 3, 4];

  const stateFilter = options.state || null;
  const keyword = options.keyword || config.preset?.keyword;
  const dryRun = Boolean(options["dry-run"]);
  const maxLocations = Number(options["max-locations"] || 0);

  console.log(`[INIT] Loaded configuration for: ${config.preset?.name || "Generic Crawl"}`);
  console.log(`[INIT] Destination folder      : ${outputDir}`);

  switch (command) {
    case "crawl": {
      await runCrawlStep({
        config,
        outputDir,
        dryRun,
        maxLocations,
        waves,
        stateFilter,
        keyword
      });
      break;
    }

    case "process": {
      await runProcessStep({
        config,
        outputDir,
        requireWebsite: config.preset?.require_website !== false,
        categoryKeywords: config.preset?.category_keywords,
        excludeCategories: config.preset?.exclude_categories
      });
      break;
    }

    case "emails": {
      await runEmailStep({
        config,
        outputDir
      });
      break;
    }

    case "export": {
      await runExportStep({
        config,
        outputDir
      });
      break;
    }

    case "run": {
      console.log("\n🚀 Starting Full 4-Stage Autonomous Pipeline...\n");

      // Stage 1
      await runCrawlStep({
        config,
        outputDir,
        dryRun,
        maxLocations,
        waves,
        stateFilter,
        keyword
      });

      if (dryRun) {
        console.log("Dry-run complete. Skipping processing steps.");
        break;
      }

      // Stage 2
      await runProcessStep({
        config,
        outputDir,
        requireWebsite: config.preset?.require_website !== false,
        categoryKeywords: config.preset?.category_keywords,
        excludeCategories: config.preset?.exclude_categories
      });

      // Stage 3
      await runEmailStep({
        config,
        outputDir
      });

      // Stage 4
      await runExportStep({
        config,
        outputDir
      });

      console.log("🏁 All 4 stages finished successfully! Outputs ready for client delivery.");
      break;
    }

    default:
      console.error(`Unknown command: '${command}'. Use 'node src/cli.mjs help' for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error("\n❌ Fatal Error:", err);
  process.exit(1);
});
