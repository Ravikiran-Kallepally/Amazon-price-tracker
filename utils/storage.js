// Namespace all PriceHawk globals under PH to avoid collisions with page scripts
window.PH = window.PH || {};

PH.storage = (() => {
  const MAX_HISTORY_POINTS = 365; // ~1 year of daily price points per product

  return {
    // ── Product metadata ──────────────────────────────────────────────────────

    async getProduct(asin) {
      const data = await chrome.storage.local.get(`product:${asin}`);
      return data[`product:${asin}`] || null;
    },

    async saveProduct(product) {
      await chrome.storage.local.set({ [`product:${product.asin}`]: product });
    },

    // ── Watchlist ─────────────────────────────────────────────────────────────

    async getWatchlist() {
      const data = await chrome.storage.local.get('watchlist');
      return data.watchlist || [];
    },

    async addToWatchlist(asin) {
      const list = await this.getWatchlist();
      if (!list.includes(asin)) {
        list.push(asin);
        await chrome.storage.local.set({ watchlist: list });
      }
    },

    async removeFromWatchlist(asin) {
      const list = await this.getWatchlist();
      await chrome.storage.local.set({ watchlist: list.filter(a => a !== asin) });
    },

    // ── Price history ─────────────────────────────────────────────────────────

    async recordPricePoint(asin, price) {
      const key = `history:${asin}`;
      const data = await chrome.storage.local.get(key);
      const history = data[key] || [];

      const last = history[history.length - 1];
      // Skip duplicate consecutive prices to save storage
      if (last && last.price === price) {
        last.ts = Date.now(); // update timestamp so we know it was checked
        await chrome.storage.local.set({ [key]: history });
        return history;
      }

      history.push({ price, ts: Date.now() });
      if (history.length > MAX_HISTORY_POINTS) {
        history.splice(0, history.length - MAX_HISTORY_POINTS);
      }
      await chrome.storage.local.set({ [key]: history });
      return history;
    },

    async getPriceHistory(asin) {
      const data = await chrome.storage.local.get(`history:${asin}`);
      return data[`history:${asin}`] || [];
    },

    // ── Aggregate data snapshot (opt-in, for future B2B API / data asset) ────
    // Stores anonymized product snapshots separately; no user PII collected.
    async recordSnapshot(snapshot) {
      const key = 'snapshots';
      const data = await chrome.storage.local.get(key);
      const snapshots = data[key] || [];
      snapshots.push(snapshot);
      // Keep last 5000 snapshots locally; in v2 these will sync to backend
      if (snapshots.length > 5000) snapshots.splice(0, snapshots.length - 5000);
      await chrome.storage.local.set({ [key]: snapshots });
    },

    async getSnapshots() {
      const data = await chrome.storage.local.get('snapshots');
      return data.snapshots || [];
    },

    // ── Settings ──────────────────────────────────────────────────────────────

    async getSettings() {
      const data = await chrome.storage.local.get('settings');
      return data.settings || {
        alertEnabled: true,
        alertThresholdPct: 5,   // notify when price drops >= 5%
        dataSharing: false,      // opt-in aggregate sharing (default off)
        overlayEnabled: true,    // show floating overlay on product pages
        currency: 'USD'
      };
    },

    async saveSettings(settings) {
      await chrome.storage.local.set({ settings });
    },

    // ── Current page product (used by popup to read what tab is showing) ──────

    async setCurrentProduct(product) {
      await chrome.storage.session.set({ currentProduct: product });
    },

    async getCurrentProduct() {
      const data = await chrome.storage.session.get('currentProduct');
      return data.currentProduct || null;
    },

    // ── Diagnostics ───────────────────────────────────────────────────────────

    async getStorageStats() {
      const bytes = await chrome.storage.local.getBytesInUse();
      const data = await chrome.storage.local.get('watchlist');
      return {
        bytesUsed: bytes,
        watchlistCount: (data.watchlist || []).length
      };
    },

    async clearAll() {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    }
  };
})();
