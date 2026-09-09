import fs from "node:fs/promises";
import path from "node:path";
import { haversineDistanceKm } from "../utils/geo.mjs";

export async function runProcessStep({
  config,
  outputDir,
  requireWebsite = true,
  categoryKeywords = null,
  excludeCategories = null
}) {
  console.log("\n=======================================================");
  console.log("  STEP 2: FILTERING, DEDUPLICATION & TRUST SCORING     ");
  console.log("=======================================================\n");

  const snapshotDir = path.join(outputDir, "snapshots");
  let snapshotFiles = [];
  try {
    const files = await fs.readdir(snapshotDir);
    snapshotFiles = files.filter(f => f.endsWith(".json"));
  } catch {
    console.error(`❌ No snapshots directory found at ${snapshotDir}. Please run step 1 (crawl) first.`);
    return null;
  }

  if (snapshotFiles.length === 0) {
    console.error(`❌ No snapshot JSON files found in ${snapshotDir}.`);
    return null;
  }

  console.log(`[PROCESS] Found ${snapshotFiles.length} snapshot files to process.`);

  const refLat = config.project.reference_lat || -33.8688;
  const refLong = config.project.reference_long || 151.2093;
  const tiers = config.trust_tiers || [
    { tier: "A+", min_reviews: 500 },
    { tier: "A", min_reviews: 200 },
    { tier: "B", min_reviews: 100 },
    { tier: "C", min_reviews: 30 },
    { tier: "D", min_reviews: 10 },
    { tier: "E", min_reviews: 0 }
  ];

  function getTrustTier(reviewCount) {
    const count = Number(reviewCount) || 0;
    for (const t of tiers) {
      if (count >= t.min_reviews) return t.tier;
    }
    return "E";
  }

  // 1. Ingest all raw records
  const allRawRecords = [];
  let totalRawRecords = 0;

  for (const file of snapshotFiles) {
    const locId = file.replace(/\.json$/, "");
    try {
      const content = await fs.readFile(path.join(snapshotDir, file), "utf8");
      const records = JSON.parse(content);
      if (Array.isArray(records)) {
        for (const r of records) {
          totalRawRecords++;
          r._source_location = locId;
          allRawRecords.push(r);
        }
      }
    } catch (e) {
      console.warn(`⚠️ Warning: could not parse ${file}: ${e.message}`);
    }
  }

  console.log(`[PROCESS] Ingested ${totalRawRecords} raw records across all snapshots.`);

  // 2. Filtering
  const targetCategories = categoryKeywords || config.preset?.category_keywords || [];
  const bannedCategories = excludeCategories || config.preset?.exclude_categories || [];

  let countClosed = 0;
  let countNonAU = 0;
  let countNoWebsite = 0;
  let countIrrelevant = 0;
  const qualifiedRaw = [];

  for (const r of allRawRecords) {
    // Check closed status
    if (r.is_permanently_closed || r.is_temporarily_closed || r.status === "CLOSED_PERMANENTLY") {
      countClosed++;
      continue;
    }

    // Check Australian country code or address
    const countryCode = (r.country_code || r.country || "").toUpperCase();
    const address = (r.address || r.formatted_address || "").toLowerCase();
    if (countryCode && countryCode !== "AU" && !address.includes("australia") && !address.includes("nsw") && !address.includes("vic") && !address.includes("qld")) {
      countNonAU++;
      continue;
    }

    // Check website
    const website = (r.website || r.url || r.open_website || "").trim();
    if (requireWebsite && !website) {
      countNoWebsite++;
      continue;
    }

    // Check category relevance if specified
    if (targetCategories.length > 0 || bannedCategories.length > 0) {
      const cats = [
        r.category,
        r.primary_category,
        ...(Array.isArray(r.categories) ? r.categories : [])
      ].filter(Boolean).map(c => String(c).toLowerCase());

      const allCatText = cats.join(" ");

      if (bannedCategories.some(b => allCatText.includes(b.toLowerCase()))) {
        countIrrelevant++;
        continue;
      }

      if (targetCategories.length > 0 && !targetCategories.some(t => allCatText.includes(t.toLowerCase()))) {
        countIrrelevant++;
        continue;
      }
    }

    qualifiedRaw.push(r);
  }

  console.log(`[PROCESS] Filtering results:`);
  console.log(`  - Closed businesses removed   : ${countClosed}`);
  console.log(`  - Non-AU records removed      : ${countNonAU}`);
  console.log(`  - Missing website removed     : ${countNoWebsite}`);
  console.log(`  - Irrelevant category removed : ${countIrrelevant}`);
  console.log(`  - Qualified leads before dedupe: ${qualifiedRaw.length}`);

  // 3. Deduplication
  const dedupeMap = new Map();

  for (const r of qualifiedRaw) {
    const placeId = r.place_id;
    const cid = r.cid || r.data_cid;
    const phone = (r.phone || r.international_phone || "").replace(/\D/g, "");
    const name = (r.name || r.title || "").toLowerCase().trim();
    const addr = (r.address || r.formatted_address || "").toLowerCase().trim();

    // Dedupe key priority: place_id > cid > phone+name
    let dedupeKey = null;
    if (placeId) {
      dedupeKey = `place_id:${placeId}`;
    } else if (cid) {
      dedupeKey = `cid:${cid}`;
    } else if (phone && name) {
      dedupeKey = `phone:${phone}:${name}`;
    } else {
      dedupeKey = `fallback:${name}:${addr.slice(0, 30)}`;
    }

    if (dedupeMap.has(dedupeKey)) {
      const existing = dedupeMap.get(dedupeKey);
      // Merge source location labels
      if (r._source_location && !existing._source_locations.includes(r._source_location)) {
        existing._source_locations.push(r._source_location);
      }
      // Retain richer record
      if ((r.reviews_count || 0) > (existing.reviews_count || 0)) {
        Object.assign(existing, r);
      }
    } else {
      const lead = {
        name: r.name || r.title || "",
        category: r.category || r.primary_category || (Array.isArray(r.categories) ? r.categories[0] : ""),
        phone: r.phone || r.international_phone || "",
        website: r.website || r.url || r.open_website || "",
        address: r.address || r.formatted_address || "",
        latitude: r.latitude || r.lat || null,
        longitude: r.longitude || r.long || null,
        rating: r.rating || r.total_score || null,
        reviews_count: Number(r.reviews_count || r.reviews || 0),
        place_id: r.place_id || null,
        cid: r.cid || r.data_cid || null,
        google_maps_url: r.google_maps_url || r.url_maps || (r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : ""),
        _source_locations: [r._source_location]
      };

      // Calculate distance to reference CBD
      lead.distance_to_ref_km = haversineDistanceKm(lead.latitude, lead.longitude, refLat, refLong);

      // Assign trust tier
      lead.trust_tier = getTrustTier(lead.reviews_count);

      dedupeMap.set(dedupeKey, lead);
    }
  }

  const dedupedLeads = Array.from(dedupeMap.values());
  console.log(`[PROCESS] Unique deduplicated leads: ${dedupedLeads.length} (Removed ${qualifiedRaw.length - dedupedLeads.length} duplicates)`);

  // 4. Ranking & Sorting
  const tierWeights = { "A+": 6, "A": 5, "B": 4, "C": 3, "D": 2, "E": 1 };
  dedupedLeads.sort((a, b) => {
    // 1st: Trust tier
    const weightDiff = (tierWeights[b.trust_tier] || 0) - (tierWeights[a.trust_tier] || 0);
    if (weightDiff !== 0) return weightDiff;

    // 2nd: Distance to CBD (closer comes first)
    if (a.distance_to_ref_km !== null && b.distance_to_ref_km !== null) {
      if (a.distance_to_ref_km !== b.distance_to_ref_km) {
        return a.distance_to_ref_km - b.distance_to_ref_km;
      }
    }

    // 3rd: Review count
    if (b.reviews_count !== a.reviews_count) {
      return b.reviews_count - a.reviews_count;
    }

    // 4th: Rating
    return (b.rating || 0) - (a.rating || 0);
  });

  // Assign final ranks
  dedupedLeads.forEach((lead, idx) => {
    lead.rank = idx + 1;
  });

  // 5. Save outputs
  const dedupedPath = path.join(outputDir, "deduped-leads.json");
  const reportPath = path.join(outputDir, "processing-report.json");

  await fs.writeFile(dedupedPath, JSON.stringify(dedupedLeads, null, 2), "utf8");

  const processingReport = {
    processed_at: new Date().toISOString(),
    total_raw_records: totalRawRecords,
    qualified_before_dedupe: qualifiedRaw.length,
    duplicates_removed: qualifiedRaw.length - dedupedLeads.length,
    final_unique_leads: dedupedLeads.length,
    filters: {
      closed_removed: countClosed,
      non_au_removed: countNonAU,
      no_website_removed: countNoWebsite,
      irrelevant_category_removed: countIrrelevant
    },
    tier_distribution: tiers.map(t => ({
      tier: t.tier,
      count: dedupedLeads.filter(l => l.trust_tier === t.tier).length
    }))
  };

  await fs.writeFile(reportPath, JSON.stringify(processingReport, null, 2), "utf8");

  console.log(`\n✓ Saved deduped leads to ${dedupedPath}`);
  console.log(`✓ Saved processing report to ${reportPath}\n`);

  return processingReport;
}
