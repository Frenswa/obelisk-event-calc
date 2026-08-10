'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../engine/core.js');
const combat = require('../engine/combat.js').combat;
const economy = require('../engine/economy.js').economy;
const shops = require('../engine/shops.js').shops;
const route = require('../engine/route.js').route;
const referenceProfiles = require('./reference-profiles.json');

const rules = {
  monster: { hpBase: 11, hpPerWave: 7, adBase: 3, adPerWave: 0.6, asBase: 0.82, asPerWave: 0.02, critBase: 1, critPerWave: 1, critMultiplierBase: 1.05, critMultiplierPerWave: 0.05, enemiesPerWave: 5 },
  transitionBase: 5,
  playerAttackBase: 2,
  enemyAttackBase: 2
};

const tiers = {
  1: [['AD', 50, 0, 5], ['HP', 50, 0, 6], ['AS', 25, 0, 8], ['MS', 25, 0, 10], ['GS', 25, 1, 12], ['CC CD', 25, 2, 20], ['AD HP', 25, 2, 75], ['Caps', 10, 4, 2500], ['Prestige', 5, 8, 25000], ['AD HP II', 40, 10, 5000]],
  2: [['HP', 25, 0, 5], ['Enemy AS', 15, 0, 8], ['Enemy AD', 10, 0, 12], ['Enemy CC CD', 15, 1, 20], ['AD AS', 25, 3, 40], ['Caps', 10, 5, 500], ['Prestige', 15, 8, 650]],
  3: [['AD', 20, 1, 5], ['AS', 20, 1, 8], ['CC', 20, 2, 12], ['GS', 20, 3, 18], ['AD HP', 10, 4, 30], ['Caps', 10, 6, 250], ['5x', 10, 8, 300], ['HP AS', 40, 2, 125]],
  4: [['Block', 15, 1, 10], ['HP', 15, 1, 12], ['CD Enemy CD', 15, 4, 15], ['AS MS', 15, 5, 20], ['AD HP', 15, 6, 40], ['Caps', 10, 6, 250], ['Cap cap', 10, 7, 500], ['HP AS', 40, 10, 150]]
};

const emptyLevels = () => Object.fromEntries([1, 2, 3, 4].map(tier => [tier, Array(tiers[tier].length).fill(0)]));
const baseStats = { ad: 10, hp: 100, as: 1, ms: 1, gs: 1, critChance: 0, critDamage: 2, blockChance: 0 };

function test(name, callback) {
  try { callback(); process.stdout.write('✓ ' + name + '\n'); }
  catch (error) { process.stderr.write('✗ ' + name + '\n'); throw error; }
}

test('classic rounding mirrors player and enemy', () => {
  assert.equal(core.core.classicRound(3.49), 3);
  assert.equal(core.core.classicRound(3.5), 4);
  assert.equal(combat.monsterAtWave(rules, 2).damage, 4);
});

test('enemy critical chance is capped at 100%', () => {
  assert.equal(combat.monsterAtWave(rules, 250).critChance, 1);
});

test('base PR0 run reaches wave 3 and dies there', () => {
  const result = combat.simulateRun({ rules, stats: baseStats, reductions: {}, maxWave: 10, stochastic: true, seed: 10007, playerGaugePercent: 50 });
  assert.equal(result.lastWave, 2);
  assert.equal(result.deathWave, 3);
});

test('100% block cancels every enemy hit before critical damage', () => {
  const result = combat.simulateRun({ rules, stats: { ...baseStats, blockChance: 1 }, reductions: {}, maxWave: 5, stochastic: true, seed: 7, playerGaugePercent: 50 });
  assert.equal(result.lastWave, 5);
  assert.equal(result.deathWave, 6);
});

test('wave rewards use the fixed cumulative table', () => {
  assert.deepEqual(economy.rewardsForWave(10), [55, 3, 1, 0]);
  assert.deepEqual(economy.rewardsForWave(15), [120, 6, 1, 1]);
  assert.deepEqual(economy.rewardsForWave(250), [31375, 1275, 325, 136]);
});

