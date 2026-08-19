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
  assert.match(html, /v0\.23\.4\.14/);
});

test('route planner rejects redundant standalone damage during a one-shot horizon', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const source = html.match(/function routeRelevantPlayerStats\(stats,tier,index,target\)[\s\S]*?(?=\nwindow\.__routeRelevantPlayerStats)/)?.[0];
  assert.ok(source, 'Missing one-shot route filter');
  const rules = {
    '1-0': { player: { ad: 1 } },
    '1-5': { player: { critChance: 0.01, critDamage: 0.1 } },
    '1-6': { player: { ad: 1, hp: 2 } },
    '2-4': { player: { ad: 1, as: 0.01 } },
    '4-2': { player: { critDamage: 0.1 }, enemy: { critDamage: 0.1 } }
  };
  const helpers = new Function('upgradeRule', 'DATA', `${source}; return { routeRelevantPlayerStats, routeDamageOnlyRedundant };`)(
    (tier, index) => rules[`${tier}-${index}`] || {},
    { monster: { hpBase: 11, hpPerWave: 7 } }
  );
  const { routeRelevantPlayerStats: relevant, routeDamageOnlyRedundant: redundant } = helpers;
  const frenswaStats = { ad: 1324 };
  assert.equal(redundant(frenswaStats, 1, 0, 110), true, 'AD should be skipped while wave 110 is one-shot');
  assert.equal(redundant(frenswaStats, 1, 5, 110), true, 'Player CC/CD should be skipped while wave 110 is one-shot');
  assert.equal(redundant(frenswaStats, 1, 6, 110), false, 'AD + HP must remain eligible for its HP effect');
  assert.equal(redundant(frenswaStats, 4, 2, 110), false, 'Enemy CD reduction must remain eligible');
  assert.equal(redundant(frenswaStats, 1, 0, 189), false, 'AD must return when the horizon exceeds the one-shot threshold');
  assert.deepEqual(relevant(frenswaStats, 1, 6, 110), ['hp'], 'AD + HP must be valued only through HP while AD is redundant');
  assert.deepEqual(relevant(frenswaStats, 2, 4, 110), ['as'], 'AD + AS must be valued only through AS while AD is redundant');
  assert.deepEqual(relevant(frenswaStats, 1, 0, 110), [], 'Standalone AD must have no relevant component while one-shotting');
  assert.deepEqual(relevant(frenswaStats, 1, 0, 189), ['ad'], 'AD must regain weight beyond the one-shot horizon');
  assert.match(html, /playerStats\.filter\(stat=>stat!==['"]ad['"]&&stat!==['"]critChance['"]&&stat!==['"]critDamage['"]\)/);
  assert.match(html, /maximumHp=DATA\.monster\.hpBase\+DATA\.monster\.hpPerWave\*\(wave-1\)/);
  assert.match(html, /availableActions\(state,pr,target\)/);
  assert.match(html, /__availableRouteActions\(state,pr,target\)/);
  assert.match(html, /redundantDamage=routeDamageOnlyRedundant\(stats,tier,index,target\)/);
  assert.match(html, /window\.__routeDamageOnlyRedundant\(state\.stats,tier,index,target\)/);
  assert.match(html, /desired=neededAsGateway\?1:state\.levels\[tier\]\[index\]/);
  assert.match(html, /obelisk-early-route-table-v10/);
});

test('route search builds effect packages and keeps separate shop preference profiles', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /const ROUTE_PACKAGE_LIMIT=6/);
  assert.match(html, /function preferredRouteExpansions\(state,pr,target,balances,gains,maxRuns=Infinity\)/);
  assert.match(html, /routeOutcomeKey\(probe\)===baseOutcome/);
  assert.match(html, /probe\.routePackageBridge=routeOutcomeKey\(probe\)===baseOutcome/);
  assert.match(html, /frontier\.filter\(state=>state\.routePackageBridge\)\.forEach\(add\)/);
  assert.match(html, /b\.routePackageBridge&&a\.routePackageKey!==b\.routePackageKey/);
  assert.match(html, /grouped\.set\(action\.tier,tierStates\)/);
  assert.match(html, /flatMap\(states=>routeShopFrontier\(states\)\)/);
  assert.match(html, /for\(let currency=0;currency<4;currency\+\+\)/);
  assert.match(html, /preferredRouteExpansions\(state,pr,target,balances,gains,maxRuns\)/);
});

test('final route choice uses currency per minute only inside a near-equal ETA band', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function routeEconomyScore\(route,baseRates=\[\]\)/);
  assert.match(html, /Math\.log\(\(entry\.value\+1e-6\)\/\(entry\.base\+1e-6\)\)/);
  assert.match(html, /etaTolerance=Math\.max\(1,currentTime\*\.015\)/);
  assert.match(html, /bestOptimizationTime=Math\.min\(\.\.\.valid\.map\(route=>route\.optimizationTime\)\)/);
  assert.match(html, /a\.optimizationTime<=bestOptimizationTime\+etaTolerance/);
  assert.match(html, /chooseRoute\(evaluatedCandidates,currentTime,\{prestigeSprint,maxRuns,baseRates,spendBudget,balances\}\)/);
});

