'use strict';

// ── Installation ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;

  await chrome.storage.local.set({
    watchlist: [],
    settings: {
      alertEnabled: true,
      alertThresholdPct: 5,
      dataSharing: false,
      overlayEnabled: true,
      currency: 'USD'
    },
    installedAt: Date.now()
  });

  // Schedule the recurring price-check alarm
  chrome.alarms.create('price-check', { periodInMinutes: 240 }); // every 4 hours
});

// Re-register alarm on service-worker restart (SW can be killed by Chrome)
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get('price-check', (alarm) => {
    if (!alarm) chrome.alarms.create('price-check', { periodInMinutes: 240 });
  });
});

// ── Message handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PRICE_OBSERVED') {
    handlePriceObserved(msg.product, msg.history);
    return false; // no async response needed
  }

  if (msg.type === 'GET_STATS') {
    getStats().then(sendResponse);
    return true; // async response
  }

  return false;
});

async function handlePriceObserved(product, history) {
  if (!product?.asin || !product?.price || !history || history.length < 2) return;

  const data = await chrome.storage.local.get(['watchlist', 'settings']);
  const watchlist = data.watchlist ?? [];
  const settings  = data.settings  ?? { alertEnabled: true, alertThresholdPct: 5 };

  if (!settings.alertEnabled) return;
  if (!watchlist.includes(product.asin)) return;

  const prices    = history.map(h => h.price);
  const prev      = prices[prices.length - 2];
  const current   = prices[prices.length - 1];
  const dropPct   = prev > 0 ? ((prev - current) / prev) * 100 : 0;

  if (dropPct < settings.alertThresholdPct) return;

  const title = (product.title ?? 'Tracked product').substring(0, 55);
  const drop  = dropPct.toFixed(1);

  chrome.notifications.create(`ph-alert-${product.asin}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `⚡ Price dropped ${drop}%!`,
    message: `${title}…\nNow $${current.toFixed(2)} (was $${prev.toFixed(2)})`,
    priority: 1
  });
}

// ── Periodic alarm ─────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'price-check') return;

  // v1: we rely on the user visiting the page to refresh prices.
  // v2 (backend): fetch current prices for all watched ASINs here and alert.
  const data = await chrome.storage.local.get('watchlist');
  const count = (data.watchlist ?? []).length;
  console.debug(`[PriceHawk] alarm fired — ${count} item(s) on watchlist`);
});

// ── Notification click → open Amazon page ──────────────────────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('ph-alert-')) return;
  const asin = notificationId.replace('ph-alert-', '');
  const url  = `https://www.amazon.com/dp/${asin}`;
  chrome.tabs.create({ url });
  chrome.notifications.clear(notificationId);
});

// ── Stats helper ───────────────────────────────────────────────────────────

async function getStats() {
  const data = await chrome.storage.local.get(['watchlist', 'snapshots']);
  const bytesUsed = await chrome.storage.local.getBytesInUse();
  return {
    watchlistCount: (data.watchlist ?? []).length,
    snapshotCount:  (data.snapshots ?? []).length,
    bytesUsed
  };
}
