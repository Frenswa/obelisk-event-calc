(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.ObeliskEngine;
  const shopsApi = typeof module === 'object' && module.exports ? require('./shops.js') : root.ObeliskEngine;
  const api = factory(core, shopsApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ObeliskEngine = Object.assign(root.ObeliskEngine || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine, shopEngine) {
  'use strict';

  const { cloneLevels } = engine.core;
  const shops = shopEngine.shops;

  function routeSource(result) {
    if (!result) return { kind: 'none', label: 'aucune route' };
    if (result.cacheHit) return { kind: 'cache', label: 'cache vérifié' };
    if (result.precalculatedReference !== null && result.precalculatedReference !== undefined) {
      return { kind: 'precalculated', label: 'précalcul PR' + result.precalculatedReference };
    }
    return { kind: 'dynamic', label: 'recherche dynamique' };
  }

  function validatePurchases(options) {
    const tiers = options.tiers;
    const prestigeRank = Math.max(0, Math.floor(options.prestigeRank || 0));
    const growth = options.growth || 1.25;
    let levels = cloneLevels(options.startLevels);
    const spent = [0, 0, 0, 0];
    const errors = [];
    for (const purchase of options.purchases || []) {
      const count = Math.max(0, Math.floor(purchase.count || 0));
      for (let step = 0; step < count; step++) {
        const item = tiers[purchase.tier]?.[purchase.index];
        const status = item && shops.requirement(tiers, levels, prestigeRank, purchase.tier, purchase.index);
        if (!item || !status.available) {
          errors.push({ purchase, step, reason: item ? status.reason : 'unknown-item' });
          break;
        }
        spent[purchase.tier - 1] += shops.levelCost(item[3], levels[purchase.tier][purchase.index], growth);
        levels = shops.applyPurchase(tiers, levels, prestigeRank, purchase.tier, purchase.index).levels;
      }
    }
    if (options.expectedSpent) {
      options.expectedSpent.forEach((value, tier) => {
        if (Math.abs((value || 0) - spent[tier]) > 0.001) errors.push({ reason: 'spent-mismatch', tier: tier + 1, expected: value || 0, actual: spent[tier] });
      });
    }
    return { valid: errors.length === 0, errors, levels, spent };
  }

  function validateRouteState(options) {
    const tiers = options.tiers;
    const prestigeRank = Math.max(0, Math.floor(options.prestigeRank || 0));
    const growth = options.growth || 1.25;
    const start = cloneLevels(options.startLevels);
    const final = cloneLevels(options.finalLevels);
    const spent = [0, 0, 0, 0];
    const errors = [];
    for (let tier = 1; tier <= 4; tier++) {
      tiers[tier].forEach((item, index) => {
        const from = start[tier][index] || 0;
        const to = final[tier][index] || 0;
        if (to < from) errors.push({ reason: 'level-decreased', tier, index, from, to });
        if (to > 0 && prestigeRank < item[2]) errors.push({ reason: 'prestige', tier, index, requiredPr: item[2] });
        if (index > 0 && to > 0 && (final[tier][index - 1] || 0) < 1) errors.push({ reason: 'previous-upgrade', tier, index, prerequisite: index - 1 });
        const cap = shops.itemCap(tiers, final, tier, index);
        if (to > cap) errors.push({ reason: 'cap', tier, index, level: to, cap });
        if (to > from) spent[tier - 1] += shops.levelsCost(item, from, to - from, growth);
      });
    }
    if (options.expectedSpent) {
      options.expectedSpent.forEach((value, tier) => {
        if (Math.abs((value || 0) - spent[tier]) > 0.001) errors.push({ reason: 'spent-mismatch', tier: tier + 1, expected: value || 0, actual: spent[tier] });
      });
    }
    return { valid: errors.length === 0, errors, levels: final, spent };
  }

  function sanitizeProgressions(progressions, options) {
    const invalid = [];
    for (const [rankKey, pack] of Object.entries(progressions || {})) {
      const rank = Number(rankKey);
      let previous = Object.fromEntries([1, 2, 3, 4].map(tier => [tier, Array(options.tiers[tier].length).fill(0)]));
      const verified = [];
      for (const record of pack.records || []) {
        const validation = validateRouteState({ tiers: options.tiers, growth: options.growth || 1.25, prestigeRank: rank, startLevels: previous, finalLevels: record.levels, expectedSpent: record.spent });
        if (!validation.valid) {
          invalid.push({ rank, wave: record.wave, errors: validation.errors });
          continue;
        }
        verified.push(record);
        previous = record.levels;
      }
      pack.excludedRecords = (pack.records || []).length - verified.length;
      pack.records = verified;
    }
    return { progressions, invalid };
  }

  return { route: { routeSource, validatePurchases, validateRouteState, sanitizeProgressions } };
});
