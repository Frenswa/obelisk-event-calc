(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports ? require('./core.js') : root.ObeliskEngine;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ObeliskEngine = Object.assign(root.ObeliskEngine || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  'use strict';

  const { clamp, classicRound, seededRandom } = engine.core;

  function monsterAtWave(rules, wave, reductions = {}) {
    const index = Math.max(0, Math.floor(wave) - 1);
    const monster = rules.monster;
    const rawDamage = classicRound(monster.adBase + monster.adPerWave * index);
    const critChance = clamp((monster.critBase + monster.critPerWave * index - (reductions.critChance || 0)) / 100, 0, 1);
    const critMultiplier = Math.max(1, monster.critMultiplierBase + monster.critMultiplierPerWave * index - (reductions.critDamage || 0));
    const damage = Math.max(1, rawDamage - (reductions.ad || 0));
    return {
      hp: monster.hpBase + monster.hpPerWave * index,
      damage,
      attackSpeed: Math.max(0.01, monster.asBase + monster.asPerWave * index - (reductions.as || 0)),
      critChance,
      critMultiplier,
      critDamage: classicRound(damage * critMultiplier)
    };
  }

  function normalizeStats(stats) {
    return {
      ad: Math.max(0.001, Number(stats.ad) || 0.001),
      hp: Math.max(1, Number(stats.hp) || 1),
      as: Math.max(0.001, Number(stats.as) || 0.001),
      ms: Math.max(0.001, Number(stats.ms) || 0.001),
      gs: Math.max(0.001, Number(stats.gs) || 0.001),
      critChance: clamp(Number(stats.critChance) || 0, 0, 1),
      critDamage: Math.max(1, Number(stats.critDamage) || 2),
      blockChance: clamp(Number(stats.blockChance) || 0, 0, 1)
    };
  }

  function simulateRun(options) {
    const rules = options.rules;
    const stats = normalizeStats(options.stats || {});
    const reductions = Object.assign({ ad: 0, as: 0, critChance: 0, critDamage: 0 }, options.reductions);
    const stochastic = options.stochastic !== false;
    const random = stochastic ? seededRandom(options.seed ?? 10007) : null;
    const maxWave = clamp(Math.floor(options.maxWave || 250), 1, 250);
    const enemiesPerWave = rules.monster.enemiesPerWave || 5;
    const playerInterval = rules.playerAttackBase / stats.as / stats.gs;
    const transition = rules.transitionBase / stats.ms / stats.gs;
    let playerGauge = playerInterval * clamp(Number(options.playerGaugePercent ?? 50), 0, 99) / 100;
    let enemyGauge = 0;
    let hp = stats.hp;
    let time = 0;
    let kills = 0;
    let lastWave = 0;
    let arrivalWave5 = null;

    for (let wave = 1; wave <= maxWave; wave++) {
      const foeStats = monsterAtWave(rules, wave, reductions);
      const enemyInterval = rules.enemyAttackBase / foeStats.attackSpeed / stats.gs;
      for (let enemy = 1; enemy <= enemiesPerWave; enemy++) {
        if (wave === 5 && enemy === 1) arrivalWave5 = hp;
        let foeHp = foeStats.hp;
        while (true) {
          const untilPlayer = Math.max(0, playerInterval - playerGauge);
          const untilEnemy = Math.max(0, enemyInterval - enemyGauge);
          const delta = Math.min(untilPlayer, untilEnemy);
          time += delta;
          playerGauge += delta;
          enemyGauge += delta;

          // Exact ties resolve in the player's favour, matching the in-game assumption.
          if (playerGauge >= playerInterval - 1e-9) {
            playerGauge = 0;
            const critical = stochastic ? random() < stats.critChance : false;
            const hit = stochastic
              ? (critical ? classicRound(stats.ad * stats.critDamage) : stats.ad)
              : stats.ad * (1 - stats.critChance) + classicRound(stats.ad * stats.critDamage) * stats.critChance;
            foeHp -= hit;
            if (foeHp <= 0) {
              kills++;
              if (enemy === enemiesPerWave) lastWave = wave;
              time += transition; // Gauges are intentionally frozen during transitions.
              break;
            }
          }

          if (enemyGauge >= enemyInterval - 1e-9) {
            enemyGauge = 0;
            let damage;
            if (stochastic) {
              const blocked = random() < stats.blockChance; // Block procs before critical damage.
              damage = blocked ? 0 : (random() < foeStats.critChance ? foeStats.critDamage : foeStats.damage);
            } else {
              damage = (foeStats.damage * (1 - foeStats.critChance) + foeStats.critDamage * foeStats.critChance) * (1 - stats.blockChance);
            }
            hp -= damage;
            if (hp <= 0) {
              return { time, kills, lastWave, deathWave: wave, deathEnemy: enemy, arrival55: arrivalWave5 };
            }
          }
        }
      }
    }
    return { time, kills, lastWave, deathWave: maxWave + 1, deathEnemy: 1, arrival55: arrivalWave5 };
  }

  return { combat: { monsterAtWave, normalizeStats, simulateRun } };
});
