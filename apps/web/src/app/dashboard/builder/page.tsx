'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Boxes,
  Clock,
  Code2,
  Database,
  Download,
  FunctionSquare,
  Globe,
  HardDrive,
  Link2,
  Network,
  Plus,
  Rocket,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { BlueprintPlanItem, ProjectDTO } from '@yourstack/shared';
import { validateBlueprint } from '@yourstack/shared';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { fromYaml } from '@/lib/yaml';
import {
  blueprintToState,
  builderId,
  makeNode,
  NODE_KINDS,
  NODE_META,
  stateToBlueprint,
  stateToYaml,
  type BuilderNode,
  type BuilderState,
  type NodeKind,
} from '@/lib/builder';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<NodeKind, LucideIcon> = {
  app: Boxes,
  database: Database,
  bucket: HardDrive,
  function: FunctionSquare,
  cron: Clock,
  firewall: ShieldCheck,
  loadBalancer: Network,
  domain: Globe,
};

const ACCENT_CLASS: Record<string, string> = {
  primary: 'border-primary/40 text-primary',
  info: 'border-info/40 text-info',
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  danger: 'border-danger/40 text-danger',
};

const CARD_W = 190;

const STARTER: () => BuilderState = () => {
  const app = makeNode('app', 300, 70, []);
  app.name = 'web';
  const db = makeNode('database', 560, 70, [app]);
  const lb = makeNode('loadBalancer', 60, 70, [app, db]);
  const domain = makeNode('domain', 60, 240, [app, db, lb]);
  return {
    project: 'my-project',
    nodes: [lb, app, db, domain],
    edges: [
      { id: builderId('e'), from: lb.id, to: app.id },
      { id: builderId('e'), from: domain.id, to: app.id },
    ],
  };
};

