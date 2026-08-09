(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports ? require('./core.js') : root.ObeliskEngine;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ObeliskEngine = Object.assign(root.ObeliskEngine || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  'use strict';

  const { clamp } = engine.core;

  function rewardTable(maxWave = 250) {
    const totals = [0, 0, 0, 0];
    return Array.from({ length: clamp(Math.floor(maxWave), 1, 250) }, (_, index) => {
      const wave = index + 1;
      const gains = [wave, wave % 5 ? 0 : wave / 5, wave % 10 ? 0 : wave / 10, wave % 15 ? 0 : wave / 15];
      for (let tier = 0; tier < 4; tier++) totals[tier] += gains[tier];
      return { wave, gains, totals: totals.slice() };
    });
  }

  const FIXED_REWARDS = rewardTable(250);

  function rewardsForWave(completedWave) {
    const wave = clamp(Math.floor(Number(completedWave) || 0), 0, 250);
    return wave ? FIXED_REWARDS[wave - 1].totals.slice() : [0, 0, 0, 0];
  }

  function dropExpectedMultiplier(dropChance) {
    return 1 + 4 * clamp(Number(dropChance) || 0, 0, 1);
  }

  function expectedRewards(completedWave, options = {}) {
    const fiveX = dropExpectedMultiplier(options.dropChance);
    const gemMultiplier = Number(options.currencyMultiplier) === 2 ? 2 : 1;
    return rewardsForWave(completedWave).map(value => value * fiveX * gemMultiplier);
  }

  function ratesPerMinute(rewards, seconds) {
    const duration = Number(seconds) || 0;
    return rewards.map(value => duration > 0 ? value / duration * 60 : 0);
  }

  return { economy: { FIXED_REWARDS, rewardTable, rewardsForWave, dropExpectedMultiplier, expectedRewards, ratesPerMinute } };
});
