'use strict';

// Popup script — runs in the extension popup page context (not a content script).
// Has direct access to chrome.storage but NOT to page DOM.

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const [settings, currentProduct, watchlist] = await Promise.all([
    PH.storage.getSettings(),
    PH.storage.getCurrentProduct(),
    PH.storage.getWatchlist()
  ]);

  renderCurrentProduct(currentProduct, watchlist);
  await renderWatchlist(watchlist);
  renderSettings(settings);
  bindSettingsEvents(settings);
}

// ── Current product ────────────────────────────────────────────────────────

const AMAZON_PATTERN = /amazon\.(com|co\.uk|ca)\//;

async function renderCurrentProduct(product, watchlist) {
  const section    = document.getElementById('current-product');
  const noProduct  = document.getElementById('no-product');
  const hintText   = noProduct.querySelector('p');
  const hintIcon   = noProduct.querySelector('.empty-icon');

  // Always resolve the active tab first so we can tailor the message
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isAmazonTab = AMAZON_PATTERN.test(tab?.url ?? '');

  if (!product?.asin || !product?.price) {
    noProduct.hidden = false;

    if (isAmazonTab) {
      // Content script hasn't run yet — tab was open before extension loaded
      hintIcon.textContent = '↻';
      hintText.innerHTML   = 'Refresh this tab to activate PriceHawk.';

      if (!document.getElementById('ph-refresh-btn')) {
        const btn = document.createElement('button');
        btn.id        = 'ph-refresh-btn';
        btn.className = 'btn btn--primary';
        btn.textContent = 'Refresh Tab';
        btn.style.marginTop = '10px';
        btn.addEventListener('click', () => {
          chrome.tabs.reload(tab.id);
          window.close();
        });
        noProduct.appendChild(btn);
      }
    } else {
      hintIcon.textContent = '🔍';
      hintText.textContent = 'Open an Amazon product page to track its price.';
    }
    return;
  }

  // product data exists — make sure we're still on that Amazon tab
  if (!isAmazonTab) {
    noProduct.hidden = false;
    return;
  }

  section.hidden = false;

  const history = await PH.storage.getPriceHistory(product.asin);
  const isTracked = watchlist.includes(product.asin);
  const change = PH.chart.priceChange(history);
  const stats = PH.chart.allTimeStats(history);

  // Image
  const img = document.getElementById('cp-img');
  if (product.imageUrl) { img.src = product.imageUrl; img.alt = product.title ?? ''; }
  else img.style.display = 'none';

  // Title
  const title = product.title ?? '';
  document.getElementById('cp-title').textContent =
    title.length > 70 ? title.substring(0, 70) + '…' : title;

  // Price
  document.getElementById('cp-price').textContent = `$${product.price.toFixed(2)}`;

  // Badge
  const badge = document.getElementById('cp-badge');
  if (change) {
    badge.textContent = `${change.isDown ? '▼' : '▲'} ${Math.abs(change.pct)}%`;
    badge.className = `badge ${change.isDown ? 'badge--down' : 'badge--up'}`;
  }

  // Meta
  const meta = [];
  if (product.bsr) meta.push(`BSR #${product.bsr.toLocaleString()}`);
  if (product.rating) meta.push(`⭐ ${product.rating} (${(product.reviewCount || 0).toLocaleString()})`);
  if (stats?.isAtLow) meta.push('🏆 All-time low');
  document.getElementById('cp-meta').textContent = meta.join('  ·  ');

  // Sparkline
  if (history.length >= 2) {
    PH.chart.sparkline(document.getElementById('cp-chart'), history, { width: 280, height: 50 });
  }

  // Track button
  const trackBtn = document.getElementById('cp-track-btn');
  updateTrackBtn(trackBtn, isTracked);
  trackBtn.addEventListener('click', async () => {
    const tracked = watchlist.includes(product.asin);
    if (tracked) {
      await PH.storage.removeFromWatchlist(product.asin);
      watchlist.splice(watchlist.indexOf(product.asin), 1);
    } else {
      await PH.storage.addToWatchlist(product.asin);
      watchlist.push(product.asin);
    }
    updateTrackBtn(trackBtn, !tracked);
    await renderWatchlist(await PH.storage.getWatchlist());
  });
}

function updateTrackBtn(btn, isTracked) {
  btn.textContent = isTracked ? '✓ Tracking' : '+ Track Price';
  btn.className = isTracked ? 'btn btn--tracked' : 'btn btn--primary';
}

