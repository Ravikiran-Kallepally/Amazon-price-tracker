// Content script — runs on Amazon product pages.
// Extracts product data, stores price history, injects the PriceHawk overlay.
(async function () {
  'use strict';

  if (!PH.parser.isProductPage()) return;

  const product = PH.parser.extractAll();
  if (!product.asin || !product.price) return;

  // Persist price history and product metadata
  const history = await PH.storage.recordPricePoint(product.asin, product.price);

  const existing = await PH.storage.getProduct(product.asin);
  const saved = {
    ...product,
    priceHigh: existing ? Math.max(existing.priceHigh ?? 0, product.price) : product.price,
    priceLow:  existing ? Math.min(existing.priceLow  ?? Infinity, product.price) : product.price,
    firstSeen: existing?.firstSeen ?? product.timestamp,
    lastSeen:  product.timestamp
  };
  await PH.storage.saveProduct(saved);

  // Make current product available to the popup without message-passing
  await PH.storage.setCurrentProduct(saved);

  // Anonymised market snapshot for future data layer (stored locally, no PII)
  const settings = await PH.storage.getSettings();
  if (settings.dataSharing) {
    await PH.storage.recordSnapshot({
      asin:        product.asin,
      price:       product.price,
      bsr:         product.bsr,
      bsrCategory: product.bsrCategory,
      reviewCount: product.reviewCount,
      rating:      product.rating,
      sellerCount: product.sellerCount,
      domain:      product.domain,
      ts:          product.timestamp
    });
  }

  // Notify background so it can fire a price-drop alert if needed
  chrome.runtime.sendMessage({ type: 'PRICE_OBSERVED', product, history });

  // Render overlay if enabled
  if (settings.overlayEnabled !== false) {
    await renderOverlay(product, history);
  }
})();

// ─── Overlay ──────────────────────────────────────────────────────────────────

async function renderOverlay(product, history) {
  if (document.getElementById('ph-overlay')) return; // already injected

  const watchlist = await PH.storage.getWatchlist();
  const isTracked = watchlist.includes(product.asin);
  const stats = PH.chart.allTimeStats(history);
  const change = PH.chart.priceChange(history);

  const overlay = document.createElement('div');
  overlay.id = 'ph-overlay';
  overlay.setAttribute('role', 'complementary');
  overlay.setAttribute('aria-label', 'PriceHawk panel');

  overlay.innerHTML = buildOverlayHTML(product, history, isTracked, stats, change);
  document.body.appendChild(overlay);

  // Render sparkline into the chart container
  PH.chart.sparkline(
    document.getElementById('ph-chart'),
    history,
    { width: 214, height: 50 }
  );

  attachOverlayEvents(overlay, product, history, isTracked);
  makeDraggable(overlay);
}

function buildOverlayHTML(product, history, isTracked, stats, change) {
  const price = product.price?.toFixed(2) ?? '—';
  const changeBadge = change
    ? `<span class="ph-badge ${change.isDown ? 'ph-badge--down' : 'ph-badge--up'}">
         ${change.isDown ? '▼' : '▲'} ${Math.abs(change.pct)}%
       </span>`
    : '';

  const bsrHtml = product.bsr
    ? `<span title="Best Seller Rank">BSR #${product.bsr.toLocaleString()}</span>`
    : '';
  const ratingHtml = product.rating
    ? `<span>⭐ ${product.rating} <span class="ph-dim">(${(product.reviewCount || 0).toLocaleString()})</span></span>`
    : '';
  const atLowBadge = stats?.isAtLow
    ? '<span class="ph-badge ph-badge--low">All-time low</span>'
    : '';

  return `
    <div class="ph-header" id="ph-drag-handle">
      <span class="ph-logo">⚡ PriceHawk</span>
      <div class="ph-header-actions">
        <button class="ph-icon-btn" id="ph-minimize" title="Minimize">─</button>
        <button class="ph-icon-btn" id="ph-close" title="Close">✕</button>
      </div>
    </div>

    <div id="ph-body">
      <div class="ph-price-row">
        <span class="ph-price">$${price}</span>
        ${changeBadge}
        ${atLowBadge}
      </div>

      ${stats ? `
      <div class="ph-range">
        <span>Low <strong>$${stats.low.toFixed(2)}</strong>
          <span class="ph-dim">${stats.lowDaysAgo > 0 ? PH.chart.timeAgo(history.reduce((a,b) => a.price <= b.price ? a : b).ts) : 'today'}</span>
        </span>
        <span>High <strong>$${stats.high.toFixed(2)}</strong></span>
      </div>` : ''}

      <div id="ph-chart" class="ph-chart"></div>

      <div class="ph-meta">
        ${bsrHtml}
        ${ratingHtml}
        ${product.fbaAvailable ? '<span class="ph-prime">Prime</span>' : ''}
      </div>

      <div class="ph-divider"></div>

      <div class="ph-calc-section">
        <label class="ph-label">Source / Buy Price</label>
        <div class="ph-input-row">
          <span class="ph-currency">$</span>
          <input
            type="number"
            id="ph-buy-price"
            class="ph-input"
            placeholder="0.00"
            min="0"
            step="0.01"
            inputmode="decimal"
          />
        </div>
        <div id="ph-calc-result" class="ph-calc-result"></div>
      </div>

      <div class="ph-footer">
        <button class="ph-btn ${isTracked ? 'ph-btn--tracked' : 'ph-btn--primary'}" id="ph-track-btn">
          ${isTracked ? '✓ Tracking' : '+ Track Price'}
        </button>
        <span class="ph-dim ph-pts">${history.length} pt${history.length !== 1 ? 's' : ''}</span>
      </div>
    </div>

    <div id="ph-minimized" class="ph-minimized" style="display:none">
      <span class="ph-logo">⚡</span>
      <span class="ph-mini-price">$${price}</span>
      ${change ? `<span class="${change.isDown ? 'ph-green' : 'ph-red'}">${change.isDown ? '▼' : '▲'}${Math.abs(change.pct)}%</span>` : ''}
    </div>
  `;
}

