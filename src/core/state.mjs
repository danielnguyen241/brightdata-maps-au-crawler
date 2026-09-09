import fs from "node:fs/promises";
import path from "node:path";

export class StateManager {
  constructor(stateFilePath) {
    this.stateFilePath = path.resolve(stateFilePath);
    this.state = null;
  }

  async writeJsonAtomic(filePath, data) {
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }

  async load(initialLocations = []) {
    try {
      const content = await fs.readFile(this.stateFilePath, "utf8");
      this.state = JSON.parse(content);
    } catch {
      // Create new state if missing
      this.state = {
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_locations: initialLocations.length,
        locations: {}
      };

      for (const loc of initialLocations) {
        this.state.locations[loc.id] = {
          id: loc.id,
          label: loc.label,
          state: loc.state,
          wave: loc.wave,
          lat: loc.lat,
          long: loc.long,
          zoom: loc.zoom,
          status: "pending", // pending | running | complete | error
          snapshot_id: null,
          raw_count: 0,
          key_fingerprint: null,
          error: null,
          updated_at: null
        };
      }

      await this.save();
    }

    return this.state;
  }

  async save() {
    this.state.updated_at = new Date().toISOString();
    const dir = path.dirname(this.stateFilePath);
    await fs.mkdir(dir, { recursive: true });
    await this.writeJsonAtomic(this.stateFilePath, this.state);
  }

  getLocation(id) {
    return this.state?.locations?.[id] || null;
  }

  isLocationComplete(id) {
    return this.state?.locations?.[id]?.status === "complete";
  }

  async updateLocation(id, updates) {
    if (!this.state.locations[id]) {
      this.state.locations[id] = { id, ...updates };
    } else {
      Object.assign(this.state.locations[id], updates);
    }
    this.state.locations[id].updated_at = new Date().toISOString();
    await this.save();
  }

  getSummary() {
    const locs = Object.values(this.state?.locations || {});
    const complete = locs.filter(l => l.status === "complete");
    const pending = locs.filter(l => l.status === "pending");
    const errors = locs.filter(l => l.status === "error");
    const totalRaw = complete.reduce((sum, l) => sum + (l.raw_count || 0), 0);

    return {
      total: locs.length,
      complete: complete.length,
      pending: pending.length,
      errors: errors.length,
      total_raw_records: totalRaw
    };
  }
}