test('final budget pass uses budget only after prestige value and reuses precalculated probes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function routeBudgetUse\(route,balances=route\.budgetBalances\|\|\[\]\)/);
  assert.match(html, /score:coverage\+average\*\.25/);
  assert.match(html, /if\(!aNear\)return a\.optimizationTime-b\.optimizationTime/);
  assert.match(html, /const economyDelta=b\.economyScore-a\.economyScore/);
  assert.match(html, /if\(spendBudget\)\{const budgetDelta=routeBudgetUse\(b,balances\)\.score-routeBudgetUse\(a,balances\)\.score/);
  assert.match(html, /state\.spendBudget/);
  assert.match(html, /!spendBudget/);
  assert.match(html, /spendBudget:true/);
  assert.match(html, /Optimisation du budget restant/);
  assert.match(html, /budgetDepthLimit:24/);
  assert.match(html, /continuationStart=\{\.\.\.baseChoice,spent:\[0,0,0,0\]/);
  assert.match(html, /budgetScore = plus faible taux dépensé parmi les boutiques \+ 0\.25×taux moyen dépensé/);
  assert.match(html, /function routeUsefulDominates\(a,b\)/);
  assert.match(html, /if\(spendBudget\)valid=valid\.filter/);
  assert.match(html, /routeUsefulDominates\(other,route\)/);
  assert.match(html, /Une route plus chère sans meilleur clear, temps ou rendement est supprimée/);
  assert.match(html, /if\(options\.budgetProbe&&precalculated\?\.seed/);
  assert.match(html, /precalculatedProbe:true/);
  assert.match(html, /Optimisation finale du palier/);
  assert.match(html, /const optimizedBase=await baseFind\(affordableThrough,\{maxRuns:0,skipSequential:true\}\)/);
});

test('budget spending rejects identical expensive routes but keeps measurable upgrades', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const budgetSource = html.match(/function routeBudgetUse\(route,balances=route\.budgetBalances\|\|\[\]\)[\s\S]*?(?=\nfunction selectBeam)/)?.[0];
  const dominanceSource = html.match(/function routeUsefulDominates\(a,b\)[\s\S]*?(?=\nfunction routeFinalComparator)/)?.[0];
  assert.ok(budgetSource && dominanceSource, 'Missing budget utility helpers');
  const helpers = new Function('routeCurrencyRates', `${budgetSource}\n${dominanceSource}; return { routeBudgetUse, routeUsefulDominates };`)(route => route.rates);
  const cheap = { chance: 80, qualityChance: 75, sim: { kills: 550, time: 100 }, rates: [10, 2, 1, .5], spent: [100, 100, 100, 100] };
  const waste = { ...cheap, sim: { ...cheap.sim }, rates: cheap.rates.slice(), spent: [200, 200, 200, 200] };
  const useful = { ...waste, sim: { kills: 550, time: 90 }, rates: [11, 2.2, 1.1, .55] };
  assert.equal(helpers.routeUsefulDominates(cheap, waste), true, 'A costlier identical route must be rejected');
  assert.equal(helpers.routeUsefulDominates(cheap, useful), false, 'A measurable speed and economy gain must remain eligible');
  assert.ok(helpers.routeBudgetUse(useful, [1000, 1000, 1000, 1000]).score > helpers.routeBudgetUse(cheap, [1000, 1000, 1000, 1000]).score);
});

test('spending more cannot beat a materially faster prestige route', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const budgetSource = html.match(/function routeBudgetUse\(route,balances=route\.budgetBalances\|\|\[\]\)[\s\S]*?(?=\nfunction selectBeam)/)?.[0];
  const comparatorSource = html.match(/function routeFinalComparator\(valid,currentTime,prestigeSprint=false,spendBudget=false,balances=\[\]\)[\s\S]*?(?=\nfunction routeWeightSnapshot)/)?.[0];
  assert.ok(budgetSource && comparatorSource, 'Missing route comparator helpers');
  const comparator = new Function(`${budgetSource}\n${comparatorSource}; return routeFinalComparator;`)();
  const fast = { optimizationTime: 100, economyScore: 0, clearQuality: 80, chance: 80, resourceBurden: 10, spent: [100, 100, 100, 100] };
  const wasteful = { ...fast, optimizationTime: 120, spent: [900, 900, 900, 900] };
  const closeUseful = { ...fast, optimizationTime: 101, spent: [200, 200, 200, 200] };
  assert.ok(comparator([fast, wasteful], 100, false, true, [1000, 1000, 1000, 1000])(fast, wasteful) < 0);
  assert.ok(comparator([fast, closeUseful], 100, false, true, [1000, 1000, 1000, 1000])(closeUseful, fast) < 0);
});

