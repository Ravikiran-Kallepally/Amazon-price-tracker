window.PH = window.PH || {};

// FBA profit calculator — uses Amazon's published fee structures (2025 rates).
// Actual fees depend on product dimensions/weight; these are category-based estimates.
// Users can override with manual fee input in a future version.
PH.calculator = (() => {

  // Amazon referral fee rates by top-level category (as of 2025)
  const REFERRAL_RATES = {
    'Amazon Device Accessories': 0.45,
    'Amazon Kindle': 0.15,
    'Automotive': 0.12,
    'Baby Products': 0.08,
    'Beauty': 0.08,
    'Books': 0.15,
    'Camera': 0.08,
    'Cell Phones': 0.08,
    'Clothing': 0.17,
    'Computers': 0.08,
    'Electronics': 0.08,
    'Footwear': 0.15,
    'Furniture': 0.15,
    'Grocery': 0.08,
    'Handmade': 0.15,
    'Health': 0.08,
    'Home': 0.15,
    'Industrial': 0.12,
    'Jewelry': 0.20,
    'Kitchen': 0.15,
    'Luggage': 0.15,
    'Music': 0.15,
    'Musical Instruments': 0.15,
    'Office Products': 0.15,
    'Outdoors': 0.15,
    'Pet Supplies': 0.15,
    'Shoes': 0.15,
    'Software': 0.15,
    'Sports': 0.15,
    'Tools': 0.15,
    'Toys': 0.15,
    'Video Games': 0.15,
    'Watches': 0.16,
    'default': 0.15
  };

  // FBA fulfillment fee estimate by sell price bracket (standard-size assumption).
  // Real fees depend on dimensions/weight — this is a usable approximation for quick analysis.
  const FBA_FEE_BRACKETS = [
    { maxPrice: 10,   fee: 3.22 },
    { maxPrice: 20,   fee: 4.18 },
    { maxPrice: 40,   fee: 5.32 },
    { maxPrice: 75,   fee: 6.50 },
    { maxPrice: 150,  fee: 8.40 },
    { maxPrice: 300,  fee: 10.20 },
    { maxPrice: Infinity, fee: 13.50 }
  ];

  function getReferralRate(category) {
    if (!category) return REFERRAL_RATES.default;
    const normalized = category.toLowerCase();
    for (const [key, rate] of Object.entries(REFERRAL_RATES)) {
      if (normalized.includes(key.toLowerCase())) return rate;
    }
    return REFERRAL_RATES.default;
  }

  function estimateFBAFee(sellPrice) {
    for (const bracket of FBA_FEE_BRACKETS) {
      if (sellPrice <= bracket.maxPrice) return bracket.fee;
    }
    return FBA_FEE_BRACKETS[FBA_FEE_BRACKETS.length - 1].fee;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  return {
    calculate(buyPrice, sellPrice, category, customFBAFee = null) {
      if (!buyPrice || !sellPrice || buyPrice <= 0 || sellPrice <= 0) return null;

      const referralRate = getReferralRate(category);
      const referralFee = round2(sellPrice * referralRate);
      const fbaFee = round2(customFBAFee ?? estimateFBAFee(sellPrice));
      const totalFees = round2(referralFee + fbaFee);
      const profit = round2(sellPrice - buyPrice - totalFees);
      const roi = buyPrice > 0 ? round2((profit / buyPrice) * 100) : 0;
      const margin = round2((profit / sellPrice) * 100);

      return {
        buyPrice: round2(buyPrice),
        sellPrice: round2(sellPrice),
        referralFee,
        referralRate,
        fbaFee,
        totalFees,
        profit,
        roi,
        margin,
        isProfitable: profit > 0,
        // Break-even source price (what you can pay and still break even)
        breakEven: round2(sellPrice - totalFees)
      };
    },

    // Minimum sell price needed to make a given profit on a given buy price
    minSellForProfit(buyPrice, targetProfit, category) {
      // profit = sell - buy - (sell * referralRate) - fbaFee
      // sell * (1 - referralRate) = buy + fbaFee + targetProfit
      // Iterate because fbaFee depends on sellPrice
      const rate = getReferralRate(category);
      let sell = buyPrice * 1.5; // initial guess
      for (let i = 0; i < 20; i++) {
        const fba = estimateFBAFee(sell);
        sell = (buyPrice + fba + targetProfit) / (1 - rate);
      }
      return round2(sell);
    },

    getReferralRate,
    estimateFBAFee
  };
})();
