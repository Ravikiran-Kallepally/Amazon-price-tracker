window.PH = window.PH || {};

// Lightweight SVG sparkline — no dependencies, no external requests.
PH.chart = (() => {

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  return {
    // Renders a sparkline into `container`. `history` is [{price, ts}, ...]
    sparkline(container, history, { width = 130, height = 42, padding = 3 } = {}) {
      container.innerHTML = '';
      if (!history || history.length < 2) {
        container.innerHTML = '<span class="ph-no-data">Tracking started — check back soon</span>';
        return;
      }

      const prices = history.map(h => h.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const range = max - min || 0.01;

      const innerW = width - padding * 2;
      const innerH = height - padding * 2;

      const toX = (i) => padding + (i / (prices.length - 1)) * innerW;
      const toY = (p) => padding + innerH - ((p - min) / range) * innerH;

      const pts = prices.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');

      const current = prices[prices.length - 1];
      const first = prices[0];
      const isDown = current <= first;
      const lineColor = isDown ? '#00D4AA' : '#FF6B35';
      const fillColor = isDown ? 'rgba(0,212,170,0.08)' : 'rgba(255,107,53,0.08)';

      // Close path for fill area (go to bottom-right, bottom-left)
      const lastX = toX(prices.length - 1).toFixed(1);
      const firstX = toX(0).toFixed(1);
      const bottom = (padding + innerH).toFixed(1);
      const fillPts = `${pts} ${lastX},${bottom} ${firstX},${bottom}`;

      const dotX = toX(prices.length - 1).toFixed(1);
      const dotY = toY(current).toFixed(1);

      container.innerHTML = `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <polygon points="${fillPts}" fill="${fillColor}" stroke="none"/>
          <polyline
            fill="none"
            stroke="${lineColor}"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            points="${pts}"
          />
          <circle cx="${dotX}" cy="${dotY}" r="2.8" fill="${lineColor}"/>
        </svg>
      `;
    },

    // Returns { change, pct, isDown } comparing last vs first price in history
    priceChange(history) {
      if (!history || history.length < 2) return null;
      const first = history[0].price;
      const current = history[history.length - 1].price;
      const change = current - first;
      const pct = ((change / first) * 100);
      return {
        change: Math.round(change * 100) / 100,
        pct: Math.round(pct * 10) / 10,
        isDown: change < 0
      };
    },

    // Returns the lowest price ever seen, and how long ago it was
    allTimeStats(history) {
      if (!history || history.length === 0) return null;
      const low = history.reduce((a, b) => a.price <= b.price ? a : b);
      const high = history.reduce((a, b) => a.price >= b.price ? a : b);
      const daysAgoLow = Math.round((Date.now() - low.ts) / 86400000);
      return {
        low: low.price,
        high: high.price,
        lowDaysAgo: daysAgoLow,
        isAtLow: low.price === history[history.length - 1].price
      };
    },

    // Format a timestamp as "3d ago", "2mo ago", etc.
    timeAgo(ts) {
      const diff = Date.now() - ts;
      const days = Math.floor(diff / 86400000);
      if (days === 0) return 'today';
      if (days < 30) return `${days}d ago`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months}mo ago`;
      return `${Math.floor(months / 12)}yr ago`;
    }
  };
})();
