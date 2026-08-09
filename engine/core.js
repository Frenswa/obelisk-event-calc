(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ObeliskEngine = Object.assign(root.ObeliskEngine || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const classicRound = value => Math.floor(Number(value) + 0.5);
  const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  const cloneLevels = levels => Object.fromEntries([1, 2, 3, 4].map(tier => [tier, (levels?.[tier] || []).slice()]));

  function seededRandom(seed) {
    let value = seed | 0;
    return function random() {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  return {
    engineVersion: '1.0.0',
    core: { clamp, classicRound, integer, cloneLevels, seededRandom }
  };
});