// ── Watchlist ──────────────────────────────────────────────────────────────

async function renderWatchlist(watchlistAsins) {
  const ul = document.getElementById('watchlist');
  const empty = document.getElementById('wl-empty');
  const count = document.getElementById('wl-count');

  ul.innerHTML = '';

  if (!watchlistAsins.length) {
    empty.hidden = false;
    count.textContent = '';
    return;
  }

  empty.hidden = true;
  count.textContent = watchlistAsins.length;

  // Load all products in parallel
  const products = await Promise.all(
    watchlistAsins.map(asin => PH.storage.getProduct(asin))
  );
  const histories = await Promise.all(
    watchlistAsins.map(asin => PH.storage.getPriceHistory(asin))
  );

  products.forEach((product, i) => {
    if (!product) return;
    const history = histories[i];
    const change  = PH.chart.priceChange(history);
    const stats   = PH.chart.allTimeStats(history);
    const asin    = watchlistAsins[i];

    const li = document.createElement('li');
    li.className = 'wl-item';
    li.dataset.asin = asin;

    const title = (product.title ?? 'Unknown product').substring(0, 55);
    const price = product.price != null ? `$${product.price.toFixed(2)}` : '—';

    let changeHtml = '';
    if (change) {
      const cls = change.isDown ? 'ph-green' : 'ph-red';
      changeHtml = `<span class="${cls}">${change.isDown ? '▼' : '▲'}${Math.abs(change.pct)}%</span>`;
    }

    const atLow = stats?.isAtLow
      ? '<span class="badge badge--low" title="Current price is the lowest recorded">Low</span>'
      : '';

    li.innerHTML = `
      <div class="wl-main">
        <span class="wl-title" title="${product.title ?? ''}">${title}</span>
        <div class="wl-price-row">
          <span class="wl-price">${price}</span>
          ${changeHtml}
          ${atLow}
        </div>
        <div class="wl-sparkline" id="wl-spark-${asin}"></div>
      </div>
      <div class="wl-actions">
        <a href="https://www.amazon.com/dp/${asin}" target="_blank" class="wl-link" title="Open on Amazon">↗</a>
        <button class="wl-remove" data-asin="${asin}" title="Remove from watchlist">✕</button>
      </div>
    `;

    ul.appendChild(li);

    // Render mini sparkline (non-blocking)
    if (history.length >= 2) {
      PH.chart.sparkline(
        document.getElementById(`wl-spark-${asin}`),
        history,
        { width: 80, height: 28 }
      );
    }
  });

  // Remove buttons
  ul.querySelectorAll('.wl-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const asin = btn.dataset.asin;
      await PH.storage.removeFromWatchlist(asin);
      const updated = await PH.storage.getWatchlist();
      await renderWatchlist(updated);
    });
  });
}

// ── Settings ───────────────────────────────────────────────────────────────

function renderSettings(settings) {
  document.getElementById('s-alerts').checked    = settings.alertEnabled;
  document.getElementById('s-threshold').value   = settings.alertThresholdPct;
  document.getElementById('s-overlay').checked   = settings.overlayEnabled !== false;
  document.getElementById('s-sharing').checked   = !!settings.dataSharing;
}

function bindSettingsEvents(settings) {
  // Toggle settings panel
  document.getElementById('settings-toggle').addEventListener('click', async () => {
    const panel = document.getElementById('settings-panel');
    const isHidden = panel.hidden;
    panel.hidden = !isHidden;

    if (!isHidden) return;
    // Refresh storage info when opening
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    if (stats) {
      document.getElementById('storage-info').textContent =
        `${stats.watchlistCount} tracked · ${stats.snapshotCount} snapshots · ${(stats.bytesUsed / 1024).toFixed(1)} KB stored`;
    }
  });

  async function saveSetting(key, value) {
    settings[key] = value;
    await PH.storage.saveSettings(settings);
  }

  document.getElementById('s-alerts').addEventListener('change', e =>
    saveSetting('alertEnabled', e.target.checked));

  document.getElementById('s-threshold').addEventListener('change', e =>
    saveSetting('alertThresholdPct', parseInt(e.target.value, 10) || 5));

  document.getElementById('s-overlay').addEventListener('change', e =>
    saveSetting('overlayEnabled', e.target.checked));

  document.getElementById('s-sharing').addEventListener('change', e =>
    saveSetting('dataSharing', e.target.checked));

  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!confirm('Clear all PriceHawk data? This cannot be undone.')) return;
    await PH.storage.clearAll();
    window.close();
  });
}