test('simulation renders raw route weights and ranked alternatives', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function routeWeightSnapshot\(route,currentTime\)/);
  assert.match(html, /beamScore=kills-runsPenalty-burdenPenalty-depthPenalty/);
  assert.match(html, /function routePurchaseWeights\(entry,result\)/);
  assert.match(html, /function routeChoiceDetailsHtml\(result,purchases\)/);
  assert.match(html, /Poids bruts et routes comparées/);
  assert.match(html, /poids 0 sur V/);
  assert.match(html, /beam = kills − 0\.18×runs − 0\.025×resourceBurden − 0\.006×levels/);
  assert.match(html, /final = clear ≥ 51 %, ETA vers le prestige, economyScore, fiabilité, puis budgetScore/);
  assert.match(html, /alternatives:rankedAlternatives\.slice\(0,6\)/);
  assert.match(html, /routeChoiceDetailsHtml\(result,purchases\)/);
});

test('MS and GS are regular route candidates optimized through run time', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /isPureSpeedUpgrade/);
  assert.match(html, /s\.ad,s\.hp,s\.as,s\.ms,s\.gs/);
  assert.match(html, /useful=status==='simulated'\|\|status==='reward'/);
  assert.match(html, /a\.runs-b\.runs\|\|a\.sim\.time-b\.sim\.time/);
});

test('route planner helpers are shared with later browser script scopes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /window\.currentLevels=currentLevels/);
  assert.match(html, /window\.reliableWave=reliableWave/);
  assert.match(html, /window\.updateRouteProgress=updateRouteProgress/);
  assert.match(html, /window\.waitForUi=waitForUi/);
});

test('purchase panel only displays currently affordable recommendations', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /findUnifiedRoute\(target,\{skipSequential:true\}\)/);
  assert.match(html, /displayNow\.forEach\(record=>nowGroup\.append\(record\.row\)\)/);
  assert.match(html, /Aucun achat utile avec tes monnaies actuelles/);
  assert.match(html, /summary\.remove\(\)/);
  assert.match(html, /a\.entry\.tier-b\.entry\.tier\|\|displayPhase\(a\)-displayPhase\(b\)\|\|a\.entry\.index-b\.entry\.index/);
  assert.match(html, /displayPhase=record=>unlockPurchases\.has\(record\)\?1:dependencies\(record\)\.length\?2:0/);
  assert.match(html, /sort\(\(a,b\)=>Number\(a\.dataset\.buyOrder\)-Number\(b\.dataset\.buyOrder\)\)/);
  assert.doesNotMatch(html, /plan\.innerHTML=.*planGoal/);
  assert.doesNotMatch(html, /checkpointBadge=/);
  assert.doesNotMatch(html, /rateImpactBadge\(ratePercent\)/);
  assert.match(html, /appendPushEta\(nowGroup,route\)/);
  assert.match(html, /Prêt à tenter V/);
  assert.match(html, /runs\*runTime/);
});

test('Simulate and Buy all persist locally and online before recalculation', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /if\(!options\.skipSave\)await window\.saveAllStats/);
  assert.match(html, /window\.executePriorityBuyAll=async function/);
  assert.match(html, /const saved=await window\.saveAllStats/);
  assert.match(html, /runFullSimulation\?\.\(\{skipSave:true\}\)/);
  assert.match(html, /buyAll\.textContent='Updating…';await window\.runFullSimulation\?\.\(\)/);
  assert.doesNotMatch(html, /buyAll\.textContent='Re-simulate'/);
  assert.match(html, /return saved/);
});

test('active planner skips intermediate checkpoints and searches the current budget directly', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /findBudgetHorizon\?\.\(target,planningLimit\)/);
  assert.match(html, /prestigeLimit=pr<40.*prestigeRequiredWave\(pr\):250/);
  assert.match(html, /Math\.ceil\(\(low\+high\)\/2\)/);
  assert.match(html, /binarySearch:true/);
  assert.match(html, /directBudgetSearch:true/);
  assert.match(html, /sequentialPlan:null/);
  assert.doesNotMatch(html, /sequential=await findSequentialBudgetPlan\(firstTarget,limit,baseFind\)/);
  assert.match(html, /Recherche des achats utiles/);
  assert.match(html, /monnaies actuelles/);
});

test('cloud profiles use last-write-wins without stale-tab protection', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const api = fs.readFileSync(path.resolve(__dirname, '..', 'functions', 'api', 'profiles', '[id].js'), 'utf8');
  assert.doesNotMatch(html, /Save protected|LOCK_PREFIX|APPLIED_PREFIX|isLocked\(/);
  assert.doesNotMatch(api, /baseRevision|Save conflict|409/);
  assert.match(api, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(api, /revision = profiles\.revision \+ 1/);
});

test('short desktop screens restore page scrolling and purchases stay on one column', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /@media\(min-width:1181px\) and \(max-height:900px\)/);
  assert.match(html, /body\.dashboard-mode\{height:auto;min-height:100dvh;overflow-y:auto/);
  assert.match(html, /single-purchase-group/);
  assert.match(html, /single-purchase-group>\.purchase-group\{grid-column:1\/-1;display:block\}/);
  assert.doesNotMatch(html, /column-count:2/);
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
