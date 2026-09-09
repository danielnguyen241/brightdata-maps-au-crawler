import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class BrightDataClient {
  constructor({
    datasetId = "gd_m8ebnr0q2qlklc02fz",
    pollIntervalMs = 20000,
    maxPollMs = 1800000,
    timeoutSeconds = 90
  } = {}) {
    this.datasetId = datasetId;
    this.pollIntervalMs = pollIntervalMs;
    this.maxPollMs = maxPollMs;
    this.timeoutSeconds = timeoutSeconds;
  }

  async curlJson({ method = "GET", url, apiKey, body }) {
    const args = [
      "--silent",
      "--show-error",
      "--http1.1",
      "--max-time", String(this.timeoutSeconds),
      "--retry", "2",
      "--retry-all-errors",
      "--request", method,
      url,
      "--header", `Authorization: Bearer ${apiKey}`,
      "--write-out", "\n__STATUS__:%{http_code}",
    ];

    if (body !== undefined) {
      args.push(
        "--header", "Content-Type: application/json",
        "--data-binary", JSON.stringify(body)
      );
    }

    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 200 * 1024 * 1024 });
    const statusMatch = stdout.match(/\n__STATUS__:(\d{3})$/);
    const status = Number(statusMatch ? statusMatch[1] : 0);
    const text = stdout.replace(/\n__STATUS__:\d{3}$/, "").trim();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }

    if (status < 200 || status >= 300) {
      const message = typeof payload === "string"
        ? payload.slice(0, 500)
        : payload?.message || payload?.error || JSON.stringify(payload).slice(0, 500);
      const err = new Error(`Bright Data HTTP ${status}: ${message}`);
      err.status = status;
      err.payload = payload;
      throw err;
    }

    return { status, payload };
  }

  /**
   * Triggers a discovery job on Google Maps Dataset v3 by location coordinates
   */
  async triggerDiscovery({ apiKey, location, keyword, country = "AU" }) {
    const url = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${this.datasetId}&format=json&type=discover_new&discover_by=location`;
    const payload = [
      {
        country,
        lat: location.lat,
        long: location.long,
        zoom_level: location.zoom || 13,
        keyword: keyword
      }
    ];

    const res = await this.curlJson({
      method: "POST",
      url,
      apiKey,
      body: payload
    });

    const snapshotId = res.payload?.snapshot_id || res.payload?.id;
    if (!snapshotId) {
      throw new Error(`Failed to trigger job for ${location.label}: No snapshot_id returned.`);
    }

    return snapshotId;
  }

  /**
   * Polls progress until snapshot status is 'ready'
   */
  async pollSnapshot({ apiKey, snapshotId, onProgress }) {
    const startTime = Date.now();
    const url = `https://api.brightdata.com/datasets/v3/progress/${snapshotId}`;

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > this.maxPollMs) {
        throw new Error(`Timeout waiting for snapshot ${snapshotId} after ${Math.round(elapsed / 1000)}s.`);
      }

      const res = await this.curlJson({ method: "GET", url, apiKey });
      const status = res.payload?.status;

      if (typeof onProgress === "function") {
        onProgress({ snapshotId, status, payload: res.payload, elapsedMs: elapsed });
      }

      if (status === "ready") {
        return res.payload;
      }

      if (status === "failed" || status === "cancelled") {
        throw new Error(`Snapshot ${snapshotId} ended with fatal status: '${status}'. Reason: ${JSON.stringify(res.payload)}`);
      }

      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }

  /**
   * Downloads the completed snapshot dataset in JSON format
   */
  async downloadSnapshot({ apiKey, snapshotId }) {
    const url = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`;
    const res = await this.curlJson({ method: "GET", url, apiKey });
    if (!Array.isArray(res.payload)) {
      if (res.payload && typeof res.payload === "object") {
        return [res.payload];
      }
      throw new Error(`Snapshot ${snapshotId} downloaded unexpected non-array format.`);
    }
    return res.payload;
  }
}