function attachOverlayEvents(overlay, product, history, isTracked) {
  let tracked = isTracked;

  // Track / untrack
  document.getElementById('ph-track-btn').addEventListener('click', async () => {
    tracked = !tracked;
    const btn = document.getElementById('ph-track-btn');
    if (tracked) {
      await PH.storage.addToWatchlist(product.asin);
      btn.textContent = '✓ Tracking';
      btn.classList.replace('ph-btn--primary', 'ph-btn--tracked');
    } else {
      await PH.storage.removeFromWatchlist(product.asin);
      btn.textContent = '+ Track Price';
      btn.classList.replace('ph-btn--tracked', 'ph-btn--primary');
    }
  });

  // Profit calculator
  document.getElementById('ph-buy-price').addEventListener('input', (e) => {
    const buyPrice = parseFloat(e.target.value);
    const resultEl = document.getElementById('ph-calc-result');
    if (!buyPrice || !product.price) { resultEl.innerHTML = ''; return; }

    const r = PH.calculator.calculate(buyPrice, product.price, product.category);
    if (!r) return;

    resultEl.innerHTML = `
      <div class="ph-calc-row">
        <span>Referral fee <span class="ph-dim">(${(r.referralRate * 100).toFixed(0)}%)</span></span>
        <span class="ph-red">−$${r.referralFee}</span>
      </div>
      <div class="ph-calc-row">
        <span>FBA fee <span class="ph-dim">(est.)</span></span>
        <span class="ph-red">−$${r.fbaFee}</span>
      </div>
      <div class="ph-calc-divider"></div>
      <div class="ph-calc-row ph-calc-profit">
        <span>Net profit</span>
        <span class="${r.isProfitable ? 'ph-green' : 'ph-red'}">${r.isProfitable ? '+' : ''}$${r.profit}</span>
      </div>
      <div class="ph-calc-row">
        <span>ROI</span>
        <span class="${r.isProfitable ? 'ph-green' : 'ph-red'}">${r.roi}%</span>
      </div>
      <div class="ph-calc-row">
        <span>Break-even buy price</span>
        <span>$${r.breakEven}</span>
      </div>
    `;
  });

  // Minimize / restore
  let minimized = false;
  const body = document.getElementById('ph-body');
  const mini = document.getElementById('ph-minimized');

  document.getElementById('ph-minimize').addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : '';
    mini.style.display = minimized ? 'flex' : 'none';
    overlay.classList.toggle('ph-overlay--mini', minimized);
  });

  mini.addEventListener('click', () => {
    minimized = false;
    body.style.display = '';
    mini.style.display = 'none';
    overlay.classList.remove('ph-overlay--mini');
  });

  // Close (hides until page reload)
  document.getElementById('ph-close').addEventListener('click', () => {
    overlay.remove();
  });
}

function makeDraggable(el) {
  const handle = document.getElementById('ph-drag-handle');
  let startX, startY, startLeft, startTop, dragging = false;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return; // don't drag when clicking buttons
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = el.offsetLeft;
    startTop = el.offsetTop;
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newLeft = startLeft + (e.clientX - startX);
    const newTop  = startTop  + (e.clientY - startY);
    el.style.left  = `${Math.max(0, newLeft)}px`;
    el.style.top   = `${Math.max(0, newTop)}px`;
    el.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    handle.style.cursor = 'grab';
  });
}
