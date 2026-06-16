# ⚡ PriceHawk — Amazon Arbitrage Chrome Extension

A Manifest V3 Chrome extension for Amazon resellers and online arbitrage sellers. Tracks price history, calculates FBA profit margins, and alerts you when tracked products drop in price.

## What it does

- **Price history** — records every price observed on Amazon product pages, stored locally
- **FBA profit calculator** — enter a source/buy price and instantly see net profit, ROI, and break-even
- **Watchlist** — track any product and get a Chrome notification when the price drops
- **BSR tracking** — records Best Seller Rank alongside price to spot demand changes
- **Market snapshots** — optional anonymised data collection (default off) for future deal-scoring features

## Target user

Online arbitrage sellers who buy from Walmart/Target/retail and resell on Amazon FBA. The profit calculator uses Amazon's actual referral fee rates by category plus estimated FBA fulfillment fees — the exact metrics resellers need at a glance.

## Installing (unpacked, for development)

1. Clone this repo or download the ZIP
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. Visit any Amazon product page — the PriceHawk panel will appear on the right

## File structure

```
├── manifest.json               MV3 manifest
├── background/
│   └── service-worker.js       Alarms, price-drop notifications, message routing
├── content/
│   ├── amazon.js               Overlay UI, data capture, profit calculator
│   └── amazon.css              Overlay styles (dark theme)
├── popup/
│   ├── popup.html              Extension popup shell
│   ├── popup.js                Popup logic — watchlist, settings, current product
│   └── popup.css               Popup styles
├── utils/
│   ├── storage.js              chrome.storage wrapper + price-history management
│   ├── parser.js               Amazon DOM extraction (price, ASIN, BSR, rating…)
│   ├── calculator.js           FBA fee estimator + profit/ROI/break-even calculator
│   └── chart.js                Zero-dependency SVG sparkline + price change helpers
└── icons/                      Extension icons (replace with final design)
```

## Data stored

All data stays **on-device** in `chrome.storage.local`. Nothing is sent to any server in v1.

| Key | What's stored |
|---|---|
| `product:{ASIN}` | Title, price, BSR, rating, review count, high/low/first seen |
| `history:{ASIN}` | Array of `{price, ts}` — up to 365 data points per product |
| `watchlist` | Array of tracked ASINs |
| `snapshots` | Anonymised market snapshots (only if user opts in) |
| `settings` | Alert threshold, overlay toggle, data-sharing opt-in |

## Roadmap

- [ ] Walmart/Target content scripts (auto-detect source price for arbitrage calc)
- [ ] Backend sync (Supabase) for cross-device watchlist + email alerts
- [ ] Subscription gating via Stripe or ExtensionPay
- [ ] BSR history chart (track demand over time)
- [ ] Deal score ("buy now" vs "wait" percentile based on 90-day price history)
- [ ] Chrome side panel for full deal dashboard

## Privacy

No personal data is collected. The opt-in "Share anonymous market data" setting records only product-level price/BSR/review data (no user identifiers, no browsing history). It is **off by default**.

## License

MIT
