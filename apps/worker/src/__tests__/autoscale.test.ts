import { describe, expect, it } from 'vitest';
import { computeDesiredReplicas } from '../processors/autoscale.js';

describe('computeDesiredReplicas', () => {
  it('scales up when observed exceeds target', () => {
    const d = computeDesiredReplicas({ current: 2, observed: 90, target: 45, min: 1, max: 10 });
    expect(d.desired).toBe(4); // 2 * (90/45) = 4
    expect(d.reason).toBe('scaling up');
  });

  it('scales down when observed is well below target', () => {
    const d = computeDesiredReplicas({ current: 4, observed: 20, target: 80, min: 1, max: 10 });
    expect(d.desired).toBe(1); // ceil(4 * 0.25) = 1
    expect(d.reason).toBe('scaling down');
  });

  it('stays put within the deadband', () => {
    const d = computeDesiredReplicas({ current: 3, observed: 72, target: 70, min: 1, max: 10 });
    expect(d.desired).toBe(3);
    expect(d.reason).toBe('within deadband');
  });

  it('clamps to max', () => {
    const d = computeDesiredReplicas({ current: 5, observed: 100, target: 20, min: 1, max: 6 });
    expect(d.desired).toBe(6);
  });

  it('clamps to min', () => {
    const d = computeDesiredReplicas({ current: 3, observed: 1, target: 90, min: 2, max: 10 });
    expect(d.desired).toBe(2);
  });

  it('handles invalid target safely', () => {
    const d = computeDesiredReplicas({ current: 3, observed: 50, target: 0, min: 1, max: 10 });
    expect(d.desired).toBe(3);
  });
});
