import fs from "node:fs/promises";
import path from "node:path";

function escapeCsvField(field) {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function runExportStep({ config, outputDir }) {
  console.log("\n=======================================================");
  console.log("  STEP 4: EXPORTING CLEAN CSV & DASHBOARD REPORTS      ");
  console.log("=======================================================\n");

  const enrichedPath = path.join(outputDir, "enriched-leads-with-emails.json");
  const dedupedPath = path.join(outputDir, "deduped-leads.json");

  let leads = [];
  let hasEnrichedEmails = false;

  try {
    const raw = await fs.readFile(enrichedPath, "utf8");
    leads = JSON.parse(raw);
    hasEnrichedEmails = true;
  } catch {
    try {
      const raw = await fs.readFile(dedupedPath, "utf8");
      leads = JSON.parse(raw);
      console.log("⚠️ Notice: Enriched email file not found; exporting based on deduped leads.");
    } catch {
      console.error(`❌ Neither ${enrichedPath} nor ${dedupedPath} found. Run previous steps first.`);
      return null;
    }
  }

  const csvHeaders = [
    "Rank",
    "Trust Tier",
    "Business Name",
    "Primary Email",
    "All Approved Emails",
    "Email Count",
    "Outreach Status",
    "Phone Number",
    "Website URL",
    "Google Rating",
    "Reviews Count",
    "Distance to CBD (km)",
    "Category",
    "Full Address",
    "Place ID",
    "Google CID",
    "Google Maps URL",
    "Discovered In Locations"
  ];

  const allRows = [csvHeaders.join(",")];
  const outreachReadyRows = [csvHeaders.join(",")];

  let emailCount = 0;
  let phoneCount = 0;

  leads.forEach((l, idx) => {
    const rank = l.rank || idx + 1;
    const tier = l.trust_tier || "C";
    const name = l.name || "";
    const emails = Array.isArray(l.emails) ? l.emails : [];
    const primaryEmail = emails[0] || "";
    const allEmailsStr = emails.join("; ");
    const emailStatus = emails.length > 0 ? "Outreach Ready" : "No Email Found";
    const phone = l.phone || "";
    const website = l.website || "";
    const rating = l.rating || "";
    const reviews = l.reviews_count || 0;
    const distance = l.distance_to_ref_km !== null && l.distance_to_ref_km !== undefined ? l.distance_to_ref_km : "";
    const category = l.category || "";
    const address = l.address || "";
    const placeId = l.place_id || "";
    const cid = l.cid || "";
    const mapsUrl = l.google_maps_url || "";
    const sourceLocations = (l._source_locations || []).join("; ");

    if (emails.length > 0) emailCount++;
    if (phone) phoneCount++;

    const row = [
      escapeCsvField(rank),
      escapeCsvField(tier),
      escapeCsvField(name),
      escapeCsvField(primaryEmail),
      escapeCsvField(allEmailsStr),
      escapeCsvField(emails.length),
      escapeCsvField(emailStatus),
      escapeCsvField(phone),
      escapeCsvField(website),
      escapeCsvField(rating),
      escapeCsvField(reviews),
      escapeCsvField(distance),
      escapeCsvField(category),
      escapeCsvField(address),
      escapeCsvField(placeId),
      escapeCsvField(cid),
      escapeCsvField(mapsUrl),
      escapeCsvField(sourceLocations)
    ].join(",");

    allRows.push(row);
    if (emails.length > 0) {
      outreachReadyRows.push(row);
    }
  });

  const masterCsvPath = path.join(outputDir, "master-leads-all.csv");
  const outreachCsvPath = path.join(outputDir, "outreach-ready-emails.csv");
  const dashboardPath = path.join(outputDir, "dashboard-summary.json");

  await fs.writeFile(masterCsvPath, allRows.join("\n"), "utf8");
  await fs.writeFile(outreachCsvPath, outreachReadyRows.join("\n"), "utf8");

  const dashboardSummary = {
    exported_at: new Date().toISOString(),
    total_leads: leads.length,
    leads_with_phone: phoneCount,
    leads_with_phone_pct: ((phoneCount / leads.length) * 100).toFixed(1),
    leads_with_email: emailCount,
    leads_with_email_pct: ((emailCount / leads.length) * 100).toFixed(1),
    tier_counts: {
      "A+": leads.filter(l => l.trust_tier === "A+").length,
      "A": leads.filter(l => l.trust_tier === "A").length,
      "B": leads.filter(l => l.trust_tier === "B").length,
      "C": leads.filter(l => l.trust_tier === "C").length,
      "D": leads.filter(l => l.trust_tier === "D").length,
      "E": leads.filter(l => l.trust_tier === "E").length
    },
    files: {
      master_csv: masterCsvPath,
      outreach_csv: outreachCsvPath
    }
  };

  await fs.writeFile(dashboardPath, JSON.stringify(dashboardSummary, null, 2), "utf8");

  console.log(`✓ Master CSV saved to         : ${masterCsvPath} (${allRows.length - 1} rows)`);
  console.log(`✓ Outreach Email CSV saved to : ${outreachCsvPath} (${outreachReadyRows.length - 1} rows)`);
  console.log(`✓ Dashboard summary saved to  : ${dashboardPath}\n`);

  return dashboardSummary;
}
