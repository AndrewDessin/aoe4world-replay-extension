import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isArmyUnit, EXCLUDED_ARMY_UNITS, unitCostTotal, unitMergeKey } from '../../src/content/unit-mapping.ts';

test('isArmyUnit excludes villagers/workers/scouts/livestock', () => {
  assert.equal(isArmyUnit({ icon: 'units/villager_2' }), false);
  assert.equal(isArmyUnit({ icon: 'units/scout' }), false);
  assert.equal(isArmyUnit({ icon: 'units/sheep' }), false);
  assert.equal(isArmyUnit({ icon: 'units/trader' }), false);
  assert.equal(isArmyUnit({ icon: 'units/monk' }), false);
});

test('isArmyUnit accepts combat units', () => {
  assert.equal(isArmyUnit({ icon: 'units/knight' }), true);
  assert.equal(isArmyUnit({ icon: 'units/archer_3' }), true);
  assert.equal(isArmyUnit({ icon: 'units/spearman' }), true);
  assert.equal(isArmyUnit({ icon: 'units/ghulam' }), true);
});

test('EXCLUDED_ARMY_UNITS list is non-empty', () => {
  assert.ok(EXCLUDED_ARMY_UNITS.includes('villager'));
  assert.ok(EXCLUDED_ARMY_UNITS.includes('scout'));
});

test('unitCostTotal sums named resources or uses costs.total', () => {
  assert.equal(unitCostTotal({ costs: { total: 100 } }), 100);
  assert.equal(unitCostTotal({ costs: { food: 50, gold: 30 } }), 80);
  assert.equal(unitCostTotal({ costs: { food: 50, wood: 25, gold: 30, stone: 0 } }), 105);
  assert.equal(unitCostTotal(null), 0);
  assert.equal(unitCostTotal({}), 0);
  assert.equal(unitCostTotal({ costs: null }), 0);
});

test('unitMergeKey strips age/numeric suffixes when no pbgid', () => {
  assert.equal(unitMergeKey('units/knight_3'), 'knight');
  assert.equal(unitMergeKey('units/archer_age_4'), 'archer');
  assert.equal(unitMergeKey('units/spearman_2'), 'spearman');
  assert.equal(unitMergeKey('units/horseman'), 'horseman');
});

test('unitMergeKey returns lowercased filename basename', () => {
  assert.equal(unitMergeKey('Some/Path/To/Knight_3.png'.replace('.png', '')), 'knight');
  assert.equal(unitMergeKey(''), '');
  assert.equal(unitMergeKey(null), '');
});
