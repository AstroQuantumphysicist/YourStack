import { describe, expect, it } from 'vitest';
import { buildFirewallSpec, buildFlushSpec, type FirewallRuleRow } from '../processors/firewall.js';
import { dedupeTargets } from '../processors/loadbalancer.js';

const rule = (over: Partial<FirewallRuleRow>): FirewallRuleRow => ({
  direction: 'inbound',
  action: 'allow',
  protocol: 'tcp',
  port: null,
  cidr: '0.0.0.0/0',
  comment: null,
  position: 0,
  ...over,
});

describe('buildFirewallSpec', () => {
  it('maps rows to a spec in position order and normalizes enums', () => {
    const spec = buildFirewallSpec({ id: 'fw1', defaultInbound: 'deny', defaultOutbound: 'allow' }, [
      rule({ position: 2, protocol: 'bogus', action: 'deny', port: '443', cidr: '' }),
      rule({ position: 1, direction: 'outbound', port: '22', comment: 'ssh' }),
    ]);
    expect(spec.firewallId).toBe('fw1');
    expect(spec.defaultInbound).toBe('deny');
    expect(spec.defaultOutbound).toBe('allow');
    // sorted by position -> outbound rule first
    expect(spec.rules[0]).toEqual({
      direction: 'outbound',
      action: 'allow',
      protocol: 'tcp',
      port: '22',
      cidr: '0.0.0.0/0',
      comment: 'ssh',
    });
    // unknown protocol falls back to tcp; blank cidr defaults; deny preserved
    expect(spec.rules[1]).toEqual({
      direction: 'inbound',
      action: 'deny',
      protocol: 'tcp',
      port: '443',
      cidr: '0.0.0.0/0',
      comment: undefined,
    });
  });

  it('preserves udp/icmp/any protocols and defaults an invalid default policy', () => {
    const spec = buildFirewallSpec({ id: 'fw2', defaultInbound: 'nonsense', defaultOutbound: 'deny' }, [
      rule({ protocol: 'udp' }),
      rule({ protocol: 'icmp', position: 1 }),
    ]);
    expect(spec.defaultInbound).toBe('deny'); // invalid -> secure default
    expect(spec.defaultOutbound).toBe('deny');
    expect(spec.rules.map((r) => r.protocol)).toEqual(['udp', 'icmp']);
  });
});

describe('buildFlushSpec', () => {
  it('opens both directions with no rules', () => {
    expect(buildFlushSpec('fw9')).toEqual({
      firewallId: 'fw9',
      defaultInbound: 'allow',
      defaultOutbound: 'allow',
      rules: [],
    });
  });
});

describe('dedupeTargets', () => {
  it('collapses duplicate addresses summing weights, preserving order', () => {
    expect(
      dedupeTargets([
        { address: '10.0.0.1:80', weight: 1 },
        { address: '10.0.0.2:80', weight: 3 },
        { address: '10.0.0.1:80', weight: 2 },
      ]),
    ).toEqual([
      { address: '10.0.0.1:80', weight: 3 },
      { address: '10.0.0.2:80', weight: 3 },
    ]);
  });

  it('drops blank addresses and coerces bad weights to 1', () => {
    expect(
      dedupeTargets([
        { address: '  ', weight: 5 },
        { address: 'app:8080', weight: 0 },
        { address: 'app2:8080', weight: -4 },
      ]),
    ).toEqual([
      { address: 'app:8080', weight: 1 },
      { address: 'app2:8080', weight: 1 },
    ]);
  });
});