export default function BuilderPage() {
  const { workspace } = useSession();
  const wid = workspace?.id;
  const toast = useToast();

  const [state, setState] = useState<BuilderState>(STARTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(true);
  const [yaml, setYaml] = useState('');
  const [yamlEdited, setYamlEdited] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [plan, setPlan] = useState<BlueprintPlanItem[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const { nodes } = state;
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const setNodes = useCallback(
    (updater: (prev: BuilderNode[]) => BuilderNode[]) =>
      setState((s) => ({ ...s, nodes: updater(s.nodes) })),
    [],
  );

  // Regenerate YAML from the canvas unless the user is hand-editing it.
  useEffect(() => {
    if (!yamlEdited) setYaml(stateToYaml(state));
  }, [state, yamlEdited]);

  const updateNode = useCallback(
    (id: string, patch: Partial<BuilderNode>) =>
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n))),
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setState((s) => ({
        ...s,
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.from !== id && e.to !== id),
      }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [],
  );

  const addNode = (kind: NodeKind) => {
    setState((s) => {
      const x = 80 + (s.nodes.length % 4) * 60 + 40;
      const y = 60 + (s.nodes.length % 5) * 40 + 40;
      const node = makeNode(kind, x, y, s.nodes);
      setSelectedId(node.id);
      return { ...s, nodes: [...s.nodes, node] };
    });
  };

  // Node connection: pick a source, then a target.
  const handleNodeClick = (id: string) => {
    if (connectFrom && connectFrom !== id) {
      const from = connectFrom;
      setState((s) => {
        const exists = s.edges.some(
          (e) =>
            (e.from === from && e.to === id) || (e.from === id && e.to === from),
        );
        if (exists) return s;
        return { ...s, edges: [...s.edges, { id: builderId('e'), from, to: id }] };
      });
      setConnectFrom(null);
    } else {
      setSelectedId(id);
    }
  };

  const removeEdge = (id: string) =>
    setState((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));

  const applyYaml = () => {
    const parsed = fromYaml(yaml);
    if (!parsed.ok) {
      toast.error('Invalid YAML', parsed.error);
      return;
    }
    const result = validateBlueprint(parsed.value);
    if (!result.ok || !result.blueprint) {
      toast.error('Blueprint invalid', result.errors?.slice(0, 2).join('; '));
      return;
    }
    setState(blueprintToState(result.blueprint));
    setYamlEdited(false);
    setSelectedId(null);
    toast.success('Canvas updated from YAML');
  };

  const runPlan = async () => {
    if (!wid) return;
    const bp = stateToBlueprint(state);
    const local = validateBlueprint(bp);
    if (!local.ok) {
      toast.error('Fix the blueprint first', local.errors?.slice(0, 2).join('; '));
      return;
    }
    setPlanning(true);
    setPlan(null);
    setDeployOpen(true);
    try {
      const res = await api.applyBlueprint(wid, bp, true);
      setPlan(res.plan);
    } catch (err) {
      toast.error('Could not compute plan', err instanceof ApiError ? err.message : undefined);
      setDeployOpen(false);
    } finally {
      setPlanning(false);
    }
  };

  const deploy = async () => {
    if (!wid) return;
    setDeploying(true);
    try {
      await api.applyBlueprint(wid, stateToBlueprint(state), false);
      toast.success('Blueprint applied', 'Resources are being reconciled.');
      setDeployOpen(false);
      setPlan(null);
    } catch (err) {
      toast.error('Deploy failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Infrastructure builder"
        description="Compose your cloud visually, then deploy it as a yourstack.yaml blueprint."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="h-4 w-4" /> Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowYaml((v) => !v)}
              className={cn(showYaml && 'border-primary/40 text-primary')}
            >
              <Code2 className="h-4 w-4" /> YAML
            </Button>
            <Button size="sm" onClick={runPlan} disabled={!wid}>
              <Rocket className="h-4 w-4" /> Deploy
            </Button>
          </div>
        }
      />

      {/* Project meta */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Project</Label>
          <Input
            value={state.project}
            onChange={(e) => setState((s) => ({ ...s, project: e.target.value }))}
            className="h-8 w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Region</Label>
          <Input
            value={state.region ?? ''}
            placeholder="auto"
            onChange={(e) => setState((s) => ({ ...s, region: e.target.value || undefined }))}
            className="h-8 w-32"
          />
        </div>
        {connectFrom ? (
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1 text-xs text-primary">
            <Link2 className="h-3.5 w-3.5" /> Click a node to connect, or
            <button className="underline" onClick={() => setConnectFrom(null)}>
              cancel
            </button>
          </div>
        ) : null}
      </div>

      {/* Palette */}
      <div className="flex flex-wrap gap-2">
        {NODE_KINDS.map((kind) => {
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              onClick={() => addNode(kind)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Icon className="h-3.5 w-3.5" />
              {NODE_META[kind].label}
              <Plus className="h-3 w-3 opacity-60" />
            </button>
          );
        })}
      </div>

      <div className={cn('grid gap-4', showYaml ? 'lg:grid-cols-[1fr_22rem]' : '')}>
        <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
          <Canvas
            state={state}
            selectedId={selectedId}
            connectFrom={connectFrom}
            onNodeClick={handleNodeClick}
            onNodeMove={(id, x, y) => updateNode(id, { x, y })}
            onBackgroundClick={() => {
              setSelectedId(null);
              setConnectFrom(null);
            }}
            onRemoveEdge={removeEdge}
          />
          <Inspector
            node={selected}
            onChange={(patch) => selected && updateNode(selected.id, patch)}
            onDelete={() => selected && deleteNode(selected.id)}
            onStartConnect={() => selected && setConnectFrom(selected.id)}
          />
        </div>

        {showYaml ? (
          <div className="flex min-h-[24rem] flex-col rounded-2xl border border-border bg-[hsl(224_44%_3%)]">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Code2 className="h-3.5 w-3.5" /> yourstack.yaml
                {yamlEdited ? <Badge variant="warning">edited</Badge> : null}
              </span>
              <div className="flex items-center gap-1">
                <CopyButton value={yaml} label="Copy" />
                {yamlEdited ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setYamlEdited(false)}>
                      Revert
                    </Button>
                    <Button size="sm" variant="outline" onClick={applyYaml}>
                      Apply to canvas
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <textarea
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setYamlEdited(true);
              }}
              spellCheck={false}
              className="flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
              aria-label="Blueprint YAML"
            />
          </div>
        ) : null}
      </div>

      <ImportDialog
        wid={wid}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(s) => {
          setState(s);
          setYamlEdited(false);
          setSelectedId(null);
          setImportOpen(false);
        }}
      />

      <DeployDialog
        open={deployOpen}
        planning={planning}
        deploying={deploying}
        plan={plan}
        onClose={() => setDeployOpen(false)}
        onConfirm={deploy}
      />
    </div>
  );
}

/* --------------------------------- Canvas ---------------------------------- */

