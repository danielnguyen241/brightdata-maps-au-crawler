import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * Bright Data API Key Manager
 * Handles multi-key loading, SHA-256 fingerprinting, consumption budgeting, and rotation.
 */
export class KeyManager {
  constructor({
    candidatePaths = [],
    perKeyCap = 4500,
    totalCap = 15000,
    explicitKeys = []
  } = {}) {
    this.candidatePaths = candidatePaths;
    this.perKeyCap = perKeyCap;
    this.totalCap = totalCap;
    this.explicitKeys = explicitKeys;
    this.keys = [];
    this.currentIndex = 0;
    this.totalRecordsDelivered = 0;
  }

  /**
   * Resolves paths like ~/.config/...
   */
  resolvePath(p) {
    if (p.startsWith("~")) {
      return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
  }

  /**
   * Initializes keys from explicit list, environment variables, or config files.
   */
  async init() {
    const loadedRawKeys = [];

    // 1. Explicit keys passed in
    if (Array.isArray(this.explicitKeys) && this.explicitKeys.length > 0) {
      loadedRawKeys.push(...this.explicitKeys);
    }

    // 2. Environment variables
    if (process.env.BRIGHTDATA_API_KEYS) {
      loadedRawKeys.push(...process.env.BRIGHTDATA_API_KEYS.split(/[\r\n,]+/).map(s => s.trim()));
    } else if (process.env.BRIGHTDATA_API_KEY) {
      loadedRawKeys.push(process.env.BRIGHTDATA_API_KEY.trim());
    }

    // 3. Candidate files
    if (loadedRawKeys.length === 0) {
      for (const candidate of this.candidatePaths) {
        try {
          const resolved = this.resolvePath(candidate);
          const content = await fs.readFile(resolved, "utf8");
          const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            loadedRawKeys.push(...lines);
            break; // Used highest priority existing file
          }
        } catch {
          // Continue searching candidates
        }
      }
    }

    const uniqueKeys = Array.from(new Set(loadedRawKeys.filter(Boolean)));
    if (uniqueKeys.length === 0) {
      throw new Error(
        "No Bright Data API keys found! Please set BRIGHTDATA_API_KEY in .env or create ~/.config/brightdata/api_keys"
      );
    }

    this.keys = uniqueKeys.map((key, index) => {
      const fingerprint = crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
      return {
        key,
        index,
        fingerprint,
        recordsDelivered: 0,
        status: "active",
        exhausted: false,
      };
    });

    this.currentIndex = 0;
  }

  getActiveKey() {
    while (this.currentIndex < this.keys.length) {
      const current = this.keys[this.currentIndex];
      if (!current.exhausted && current.recordsDelivered < this.perKeyCap) {
        return current;
      }
      this.currentIndex++;
    }
    return null;
  }

  recordUsage(keyIndex, recordCount) {
    const keyObj = this.keys.find(k => k.index === keyIndex);
    if (keyObj) {
      keyObj.recordsDelivered += recordCount;
      this.totalRecordsDelivered += recordCount;
      if (keyObj.recordsDelivered >= this.perKeyCap) {
        keyObj.exhausted = true;
        console.warn(`[KEY-MANAGER] Key fingerprint ${keyObj.fingerprint} reached safety cap (${keyObj.recordsDelivered}/${this.perKeyCap} records). Marking exhausted.`);
      }
    }
  }

  rotateKey(reason = "Quota limit reached") {
    const current = this.keys[this.currentIndex];
    if (current) {
      current.exhausted = true;
      console.warn(`[KEY-MANAGER] Rotating key ${current.fingerprint} -> Reason: ${reason}`);
    }
    this.currentIndex++;
    return this.getActiveKey();
  }

  getAuditSummary() {
    return {
      totalDelivered: this.totalRecordsDelivered,
      totalCap: this.totalCap,
      perKeyCap: this.perKeyCap,
      keys: this.keys.map(k => ({
        fingerprint: k.fingerprint,
        recordsDelivered: k.recordsDelivered,
        exhausted: k.exhausted,
        status: k.status
      }))
    };
  }
}