test('5x expectation and Gem 2x apply to all currencies', () => {
  assert.deepEqual(economy.expectedRewards(15, { dropChance: 0.25, currencyMultiplier: 2 }), [480, 24, 4, 4]);
});

test('shop costs use classical round(base × 1.25^level)', () => {
  assert.equal(shops.levelCost(5, 0), 5);
  assert.equal(shops.levelCost(5, 1), 6);
  assert.equal(shops.levelCost(5, 2), 8);
});

test('shop chain requires one level in the previous item', () => {
  const levels = emptyLevels();
  assert.equal(shops.requirement(tiers, levels, 10, 1, 1).reason, 'previous-upgrade');
  levels[1][0] = 1;
  assert.equal(shops.requirement(tiers, levels, 10, 1, 1).available, true);
});

test('Prestige Bonus T2 remains locked before PR8', () => {
  const levels = emptyLevels();
  levels[2].fill(1);
  assert.equal(shops.requirement(tiers, levels, 5, 2, 6).requiredPr, 8);
  assert.equal(shops.requirement(tiers, levels, 8, 2, 6).available, true);
});

test('Cap of Cap is never increased by Tier 4 Upgrade Caps', () => {
  const levels = emptyLevels();
  levels[4][5] = 10;
  levels[4][6] = 10;
  assert.equal(shops.itemCap(tiers, levels, 4, 6), 10);
  assert.equal(shops.itemCap(tiers, levels, 4, 5), 20);
});

test('all accessible shop items are enumerated, including bundled AD + HP', () => {
  const levels = emptyLevels();
  levels[1].fill(1, 0, 6);
  const purchases = shops.availablePurchases(tiers, levels, 2);
  assert.ok(purchases.some(item => item.tier === 1 && item.index === 6));
});

test('route validation rejects a missing mandatory unlock', () => {
  const result = route.validatePurchases({ tiers, prestigeRank: 10, startLevels: emptyLevels(), purchases: [{ tier: 1, index: 1, count: 1 }] });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].reason, 'previous-upgrade');
});

test('route validation accepts an ordered unlock sequence and verifies cost', () => {
  const result = route.validatePurchases({ tiers, prestigeRank: 10, startLevels: emptyLevels(), purchases: [{ tier: 1, index: 0, count: 1 }, { tier: 1, index: 1, count: 1 }], expectedSpent: [11, 0, 0, 0] });
  assert.equal(result.valid, true);
});

test('reference profiles keep their expected outcomes', () => {
  for (const profile of referenceProfiles) {
    if (profile.expectedMonsterWave) {
      assert.equal(combat.monsterAtWave(rules, profile.expectedMonsterWave, profile.reductions).damage, profile.expectedMonsterDamage, profile.name);
      continue;
    }
    const result = combat.simulateRun({ rules, stats: profile.stats, reductions: profile.reductions, maxWave: profile.maxWave || 10, stochastic: true, seed: profile.seed, playerGaugePercent: 50 });
    assert.equal(result.lastWave, profile.expected.lastWave, profile.name);
    assert.equal(result.deathWave, profile.expected.deathWave, profile.name);
  }
});

test('all executable scripts in the page parse successfully', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attributes, source] of scripts) {
    if (/type=["']application\/json["']/i.test(attributes)) continue;
    const external = attributes.match(/src=["']([^"']+)["']/i);
    if (external) {
      assert.equal(fs.existsSync(path.join(root, external[1])), true, 'Missing script ' + external[1]);
      continue;
    }
    assert.doesNotThrow(() => new Function(source), 'Invalid inline script near: ' + source.slice(0, 80));
  }
});

test('dashboard markup has no duplicate static IDs', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test('displayed application version follows the requested sequence', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /v0\.23\.3\.6/);
});

test('route planner helpers are shared with later browser script scopes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /window\.currentLevels=currentLevels/);
  assert.match(html, /window\.reliableWave=reliableWave/);
  assert.match(html, /window\.updateRouteProgress=updateRouteProgress/);
  assert.match(html, /window\.waitForUi=waitForUi/);
});

