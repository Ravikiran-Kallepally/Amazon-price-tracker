window.PH = window.PH || {};

// Extracts product data from Amazon product page DOM.
// Uses multiple selector fallbacks because Amazon A/B tests their layout constantly.
PH.parser = (() => {

  function firstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  function firstAttr(selectors, attr) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.getAttribute(attr)) return el.getAttribute(attr);
    }
    return null;
  }

  return {
    isProductPage() {
      return !!(this.getAsin() && document.querySelector('#productTitle, #title'));
    },

    getAsin() {
      if (document.body.dataset.asin) return document.body.dataset.asin;

      const urlMatch = location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
      if (urlMatch) return urlMatch[1];

      const input = document.getElementById('ASIN');
      if (input?.value) return input.value;

      // Try detail page URL param
      const params = new URLSearchParams(location.search);
      if (params.get('asin')) return params.get('asin');

      return null;
    },

    getTitle() {
      return firstText(['#productTitle', '#title span:first-child', 'h1.a-size-large'])
        ?.replace(/\s+/g, ' ') || null;
    },

    getPrice() {
      const selectors = [
        '#corePrice_feature_div .a-price .a-offscreen',
        '#apex_offerDisplay_desktop .a-price .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
        '#buyNewSection .a-price .a-offscreen',
        '.reinventPricePolicyMessage .a-price .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '#price_inside_buybox',
        '#newBuyBoxPrice',
        '.a-price[data-a-color="price"] .a-offscreen'
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const raw = el.textContent.replace(/[^0-9.]/g, '');
        const price = parseFloat(raw);
        if (price > 0 && price < 100000) return price;
      }
      return null;
    },

    getListPrice() {
      const selectors = [
        '.basisPrice .a-price .a-offscreen',
        '#listPrice',
        '.a-price[data-a-strike="true"] .a-offscreen'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const price = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
        if (price > 0) return price;
      }
      return null;
    },

    getBSR() {
      // BSR appears in detail bullets or product details table
      const candidates = document.querySelectorAll(
        '#detailBulletsWrapper_feature_div li, ' +
        '#productDetails_db_sections td, ' +
        '#productDetails_techSpec_section_1 td, ' +
        '#detailBullets_feature_div li, ' +
        '#SalesRank'
      );

      for (const el of candidates) {
        const text = el.textContent;
        if (!text.includes('Best Seller') && !text.includes('Best seller')) continue;
        const match = text.match(/#([\d,]+)/);
        if (match) return parseInt(match[1].replace(/,/g, ''), 10);
      }
      return null;
    },

    getBSRCategory() {
      const candidates = document.querySelectorAll(
        '#detailBulletsWrapper_feature_div li, ' +
        '#productDetails_db_sections td, ' +
        '#detailBullets_feature_div li'
      );
      for (const el of candidates) {
        const text = el.textContent;
        if (!text.includes('Best Seller')) continue;
        // e.g. "#1 in Electronics (See top 100 in Electronics)"
        const match = text.match(/in\s+([A-Za-z\s&,]+?)(?:\s*\(|$)/);
        if (match) return match[1].trim();
      }
      return null;
    },

    getRating() {
      const el = document.querySelector(
        '#acrPopover, [data-hook="rating-out-of-text"], #averageCustomerReviews .a-declarative'
      );
      if (!el) return null;
      const title = el.getAttribute('title') || el.textContent;
      const match = title.match(/([\d.]+)\s+out of/i);
      return match ? parseFloat(match[1]) : null;
    },

    getReviewCount() {
      const el = document.querySelector(
        '#acrCustomerReviewText, [data-hook="total-review-count"]'
      );
      if (!el) return null;
      const match = el.textContent.match(/([\d,]+)/);
      return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
    },

    getCategory() {
      const breadcrumb = document.querySelector(
        '#wayfinding-breadcrumbs_feature_div li:first-child a, ' +
        '.a-breadcrumb li:first-child a'
      );
      return breadcrumb?.textContent.trim() || null;
    },

    getSellerCount() {
      // "X new from $Y" link near the buy box
      const el = document.querySelector(
        '#olpLinkWidget_feature_div span, ' +
        '#moreBuyingChoices_feature_div span, ' +
        '#buybox-see-all-buying-choices span'
      );
      if (!el) return null;
      const match = el.textContent.match(/(\d+)\s+new/i);
      return match ? parseInt(match[1], 10) : null;
    },

    isFBAAvailable() {
      const buyboxText = (
        document.querySelector('#tabular-buybox, #buybox, #desktop_buybox')?.textContent || ''
      ).toLowerCase();
      return (
        buyboxText.includes('fulfilled by amazon') ||
        buyboxText.includes('ships from and sold by amazon')
      );
    },

    isPrime() {
      return !!document.querySelector(
        '#primeSavingsAsinEligibilityMessage, ' +
        '.a-icon-prime, ' +
        '#bbop-singleuse-content'
      );
    },

    getImageUrl() {
      const img = document.querySelector('#landingImage, #imgBlkFront, #main-image');
      if (!img) return null;
      return img.dataset.oldHires || img.dataset.src || img.src || null;
    },

    getVariantInfo() {
      // Selected size/color etc. — useful for arbitrage (variations can have different BSR)
      const selected = document.querySelector('.selection');
      return selected?.textContent.trim() || null;
    },

    extractAll() {
      return {
        asin: this.getAsin(),
        title: this.getTitle(),
        price: this.getPrice(),
        listPrice: this.getListPrice(),
        bsr: this.getBSR(),
        bsrCategory: this.getBSRCategory(),
        rating: this.getRating(),
        reviewCount: this.getReviewCount(),
        category: this.getCategory(),
        sellerCount: this.getSellerCount(),
        fbaAvailable: this.isFBAAvailable(),
        prime: this.isPrime(),
        imageUrl: this.getImageUrl(),
        variant: this.getVariantInfo(),
        url: location.href,
        domain: location.hostname,
        timestamp: Date.now()
      };
    }
  };
})();
