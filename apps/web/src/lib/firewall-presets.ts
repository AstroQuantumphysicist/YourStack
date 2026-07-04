import { FirewallAction, FirewallDirection, FirewallProtocol } from '@yourstack/shared';

/** A rule as edited in the builder (no server id until persisted). */
export interface DraftRule {
  id: string;
  direction: string;
  action: string;
  protocol: string;
  port: string;
  cidr: string;
  comment: string;
}

let seq = 0;
export function draftRuleId(): string {
  seq += 1;
  return `draft-${Date.now().toString(36)}-${seq}`;
}

export function makeRule(partial: Partial<Omit<DraftRule, 'id'>> = {}): DraftRule {
  return {
    id: draftRuleId(),
    direction: partial.direction ?? FirewallDirection.INBOUND,
    action: partial.action ?? FirewallAction.ALLOW,
    protocol: partial.protocol ?? FirewallProtocol.TCP,
    port: partial.port ?? '',
    cidr: partial.cidr ?? '0.0.0.0/0',
    comment: partial.comment ?? '',
  };
}

export interface FirewallPreset {
  key: string;
  label: string;
  description: string;
  rules: () => DraftRule[];
}

const allow = (port: string, comment: string): DraftRule =>
  makeRule({ action: FirewallAction.ALLOW, protocol: FirewallProtocol.TCP, port, comment });

export const FIREWALL_PRESETS: FirewallPreset[] = [
  {
    key: 'web',
    label: 'Public web server',
    description: 'Allow SSH (22), HTTP (80) and HTTPS (443); everything else denied inbound.',
    rules: () => [
      allow('22', 'SSH'),
      allow('80', 'HTTP'),
      allow('443', 'HTTPS'),
    ],
  },
  {
    key: 'ssh',
    label: 'SSH only',
    description: 'Allow inbound SSH on port 22. Good for private/admin nodes.',
    rules: () => [allow('22', 'SSH')],
  },
  {
    key: 'https',
    label: 'HTTPS only',
    description: 'Allow inbound HTTPS on port 443 for edge/load-balanced nodes.',
    rules: () => [allow('443', 'HTTPS')],
  },
  {
    key: 'locked',
    label: 'Deny all inbound',
    description: 'No inbound rules — start from a locked-down baseline and add your own.',
    rules: () => [],
  },
];
