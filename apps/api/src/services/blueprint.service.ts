import { parse as parseYaml } from 'yaml';
import {
  validateBlueprint,
  type Blueprint,
  type BlueprintParseResult,
  type BlueprintPlanItem,
} from '@yourstack/shared';

/**
 * Blueprint engine helpers. A `yourstack.yaml` blueprint declares an entire
 * project's cloud setup; the engine parses/validates it, diffs it against what
 * already exists (the plan), and — outside dry-run — reconciles the difference.
 *
 * Everything here is deliberately pure so the diff and export logic is unit
 * testable without a database or queue.
 */

/**
 * Coerce raw input (a YAML/JSON string, or an already-parsed object) into a
 * validated Blueprint. YAML parse failures surface as a single error entry.
 */
export function parseBlueprint(raw: unknown): BlueprintParseResult {
  let candidate = raw;
  if (typeof raw === 'string') {
    try {
      candidate = parseYaml(raw);
    } catch (err) {
      return { ok: false, errors: [`yaml: ${(err as Error).message}`] };
    }
  }
  return validateBlueprint(candidate);
}

/** The set of resource names that already exist in a project, by kind. */
export interface ExistingResources {
  apps: Set<string>;
  databases: Set<string>;
  buckets: Set<string>;
  functions: Set<string>;
  cron: Set<string>;
  firewalls: Set<string>;
  loadBalancers: Set<string>;
}

export function emptyExisting(): ExistingResources {
  return {
    apps: new Set(),
    databases: new Set(),
    buckets: new Set(),
    functions: new Set(),
    cron: new Set(),
    firewalls: new Set(),
    loadBalancers: new Set(),
  };
}

/**
 * Diff a blueprint against existing resources, producing one plan item per
 * declared resource: `create` when it is new, `update` when a resource with the
 * same name already exists. Resources present only in the environment (not the
 * blueprint) are left untouched — blueprint apply is additive, never pruning.
 */
export function computeBlueprintPlan(bp: Blueprint, existing: ExistingResources): BlueprintPlanItem[] {
  const plan: BlueprintPlanItem[] = [];
  const push = (
    kind: BlueprintPlanItem['kind'],
    items: ReadonlyArray<{ name: string }>,
    have: Set<string>,
  ) => {
    for (const item of items) {
      plan.push({ kind, name: item.name, action: have.has(item.name) ? 'update' : 'create' });
    }
  };

  push('app', bp.apps, existing.apps);
  push('database', bp.databases, existing.databases);
  push('bucket', bp.buckets, existing.buckets);
  push('function', bp.functions, existing.functions);
  push('cron', bp.cron, existing.cron);
  push('firewall', bp.firewalls, existing.firewalls);
  push('loadBalancer', bp.loadBalancers, existing.loadBalancers);

  return plan;
}

/** How many resources the plan would create vs update (handy for summaries). */
export function summarizePlan(plan: BlueprintPlanItem[]): { create: number; update: number; noop: number } {
  return {
    create: plan.filter((p) => p.action === 'create').length,
    update: plan.filter((p) => p.action === 'update').length,
    noop: plan.filter((p) => p.action === 'noop').length,
  };
}