test('full purchase plan compares reached and future objectives', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<small>Objectif atteint<\/small>/);
  assert.match(html, /<small>Futur objectif<\/small>/);
  assert.doesNotMatch(html, /Clears finançables avec tes monnaies/);
  assert.doesNotMatch(html, /Après le plan complet/);
  assert.doesNotMatch(html, /Buy all<\/b> applique seulement/);
  assert.doesNotMatch(html, /Fin la plus probable/);
  assert.doesNotMatch(html, /~1 %/);
});

test('Simulate and Buy all persist locally and online before recalculation', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /if\(!options\.skipSave\)await window\.saveAllStats/);
  assert.match(html, /window\.executePriorityBuyAll=async function/);
  assert.match(html, /const saved=await window\.saveAllStats/);
  assert.match(html, /runFullSimulation\?\.\(\{skipSave:true\}\)/);
  assert.match(html, /return saved/);
});

test('prestige planning is computed virtually through ordered wave checkpoints', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /async function findPrestigeJourney/);
  assert.match(html, /for\(let checkpoint=firstTarget;checkpoint<=finalTarget;checkpoint\+\+\)/);
  assert.match(html, /prestigeJourney:true/);
  assert.match(html, /Objectif V/);
  assert.match(html, /route complète/);
  assert.match(html, /return new Promise\(resolve=>setTimeout/);
});

test('route goal follows the affordable wave horizon until prestige reaches one percent', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /prestigeChanceNow>=1/);
  assert.match(html, /async function findBudgetHorizon/);
  assert.match(html, /async function findSequentialBudgetPlan/);
  assert.match(html, /async function finishSequentialBudgetPlan/);
  assert.match(html, /maxRuns:0/);
  assert.match(html, /next\.runs>maxRuns/);
  assert.match(html, /affordableThrough\+1/);
  assert.match(html, /result\.historyOptimized=true/);
  assert.match(html, /route globale/);
  assert.match(html, /function unifiedQuality/);
  assert.match(html, /Math\.max\(0,51-route\.clearQuality\)/);
  assert.match(html, /remainingBalances:balances/);
  assert.match(html, /result\.progressionHistory=budgetHorizon\.stages/);
  assert.match(html, /Comparaison de la chaîne avec la route globale/);
  assert.match(html, /route séquentielle optimisée/);
});

test('short desktop screens restore page scrolling and lone purchase groups use both columns', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /@media\(min-width:1181px\) and \(max-height:900px\)/);
  assert.match(html, /body\.dashboard-mode\{height:auto;min-height:100dvh;overflow-y:auto/);
  assert.match(html, /single-purchase-group/);
  assert.match(html, /column-count:2/);
  assert.match(html, /dashboard-results-column/);
});

test('every precalculated progression step respects shop locks, caps and exact costs', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script id="precalculatedProgressionsData" type="application\/json">([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Missing precalculated progression data');
  const progressions = JSON.parse(match[1]);
  const audit = route.sanitizeProgressions(progressions, { tiers, growth: 1.25 });
  assert.equal(audit.invalid.length, 27);
  assert.ok(audit.invalid.every(item => item.rank === 5 && item.wave >= 28 && item.wave <= 54));
  const failures = [];
  for (const [rank, progression] of Object.entries(audit.progressions)) {
    let previous = emptyLevels();
    for (const record of progression.records || []) {
      const validation = route.validateRouteState({ tiers, prestigeRank: Number(rank), startLevels: previous, finalLevels: record.levels, expectedSpent: record.spent, growth: 1.25 });
      if (!validation.valid) failures.push('PR' + rank + ' wave ' + record.wave + ': ' + JSON.stringify(validation.errors.slice(0, 3)));
      previous = record.levels;
    }
  }
  assert.deepEqual(failures, [], failures.slice(0, 20).join('\n'));
});

process.stdout.write('\nAll engine tests passed.\n');
