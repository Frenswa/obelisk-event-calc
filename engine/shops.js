(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports ? require('./core.js') : root.ObeliskEngine;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ObeliskEngine = Object.assign(root.ObeliskEngine || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  'use strict';

  const { classicRound, cloneLevels } = engine.core;
  const CAP_UPGRADE_INDEX = { 1: 7, 2: 5, 3: 5, 4: 5 };
  const CAP_OF_CAP_INDEX = 6;

  const levelCost = (baseCost, currentLevel, growth = 1.25) => classicRound(baseCost * Math.pow(growth, currentLevel));

  function levelsCost(item, currentLevel, count, growth = 1.25) {
    let total = 0;
    for (let offset = 0; offset < count; offset++) total += levelCost(item[3], currentLevel + offset, growth);
    return total;
  }

  function itemCap(tiers, levels, tier, index) {
    const item = tiers[tier][index];
    const base = Math.max(0, Number(item[1]) || 0);
    const capUpgradeIndex = CAP_UPGRADE_INDEX[tier];
    // The T4 Cap-of-Cap upgrade extends every Tier Upgrade Caps item, but never itself.
    const capOfCap = tier === 4 && index === CAP_OF_CAP_INDEX ? 0 : (levels?.[4]?.[CAP_OF_CAP_INDEX] || 0);
    if (index === CAP_OF_CAP_INDEX && tier === 4) return base;
    if (index === capUpgradeIndex) return base + capOfCap;
    return base + (levels?.[tier]?.[capUpgradeIndex] || 0);
  }

  function requirement(tiers, levels, prestigeRank, tier, index) {
    const item = tiers[tier][index];
    if (!item) return { available: false, reason: 'unknown-item' };
    if (prestigeRank < item[2]) return { available: false, reason: 'prestige', requiredPr: item[2] };
    if (index > 0 && (levels?.[tier]?.[index - 1] || 0) < 1) return { available: false, reason: 'previous-upgrade', prerequisite: { tier, index: index - 1 } };
    const current = levels?.[tier]?.[index] || 0;
    const cap = itemCap(tiers, levels, tier, index);
    if (current >= cap) return { available: false, reason: 'cap', cap };
    return { available: true, cap };
  }

  function availablePurchases(tiers, levels, prestigeRank, growth = 1.25) {
    const purchases = [];
    for (let tier = 1; tier <= 4; tier++) {
      tiers[tier].forEach((item, index) => {
        const status = requirement(tiers, levels, prestigeRank, tier, index);
        if (!status.available) return;
        const level = levels[tier][index] || 0;
        purchases.push({ tier, index, name: item[0], level, cost: levelCost(item[3], level, growth), cap: status.cap });
      });
    }
    return purchases;
  }

  function applyPurchase(tiers, levels, prestigeRank, tier, index) {
    const status = requirement(tiers, levels, prestigeRank, tier, index);
    if (!status.available) return { ok: false, status, levels };
    const next = cloneLevels(levels);
    next[tier][index]++;
    return { ok: true, levels: next, status };
  }

  return { shops: { CAP_UPGRADE_INDEX, CAP_OF_CAP_INDEX, levelCost, levelsCost, itemCap, requirement, availablePurchases, applyPurchase } };
});
