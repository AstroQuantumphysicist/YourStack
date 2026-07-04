import { describe, expect, it } from 'vitest';
import { validateBlueprint, type Blueprint } from '@yourstack/shared';
import {
  computeBlueprintPlan,
  emptyExisting,
  parseBlueprint,
  summarizePlan,
} from '../services/blueprint.service.js';
import { resolveLbTargets, appContainerAddress } from '../services/loadbalancer.service.js';

function bp(overrides: Partial<Blueprint> = {}): Blueprint {
  const parsed = validateBlueprint({
    version: 1,
    project: 'demo',
    apps: [{ name: 'web', port: 3000 }],
    databases: [{ name: 'db', engine: 'postgres' }],
    ...overrides,
  });
  if (!parsed.ok || !parsed.blueprint) throw new Error('fixture invalid: ' + (parsed.errors ?? []).join(', '));
  return parsed.blueprint;
}

describe('computeBlueprintPlan', () => {
  it('marks every resource as create against an empty environment', () => {
    const plan = computeBlueprintPlan(bp(), emptyExisting());
    expect(plan).toEqual([
      { kind: 'app', name: 'web', action: 'create' },
      { kind: 'database', name: 'db', action: 'create' },
    ]);
  });

  it('marks resources that already exist (by name) as update', () => {
    const existing = emptyExisting();
    existing.apps.add('web');
    const plan = computeBlueprintPlan(bp(), existing);
    expect(plan.find((p) => p.kind === 'app')?.action).toBe('update');
    expect(plan.find((p) => p.kind === 'database')?.action).toBe('create');
  });

  it('diffs each resource kind independently and summarizes counts', () => {
    const blueprint = bp({
      buckets: [{ name: 'assets' }],
      loadBalancers: [{ name: 'edge', port: 80, targets: ['web'] }],
    });
    const existing = emptyExisting();
    existing.databases.add('db');
    existing.buckets.add('assets');
    const plan = computeBlueprintPlan(blueprint, existing);
    expect(summarizePlan(plan)).toEqual({ create: 2, update: 2, noop: 0 });
  });
});

describe('parseBlueprint', () => {
  it('parses a YAML string into a validated blueprint', () => {
    const yaml = ['version: 1', 'project: fromyaml', 'apps:', '  - name: api', '    port: 8080'].join('\n');
    const result = parseBlueprint(yaml);
    expect(result.ok).toBe(true);
    expect(result.blueprint?.project).toBe('fromyaml');
    expect(result.blueprint?.apps[0]?.port).toBe(8080);
  });

  it('reports validation errors for a structurally invalid blueprint', () => {
    const result = parseBlueprint({ version: 1 }); // missing `project`
    expect(result.ok).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('surfaces a yaml parse error', () => {
    const result = parseBlueprint('project: [unterminated');
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toMatch(/yaml:/);
  });
});

describe('resolveLbTargets', () => {
  it('maps app ids to their internal container address and appends explicit hosts', () => {
    const targets = resolveLbTargets(
      [
        { appId: 'app_1', port: 3000 },
        { appId: 'app_2', port: 8080 },
      ],
      ['10.0.0.9:9000'],
    );
    expect(targets).toEqual([
      { address: appContainerAddress('app_1', 3000), weight: 1, appId: 'app_1' },
      { address: 'yourstack-app_2:8080', weight: 1, appId: 'app_2' },
      { address: '10.0.0.9:9000', weight: 1, appId: null },
    ]);
  });

  it('de-duplicates and ignores blank explicit targets', () => {
    const targets = resolveLbTargets([{ appId: 'a', port: 80 }], ['yourstack-a:80', '  ', 'host:1']);
    // The explicit duplicate of the app address is dropped; blanks ignored.
    expect(targets.map((t) => t.address)).toEqual(['yourstack-a:80', 'host:1']);
  });
});
