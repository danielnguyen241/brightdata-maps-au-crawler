import fs from "node:fs/promises";
import path from "node:path";
import { EMAIL_REGEX, cleanEmails } from "../utils/email-cleaner.mjs";

export async function runEmailStep({
  config,
  outputDir,
  concurrency = null,
  timeoutMs = null
}) {
  console.log("\n=======================================================");
  console.log("  STEP 3: ZERO-COST WEBSITE & EMAIL SCRAPING PIPELINE  ");
  console.log("=======================================================\n");

  const dedupedPath = path.join(outputDir, "deduped-leads.json");
  let leads = [];
  try {
    const raw = await fs.readFile(dedupedPath, "utf8");
    leads = JSON.parse(raw);
  } catch {
    console.error(`❌ Missing ${dedupedPath}. Run step 2 (process) first.`);
    return null;
  }

  const poolConcurrency = concurrency || config.email_scraper?.concurrency || 35;
  const requestTimeout = timeoutMs || config.email_scraper?.timeout_ms || 6000;
  const subpaths = config.email_scraper?.subpaths || ["", "/contact", "/contact-us", "/about", "/about-us"];
  const userAgent = config.email_scraper?.user_agent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
  const maxEmailsPerLead = config.email_scraper?.max_emails_per_lead || 2;

  const checkpointPath = path.join(outputDir, "email-checkpoint.json");
  let checkpoint = {};
  try {
    const cpRaw = await fs.readFile(checkpointPath, "utf8");
    checkpoint = JSON.parse(cpRaw);
    console.log(`[EMAIL] Found existing checkpoint with ${Object.keys(checkpoint).length} scraped domains.`);
  } catch {
    checkpoint = {};
  }

  console.log(`[EMAIL] Total leads to process : ${leads.length}`);
  console.log(`[EMAIL] Concurrency workers    : ${poolConcurrency}`);
  console.log(`[EMAIL] Request timeout        : ${requestTimeout}ms`);
  console.log(`[EMAIL] Probing subpaths       : ${subpaths.join(", ")}`);

  async function fetchHtml(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        redirect: "follow"
      });
      clearTimeout(timeoutId);
      if (!res.ok) return "";
      const text = await res.text();
      return text;
    } catch {
      return "";
    }
  }

  async function scrapeWebsiteEmails(websiteUrl) {
    if (!websiteUrl) return [];
    let parsed;
    try {
      parsed = new URL(websiteUrl);
    } catch {
      return [];
    }

    const baseUrl = `${parsed.protocol}//${parsed.host}`;
    const urlsToProbe = subpaths.map(p => p === "" ? websiteUrl : `${baseUrl}${p}`);
    const uniqueProbeUrls = Array.from(new Set(urlsToProbe));

    const foundEmails = new Set();

    for (const targetUrl of uniqueProbeUrls) {
      const html = await fetchHtml(targetUrl);
      if (html) {
        const matches = html.match(EMAIL_REGEX);
        if (matches) {
          const valid = cleanEmails(matches);
          valid.forEach(e => foundEmails.add(e));
        }
      }
      if (foundEmails.size >= maxEmailsPerLead) break;
    }

    return Array.from(foundEmails);
  }

  // Domain cache to avoid scraping the same multi-location franchise website repeatedly
  const domainCache = new Map();

  let processedCount = 0;
  let emailsFoundCount = 0;

  for (let i = 0; i < leads.length; i += poolConcurrency) {
    const batch = leads.slice(i, i + poolConcurrency);

    await Promise.all(batch.map(async (lead) => {
      const leadKey = lead.place_id || lead.cid || lead.website || lead.name;

      // Checkpoint check
      if (checkpoint[leadKey] && Array.isArray(checkpoint[leadKey].emails)) {
        lead.emails = checkpoint[leadKey].emails;
        if (lead.emails.length > 0) emailsFoundCount++;
        processedCount++;
        return;
      }

      if (!lead.website) {
        lead.emails = [];
        checkpoint[leadKey] = { emails: [] };
        processedCount++;
        return;
      }

      let host = null;
      try {
        host = new URL(lead.website).host.toLowerCase();
      } catch {}

      if (host && domainCache.has(host)) {
        lead.emails = domainCache.get(host);
      } else {
        const emails = await scrapeWebsiteEmails(lead.website);
        lead.emails = emails;
        if (host) domainCache.set(host, emails);
      }

      checkpoint[leadKey] = { emails: lead.emails };
      if (lead.emails.length > 0) emailsFoundCount++;
      processedCount++;
    }));

    const pct = ((processedCount / leads.length) * 100).toFixed(1);
    const hitRate = processedCount > 0 ? ((emailsFoundCount / processedCount) * 100).toFixed(1) : 0;
    process.stdout.write(`\r[EMAIL PROGRESS] ${processedCount}/${leads.length} (${pct}%) | Verified Emails: ${emailsFoundCount} (Hit rate: ${hitRate}%) `);

    // Save checkpoint every batch
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
  }

  console.log("\n\n✓ Email scraping complete.");

  const enrichedPath = path.join(outputDir, "enriched-leads-with-emails.json");
  await fs.writeFile(enrichedPath, JSON.stringify(leads, null, 2), "utf8");
  console.log(`✓ Saved enriched leads to ${enrichedPath}\n`);

  return {
    total_leads: leads.length,
    processed_count: processedCount,
    emails_found_count: emailsFoundCount,
    hit_rate_pct: ((emailsFoundCount / leads.length) * 100).toFixed(1)
  };
}
