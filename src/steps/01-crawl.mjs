import fs from "node:fs/promises";
import path from "node:path";
import { KeyManager } from "../core/key-manager.mjs";
import { BrightDataClient } from "../core/brightdata.mjs";
import { StateManager } from "../core/state.mjs";

export async function runCrawlStep({
  config,
  outputDir,
  dryRun = false,
  maxLocations = 0,
  waves = null,
  stateFilter = null,
  keyword = null
}) {
  console.log("\n=======================================================");
  console.log("  STEP 1: GOOGLE MAPS DISCOVERY CRAWLER (AUSTRALIA)    ");
  console.log("=======================================================\n");

  const searchKeyword = keyword || config.preset?.keyword || "hair salon";
  const snapshotDir = path.join(outputDir, "snapshots");
  await fs.mkdir(snapshotDir, { recursive: true });

  const statePath = path.join(outputDir, "crawl-state.json");
  const stateManager = new StateManager(statePath);
  await stateManager.load(config.locations);

  console.log(`[CRAWL] Target Country : ${config.project.country}`);
  console.log(`[CRAWL] Keyword        : "${searchKeyword}"`);
  console.log(`[CRAWL] Output Dir     : ${outputDir}`);
  console.log(`[CRAWL] Dry-Run Mode   : ${dryRun ? "YES (No API requests will be charged)" : "NO (Live run)"}`);

  // Filter locations
  let targetLocations = config.locations;
  if (Array.isArray(waves) && waves.length > 0) {
    targetLocations = targetLocations.filter(l => waves.includes(l.wave));
    console.log(`[CRAWL] Filtered by Waves [${waves.join(", ")}]: ${targetLocations.length} locations`);
  }
  if (stateFilter) {
    targetLocations = targetLocations.filter(l => l.state.toUpperCase() === stateFilter.toUpperCase());
    console.log(`[CRAWL] Filtered by State ${stateFilter}: ${targetLocations.length} locations`);
  }

  // Check state to skip completed
  const pendingLocations = targetLocations.filter(loc => !stateManager.isLocationComplete(loc.id));
  const completedLocations = targetLocations.filter(loc => stateManager.isLocationComplete(loc.id));

  console.log(`[CRAWL] Locations Summary: ${targetLocations.length} total | ${completedLocations.length} already completed | ${pendingLocations.length} pending`);

  if (pendingLocations.length === 0) {
    console.log("✅ All target locations have already been crawled! Nothing to do.");
    return stateManager.getSummary();
  }

  if (dryRun) {
    console.log("\n--- [DRY-RUN INSPECTION] Planned Locations to Crawl ---");
    pendingLocations.forEach((loc, idx) => {
      console.log(`  ${idx + 1}. [Wave ${loc.wave}] ${loc.label} (${loc.state}) - Lat: ${loc.lat}, Long: ${loc.long}, Zoom: ${loc.zoom || 13}`);
    });
    console.log("\n[DRY-RUN] Verification complete. Exiting without spending API credits.\n");
    return stateManager.getSummary();
  }

  // Initialize Key Manager
  const keyManager = new KeyManager({
    candidatePaths: config.brightdata.keys_file_candidates,
    perKeyCap: config.brightdata.per_key_cap || 4500,
    totalCap: config.brightdata.total_cap || 15000
  });
  await keyManager.init();

  const client = new BrightDataClient({
    datasetId: config.brightdata.dataset_id,
    pollIntervalMs: config.brightdata.poll_interval_ms || 20000,
    maxPollMs: config.brightdata.max_poll_ms || 1800000,
    timeoutSeconds: config.brightdata.request_timeout_seconds || 90
  });

  let processedInThisRun = 0;

  for (const loc of pendingLocations) {
    if (maxLocations > 0 && processedInThisRun >= maxLocations) {
      console.log(`[CRAWL] Reached max-locations limit (${maxLocations}) for this run. Stopping.`);
      break;
    }

    const activeKey = keyManager.getActiveKey();
    if (!activeKey) {
      console.error("❌ [FATAL] All available API keys have reached their safety cap or quota! Stopping crawl to avoid card charges.");
      break;
    }

    console.log(`\n▶ [${processedInThisRun + 1}/${pendingLocations.length}] Crawling: ${loc.label} (${loc.state})`);
    console.log(`  Coordinates: ${loc.lat}, ${loc.long} (zoom: ${loc.zoom || 13}) | Key: [${activeKey.fingerprint}]`);

    await stateManager.updateLocation(loc.id, {
      status: "running",
      key_fingerprint: activeKey.fingerprint
    });

    try {
      // 1. Trigger Discovery Job
      console.log("  -> Triggering Bright Data Maps Dataset job...");
      const snapshotId = await client.triggerDiscovery({
        apiKey: activeKey.key,
        location: loc,
        keyword: searchKeyword,
        country: config.project.country || "AU"
      });
      console.log(`  -> Snapshot created: ${snapshotId}`);

      await stateManager.updateLocation(loc.id, { snapshot_id: snapshotId });

      // 2. Poll progress
      console.log("  -> Polling progress until ready (typically 30-120s)...");
      await client.pollSnapshot({
        apiKey: activeKey.key,
        snapshotId,
        onProgress: ({ status, elapsedMs }) => {
          process.stdout.write(`\r  -> Status: ${status} (${Math.round(elapsedMs / 1000)}s) `);
        }
      });
      console.log("\n  -> Snapshot status: READY!");

      // 3. Download Snapshot
      console.log("  -> Downloading snapshot payload...");
      const records = await client.downloadSnapshot({
        apiKey: activeKey.key,
        snapshotId
      });

      const recordCount = records.length;
      console.log(`  -> Downloaded ${recordCount} raw records.`);

      // 4. Save Snapshot to disk
      const snapshotFile = path.join(snapshotDir, `${loc.id}.json`);
      await fs.writeFile(snapshotFile, JSON.stringify(records, null, 2), "utf8");

      // 5. Update Key Manager & State
      keyManager.recordUsage(activeKey.index, recordCount);
      await stateManager.updateLocation(loc.id, {
        status: "complete",
        snapshot_id: snapshotId,
        raw_count: recordCount,
        error: null
      });

      processedInThisRun++;
      console.log(`  ✓ Successfully saved snapshot to ${snapshotFile}`);
      console.log(`  Key [${activeKey.fingerprint}] usage: ${activeKey.recordsDelivered}/${keyManager.perKeyCap} records`);

    } catch (err) {
      console.error(`\n❌ [ERROR] Failed to crawl ${loc.label}:`, err.message);

      await stateManager.updateLocation(loc.id, {
        status: "error",
        error: err.message
      });

      // Handle key quota exhaustion or rotation
      if (err.status === 402 || err.message.includes("insufficient_balance") || err.message.includes("quota")) {
        console.warn(`[CRAWL] Key ${activeKey.fingerprint} appears exhausted. Attempting rotation...`);
        keyManager.rotateKey("HTTP 402 / Quota Exceeded");
      } else if (err.status === 400 && err.message.includes("Customer is not active")) {
        console.error("❌ [BLOCKED] Account is not activated for Google Maps Dataset API. Check Bright Data subscription.");
        break;
      }
    }
  }

  const finalSummary = stateManager.getSummary();
  console.log("\n-------------------------------------------------------");
  console.log("  CRAWL STEP COMPLETED");
  console.log(`  Total locations   : ${finalSummary.total}`);
  console.log(`  Completed         : ${finalSummary.complete}`);
  console.log(`  Pending           : ${finalSummary.pending}`);
  console.log(`  Errors            : ${finalSummary.errors}`);
  console.log(`  Total Raw Records : ${finalSummary.total_raw_records}`);
  console.log("-------------------------------------------------------\n");

  return finalSummary;
}
