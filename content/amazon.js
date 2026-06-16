// Content script — runs on Amazon product pages.
// Extracts product data, stores price history, injects the PriceHawk overlay.
(async function () {
  'use strict';

  // Not a product page — bail silently
  if (!PH.parser.isProductPage()) return;

  const product = PH.parser.extractAll();

  // No ASIN means we can't identify the product at all — bail
  if (!product.asin) {
    console.warn('[PriceHawk] Could not detect ASIN on this page.');
    return;
  }

  // Log what we found so you can debug in DevTools → Console
  console.log('[PriceHawk] Detected product:', product.asin, '| price:', product.price);

  // ── Render overlay first (don't let storage failures block the UI) ─────
  let history = [];
  try {
    const settings = await PH.storage.getSettings();
    if (settings.overlayEnabled !== false) {
      await renderOverlay(product, history);
    }
  } catch (err) {
    console.error('[PriceHawk] Overlay render error:', err);
  }

  // ── Storage & background work (non-blocking for overlay) ──────────────
  try {
    if (product.price) {
      history = await PH.storage.recordPricePoint(product.asin, product.price);

      // Update the overlay chart once history is loaded
      const chartEl = document.getElementById('ph-chart');
      if (chartEl && history.length >= 2) {
        PH.chart.sparkline(chartEl, history, { width: 214, height: 50 });
      }
    }

    const existing = await PH.storage.getProduct(product.asin);
    const saved = {
      ...product,
      priceHigh: product.price
        ? (existing ? Math.max(existing.priceHigh ?? 0, product.price) : product.price)
        : existing?.priceHigh,
      priceLow: product.price
        ? (existing ? Math.min(existing.priceLow ?? Infinity, product.price) : product.price)
        : existing?.priceLow,
      firstSeen: existing?.firstSeen ?? product.timestamp,
      lastSeen:  product.timestamp
    };
    await PH.storage.saveProduct(saved);
    await PH.storage.setCurrentProduct(saved);

    const settings = await PH.storage.getSettings();

    if (settings.dataSharing && product.price) {
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

    chrome.runtime.sendMessage({ type: 'PRICE_OBSERVED', product, history });
  } catch (err) {
    console.error('[PriceHawk] Storage error:', err);
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
    { width: 228, height: 52 }
  );

  attachOverlayEvents(overlay, product, history, isTracked);
  makeDraggable(overlay);
}

function buildOverlayHTML(product, history, isTracked, stats, change) {
  const priceStr  = product.price != null ? product.price.toFixed(2) : null;
  const [priceDollars, priceCents] = priceStr ? priceStr.split('.') : ['—', ''];

  const changeDir   = change?.isDown ? 'down' : 'up';
  const changePct   = change ? Math.abs(change.pct) : null;
  const changeLabel = change ? `${change.isDown ? '↓' : '↑'} ${changePct}%` : null;

  const lowStr  = stats ? `$${stats.low.toFixed(2)}`  : '—';
  const highStr = stats ? `$${stats.high.toFixed(2)}` : '—';
  const bsrStr  = product.bsr ? `#${product.bsr.toLocaleString()}` : '—';

  const ratingLine = product.rating
    ? `★ ${product.rating}  ·  ${(product.reviewCount || 0).toLocaleString()} reviews`
    : '';

  const atLow  = stats?.isAtLow  ? '<span class="ph-tag ph-tag--low">All‑time low</span>' : '';
  const prime  = product.fbaAvailable ? '<span class="ph-tag ph-tag--prime">Prime</span>' : '';
  const ctaCls = isTracked ? 'ph-cta ph-cta--tracked' : 'ph-cta';
  const ctaTxt = isTracked ? '✓ Tracking' : '+ Track Price';

  return `
    <!-- macOS-style title bar -->
    <div class="ph-titlebar" id="ph-drag-handle">
      <div class="ph-wc">
        <button class="ph-wc-btn ph-wc-close" id="ph-close" title="Close"></button>
        <button class="ph-wc-btn ph-wc-min"   id="ph-minimize" title="Minimize"></button>
      </div>
      <span class="ph-app-name">PriceHawk</span>
      <div class="ph-wc-spacer"></div>
    </div>

    <!-- Expanded body -->
    <div id="ph-body" class="ph-body">

      <!-- Hero price -->
      <div class="ph-hero">
        <div class="ph-price-display">
          ${priceStr
            ? `<span class="ph-price-dollar">$</span><span class="ph-price-int">${priceDollars}</span><span class="ph-price-dec">.${priceCents}</span>`
            : `<span class="ph-price-int ph-price--na">—</span>`}
        </div>
        <div class="ph-tags">
          ${changeLabel ? `<span class="ph-tag ph-tag--${changeDir}">${changeLabel}</span>` : ''}
          ${atLow}
          ${prime}
        </div>
      </div>

      <!-- Low / High / BSR stats row -->
      <div class="ph-stats-row">
        <div class="ph-stat">
          <span class="ph-stat-label">LOW</span>
          <span class="ph-stat-val">${lowStr}</span>
        </div>
        <div class="ph-stat-sep"></div>
        <div class="ph-stat">
          <span class="ph-stat-label">HIGH</span>
          <span class="ph-stat-val">${highStr}</span>
        </div>
        <div class="ph-stat-sep"></div>
        <div class="ph-stat">
          <span class="ph-stat-label">BSR</span>
          <span class="ph-stat-val">${bsrStr}</span>
        </div>
      </div>

      <!-- Sparkline chart -->
      <div class="ph-chart-card">
        <div id="ph-chart" class="ph-chart"></div>
        <span class="ph-pts-label">${history.length} price point${history.length !== 1 ? 's' : ''}</span>
      </div>

      <!-- Rating / meta -->
      ${ratingLine ? `<p class="ph-meta-line">${ratingLine}</p>` : ''}

      <div class="ph-sep"></div>

      <!-- Profit calculator -->
      <div class="ph-calc-wrap">
        <label class="ph-field-label">SOURCE PRICE</label>
        <div class="ph-field">
          <span class="ph-field-pre">$</span>
          <input
            id="ph-buy-price"
            class="ph-field-input"
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            inputmode="decimal"
          />
        </div>
        <div id="ph-calc-result" class="ph-calc-result"></div>
      </div>

      <!-- CTA -->
      <button id="ph-track-btn" class="${ctaCls}">${ctaTxt}</button>
    </div>

    <!-- Minimized pill (shown when user clicks minimize) -->
    <div id="ph-minimized" class="ph-pill" style="display:none">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="ph-pill-icon">
        <polyline points="1,3 5,8 9,5 11,9" stroke="#30D158" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="11" cy="9" r="1.5" fill="#30D158"/>
      </svg>
      <span class="ph-pill-price">${priceStr ? `$${priceStr}` : '—'}</span>
      ${changeLabel ? `<span class="ph-pill-chg ph-pill-chg--${changeDir}">${changeLabel}</span>` : ''}
    </div>
  `;
}

function calcResultHTML(r) {
  const profitCls = r.isProfitable ? 'ph-val--pos' : 'ph-val--neg';
  return `
    <div class="ph-calc-rows">
      <div class="ph-calc-row">
        <span>Referral <span class="ph-dimmer">${(r.referralRate * 100).toFixed(0)}%</span></span>
        <span class="ph-val--neg">−$${r.referralFee}</span>
      </div>
      <div class="ph-calc-row">
        <span>FBA fee <span class="ph-dimmer">est.</span></span>
        <span class="ph-val--neg">−$${r.fbaFee}</span>
      </div>
      <div class="ph-calc-divider"></div>
      <div class="ph-calc-row ph-calc-profit">
        <span>Net profit</span>
        <span class="${profitCls}">${r.isProfitable ? '+' : ''}$${r.profit}</span>
      </div>
      <div class="ph-calc-row">
        <span>ROI</span>
        <span class="${profitCls}">${r.roi}%</span>
      </div>
      <div class="ph-calc-row">
        <span>Break-even</span>
        <span>$${r.breakEven}</span>
      </div>
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
    resultEl.innerHTML = calcResultHTML(r);
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