function Canvas({
  state,
  selectedId,
  connectFrom,
  onNodeClick,
  onNodeMove,
  onBackgroundClick,
  onRemoveEdge,
}: {
  state: BuilderState;
  selectedId: string | null;
  connectFrom: string | null;
  onNodeClick: (id: string) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onBackgroundClick: () => void;
  onRemoveEdge: (id: string) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [, force] = useState(0);

  const onPointerDown = (e: React.PointerEvent, node: BuilderNode) => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    drag.current = {
      id: node.id,
      dx: e.clientX - rect.left - node.x + area.scrollLeft,
      dy: e.clientY - rect.top - node.y + area.scrollTop,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const area = areaRef.current;
    if (!d || !area) return;
    const rect = area.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - d.dx + area.scrollLeft);
    const y = Math.max(0, e.clientY - rect.top - d.dy + area.scrollTop);
    onNodeMove(d.id, Math.round(x), Math.round(y));
    force((n) => n + 1);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const nodeById = useMemo(() => {
    const m = new Map<string, BuilderNode>();
    for (const n of state.nodes) m.set(n.id, n);
    return m;
  }, [state.nodes]);

  return (
    <div
      ref={areaRef}
      className="relative h-[30rem] overflow-auto rounded-2xl border border-border bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:20px_20px]"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackgroundClick();
      }}
    >
      <div className="relative h-[900px] w-[1400px]">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {state.edges.map((edge) => {
            const a = nodeById.get(edge.from);
            const b = nodeById.get(edge.to);
            if (!a || !b) return null;
            const x1 = a.x + CARD_W;
            const y1 = a.y + 26;
            const x2 = b.x;
            const y2 = b.y + 26;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeOpacity={0.55}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {/* Edge delete handles */}
        {state.edges.map((edge) => {
          const a = nodeById.get(edge.from);
          const b = nodeById.get(edge.to);
          if (!a || !b) return null;
          const cx = (a.x + CARD_W + b.x) / 2;
          const cy = (a.y + b.y) / 2 + 26;
          return (
            <button
              key={`del-${edge.id}`}
              onClick={() => onRemoveEdge(edge.id)}
              style={{ left: cx - 9, top: cy - 9 }}
              className="absolute z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-40 transition-opacity hover:text-danger hover:opacity-100"
              aria-label="Remove connection"
            >
              <X className="h-3 w-3" />
            </button>
          );
        })}

        {state.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={node.id === selectedId}
            connecting={connectFrom === node.id}
            onPointerDown={(e) => onPointerDown(e, node)}
            onClick={() => onNodeClick(node.id)}
          />
        ))}
      </div>
    </div>
  );
}

function NodeCard({
  node,
  selected,
  connecting,
  onPointerDown,
  onClick,
}: {
  node: BuilderNode;
  selected: boolean;
  connecting: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const Icon = KIND_ICON[node.kind];
  const accent = ACCENT_CLASS[NODE_META[node.kind].accent] ?? ACCENT_CLASS.primary!;
  const subtitle = nodeSubtitle(node);
  return (
    <div
      style={{ left: node.x, top: node.y, width: CARD_W }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'group absolute cursor-pointer select-none rounded-xl border bg-card shadow-card transition-shadow',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:shadow-glow',
        connecting && 'ring-2 ring-primary/50',
      )}
    >
      <div
        onPointerDown={onPointerDown}
        className="flex cursor-grab items-center gap-2 rounded-t-xl border-b border-border px-3 py-2 active:cursor-grabbing"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-surface-muted',
            accent,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {node.name || NODE_META[node.kind].label}
        </span>
      </div>
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{subtitle}</span>
      </div>
    </div>
  );
}

function nodeSubtitle(node: BuilderNode): string {
  switch (node.kind) {
    case 'app':
      return node.source || node.image || `port ${node.port ?? '—'}`;
    case 'database':
      return `${node.engine ?? 'postgres'} ${node.version ?? ''}`.trim();
    case 'bucket':
      return node.isPublic ? 'public bucket' : 'private bucket';
    case 'function':
      return node.runtime ?? 'node20';
    case 'cron':
      return node.schedule ?? '';
    case 'firewall':
      return `${(node.rules ?? []).length} rules · default ${node.defaultInbound ?? 'deny'}`;
    case 'loadBalancer':
      return `:${node.listenPort ?? 80} · ${node.algorithm ?? 'round_robin'}`;
    case 'domain':
      return node.hostname ?? '';
    default:
      return '';
  }
}

/* -------------------------------- Inspector -------------------------------- */

function Inspector({
  node,
  onChange,
  onDelete,
  onStartConnect,
}: {
  node: BuilderNode | null;
  onChange: (patch: Partial<BuilderNode>) => void;
  onDelete: () => void;
  onStartConnect: () => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Nothing selected</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a node from the palette, or click one on the canvas to edit its properties.
        </p>
      </div>
    );
  }
  const Icon = KIND_ICON[node.kind];
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-muted text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">
          {NODE_META[node.kind].label}
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Field label="Name">
          <Input value={node.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8" />
        </Field>

        {node.kind === 'app' ? (
          <>
            <Field label="Source (git repo)">
              <Input
                value={node.source ?? ''}
                placeholder="github.com/acme/web"
                onChange={(e) => onChange({ source: e.target.value })}
                className="h-8"
              />
            </Field>
            <Field label="Image (optional)">
              <Input
                value={node.image ?? ''}
                placeholder="nginx:1.27"
                onChange={(e) => onChange({ image: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Framework">
                <Select
                  value={node.framework ?? 'node'}
                  onChange={(e) => onChange({ framework: e.target.value })}
                  className="h-8"
                >
                  {['nextjs', 'node', 'python', 'dockerfile', 'static'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={node.port ?? ''}
                  onChange={(e) => onChange({ port: Number(e.target.value) || undefined })}
                  className="h-8"
                />
              </Field>
            </div>
          </>
        ) : null}

        {node.kind === 'database' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Engine">
              <Select
                value={node.engine ?? 'postgres'}
                onChange={(e) => onChange({ engine: e.target.value })}
                className="h-8"
              >
                {['postgres', 'mysql', 'redis', 'mongodb'].map((en) => (
                  <option key={en} value={en}>
                    {en}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Version">
              <Input
                value={node.version ?? ''}
                onChange={(e) => onChange({ version: e.target.value })}
                className="h-8"
              />
            </Field>
          </div>
        ) : null}

        {node.kind === 'bucket' ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={node.isPublic ?? false}
              onChange={(e) => onChange({ isPublic: e.target.checked })}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Public bucket
          </label>
        ) : null}

        {node.kind === 'function' ? (
          <>
            <Field label="Runtime">
              <Select
                value={node.runtime ?? 'node20'}
                onChange={(e) => onChange({ runtime: e.target.value })}
                className="h-8"
              >
                {['node20', 'python311', 'go122', 'bun1'].map((rt) => (
                  <option key={rt} value={rt}>
                    {rt}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Handler">
              <Input
                value={node.handler ?? ''}
                onChange={(e) => onChange({ handler: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </Field>
          </>
        ) : null}

        {node.kind === 'cron' ? (
          <>
            <Field label="Schedule (cron)">
              <Input
                value={node.schedule ?? ''}
                onChange={(e) => onChange({ schedule: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </Field>
            <Field label="Image">
              <Input
                value={node.image ?? ''}
                onChange={(e) => onChange({ image: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </Field>
            <Field label="Command">
              <Input
                value={node.command ?? ''}
                onChange={(e) => onChange({ command: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </Field>
          </>
        ) : null}

        {node.kind === 'domain' ? (
          <Field label="Hostname">
            <Input
              value={node.hostname ?? ''}
              onChange={(e) => onChange({ hostname: e.target.value, name: e.target.value })}
              className="h-8"
            />
          </Field>
        ) : null}

        {node.kind === 'loadBalancer' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Listen port">
                <Input
                  type="number"
                  value={node.listenPort ?? 80}
                  onChange={(e) => onChange({ listenPort: Number(e.target.value) || undefined })}
                  className="h-8"
                />
              </Field>
              <Field label="Algorithm">
                <Select
                  value={node.algorithm ?? 'round_robin'}
                  onChange={(e) => onChange({ algorithm: e.target.value })}
                  className="h-8"
                >
                  {['round_robin', 'least_conn', 'ip_hash'].map((al) => (
                    <option key={al} value={al}>
                      {al}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Domain (optional)">
              <Input
                value={node.domain ?? ''}
                onChange={(e) => onChange({ domain: e.target.value })}
                className="h-8"
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={node.autoHttps ?? false}
                onChange={(e) => onChange({ autoHttps: e.target.checked })}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              Auto HTTPS
            </label>
            <p className="text-xs text-muted-foreground">
              Connect this load balancer to app nodes to add them as targets.
            </p>
          </>
        ) : null}

        {node.kind === 'firewall' ? (
          <FirewallRulesEditor node={node} onChange={onChange} />
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" className="flex-1" onClick={onStartConnect}>
          <Link2 className="h-4 w-4" /> Connect
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete node">
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </div>
    </div>
  );
}

function FirewallRulesEditor({
  node,
  onChange,
}: {
  node: BuilderNode;
  onChange: (patch: Partial<BuilderNode>) => void;
}) {
  const rules = node.rules ?? [];
  const update = (i: number, patch: Partial<(typeof rules)[number]>) =>
    onChange({ rules: rules.map((r, ri) => (ri === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2">
      <Field label="Default inbound">
        <Select
          value={node.defaultInbound ?? 'deny'}
          onChange={(e) => onChange({ defaultInbound: e.target.value })}
          className="h-8"
        >
          <option value="deny">Deny</option>
          <option value="allow">Allow</option>
        </Select>
      </Field>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Rules</span>
        <button
          onClick={() =>
            onChange({ rules: [...rules, { allow: true, protocol: 'tcp', port: '', cidr: '0.0.0.0/0' }] })
          }
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {rules.map((r, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center gap-1.5">
            <Select
              value={r.allow ? 'allow' : 'deny'}
              onChange={(e) => update(i, { allow: e.target.value === 'allow' })}
              className="h-7 flex-1 text-xs"
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </Select>
            <Select
              value={r.protocol}
              onChange={(e) => update(i, { protocol: e.target.value })}
              className="h-7 flex-1 text-xs"
            >
              {['tcp', 'udp', 'icmp', 'any'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <button
              onClick={() => onChange({ rules: rules.filter((_, ri) => ri !== i) })}
              className="rounded p-1 text-muted-foreground hover:text-danger"
              aria-label="Remove rule"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={r.port}
              placeholder="port"
              onChange={(e) => update(i, { port: e.target.value })}
              className="h-7 w-16 text-xs"
            />
            <Input
              value={r.cidr}
              placeholder="0.0.0.0/0"
              onChange={(e) => update(i, { cidr: e.target.value })}
              className="h-7 flex-1 font-mono text-xs"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* ------------------------------ Import dialog ------------------------------ */

function ImportDialog({
  wid,
  open,
  onClose,
  onImport,
}: {
  wid: string | null | undefined;
  open: boolean;
  onClose: () => void;
  onImport: (s: BuilderState) => void;
}) {
  const toast = useToast();
  const projects = useSWR<{ projects: ProjectDTO[] }>(
    open && wid ? `/workspaces/${wid}/projects` : null,
  );
  const [pid, setPid] = useState('');
  const [loading, setLoading] = useState(false);
  const list = projects.data?.projects ?? [];
  const effective = pid || list[0]?.id || '';

  const load = async () => {
    if (!effective) return;
    setLoading(true);
    try {
      const { blueprint } = await api.projectBlueprint(effective);
      onImport(blueprintToState(blueprint));
      toast.success('Blueprint imported');
    } catch (err) {
      toast.error('Could not import blueprint', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from project"
      description="Load an existing project's blueprint onto the canvas."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={load} loading={loading} disabled={!effective}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-1.5 py-2">
        <Label htmlFor="import-project">Project</Label>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects in this workspace yet.</p>
        ) : (
          <Select id="import-project" value={effective} onChange={(e) => setPid(e.target.value)}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------ Deploy dialog ------------------------------ */

function DeployDialog({
  open,
  planning,
  deploying,
  plan,
  onClose,
  onConfirm,
}: {
  open: boolean;
  planning: boolean;
  deploying: boolean;
  plan: BlueprintPlanItem[] | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const counts = useMemo(() => {
    const c = { create: 0, update: 0, noop: 0 };
    for (const item of plan ?? []) c[item.action] += 1;
    return c;
  }, [plan]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Deploy blueprint"
      description="Review the plan, then apply it to your workspace."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            loading={deploying}
            disabled={planning || !plan || plan.length === 0}
          >
            <Rocket className="h-4 w-4" /> Apply blueprint
          </Button>
        </>
      }
    >
      <div className="py-2">
        {planning ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Computing plan…</p>
        ) : !plan ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No plan available.</p>
        ) : plan.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing to do — your infrastructure already matches this blueprint.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 text-xs">
              <Badge variant="success">{counts.create} create</Badge>
              <Badge variant="info">{counts.update} update</Badge>
              <Badge variant="default">{counts.noop} no-op</Badge>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {plan.map((item, i) => (
                <div
                  key={`${item.kind}-${item.name}-${i}`}
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                >
                  <Badge
                    variant={
                      item.action === 'create'
                        ? 'success'
                        : item.action === 'update'
                          ? 'info'
                          : 'default'
                    }
                    className="w-16 justify-center capitalize"
                  >
                    {item.action}
                  </Badge>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {item.kind}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-foreground">
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
