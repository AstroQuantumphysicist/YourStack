import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Container,
  Database,
  FunctionSquare,
  Gauge,
  HardDrive,
  Map,
  ShieldCheck,
  Github,
  Zap,
} from 'lucide-react';
import { Wordmark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { ArchitectureDiagram } from '@/components/architecture-diagram';
import { Button } from '@/components/ui/button';
import { API_V1 } from '@/lib/api';

const features = [
  {
    icon: Boxes,
    title: 'Apps',
    body: 'Ship Next.js, Node, Python, static sites, or a raw Dockerfile. Health checks, resource limits, and zero-downtime deploys built in.',
  },
  {
    icon: Database,
    title: 'Databases',
    body: 'Managed Postgres, MySQL, Redis and MongoDB in a click. Sized, backed up, and provisioned on your own capacity with credentials ready to copy.',
  },
  {
    icon: HardDrive,
    title: 'Storage',
    body: 'S3-compatible object storage for assets, uploads and backups. Get an endpoint and access keys that drop into any S3 client.',
  },
  {
    icon: FunctionSquare,
    title: 'Functions',
    body: 'Serverless functions in Node, Python, Go or Bun. Invoke over HTTP, watch latency in real time, and scale to zero when idle.',
  },
  {
    icon: Container,
    title: 'CI Runners',
    body: 'Self-hosted GitHub Actions runner pools that start and stop on your nodes as jobs queue and drain. Your CI, your hardware.',
  },
  {
    icon: Gauge,
    title: 'Autoscaling',
    body: 'Scale replicas on CPU, memory, requests or latency. Set a target, a range, and a cooldown — YourStack keeps you there.',
  },
  {
    icon: Map,
    title: 'Global Regions',
    body: 'Tag nodes with a location and place databases, buckets and functions close to your users across every region you run.',
  },
  {
    icon: Zap,
    title: 'Live Metrics',
    body: 'Real-time worker load — CPU, RAM, requests, latency and replicas — streamed to crisp charts for every resource you run.',
  },
];

const plans = [
  {
    name: 'Hobby',
    price: '$0',
    tagline: 'For side projects on your own box.',
    features: ['1 workspace', 'Up to 2 nodes', 'Apps, databases & storage', 'Community support'],
    highlight: false,
  },
  {
    name: 'Team',
    price: '$29',
    tagline: 'For teams shipping on shared capacity.',
    features: ['Unlimited nodes', 'Autoscaling & CI runners', 'Live metrics & regions', 'Priority support'],
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: "Let's talk",
    tagline: 'For platforms that own their cloud.',
    features: ['SSO & audit exports', 'Dedicated regions', 'SLA & onboarding', 'Solutions engineering'],
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div className="app-aurora relative min-h-screen overflow-hidden">
      {/* Ambient grid */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'linear-gradient(to bottom, black, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 70%)',
        }}
      />

      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <a href={`${API_V1}/auth/github`}>
            <Button size="sm" className="hidden sm:inline-flex">
              <Github className="h-4 w-4" /> Continue with GitHub
            </Button>
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 text-center sm:pt-20">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted/60 px-3 py-1 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-accent" />
          Premium bring-your-own-server cloud
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          <span className="text-gradient">Bring your own server.</span>
          <br />
          We turn it into a cloud.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
          YourStack is the control plane for infrastructure you own. Connect your nodes, push your
          code, and get deployments, pipelines, secrets and domains — without renting someone
          else&apos;s hardware.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={`${API_V1}/auth/github`}>
            <Button size="lg" className="w-full sm:w-auto">
              <Github className="h-4 w-4" /> Continue with GitHub
            </Button>
          </a>
          <Link href="/login">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              Explore the dashboard <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Local development supports instant email sign-in — no GitHub required.
        </p>
      </section>

      {/* Architecture */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="glass rounded-3xl border border-border p-4 shadow-card sm:p-8">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Control plane orchestrates. Your servers run the workloads.
          </div>
          <ArchitectureDiagram />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            A whole cloud, on the capacity you control
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Apps, databases, storage, functions, CI runners, autoscaling and global regions — one
            control plane, your hardware.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-muted text-primary transition-colors group-hover:border-primary/40">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pay for the platform, not the hardware
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            You bring the servers. We bring the control plane. Simple pricing that scales with your
            team.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-6 shadow-card transition-all ${
                plan.highlight
                  ? 'border-primary/50 bg-card shadow-glow'
                  : 'border-border bg-card hover:border-primary/30'
              }`}
            >
              {plan.highlight ? (
                <span className="absolute -top-3 left-6 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                {plan.price.startsWith('$') && plan.price !== '$0' ? (
                  <span className="text-sm text-muted-foreground">/ month</span>
                ) : null}
              </div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-primary" /> {feat}
                  </li>
                ))}
              </ul>
              <a href={`${API_V1}/auth/github`} className="mt-6">
                <Button variant={plan.highlight ? 'primary' : 'outline'} className="w-full">
                  Get started
                </Button>
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="app-aurora relative overflow-hidden rounded-3xl border border-border bg-card p-10 text-center shadow-card">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Your hardware is ready. Give it a control plane.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            Spin up your workspace, join a node, and deploy your first app in minutes.
          </p>
          <div className="mt-7 flex justify-center">
            <a href={`${API_V1}/auth/github`}>
              <Button size="lg">
                <Github className="h-4 w-4" /> Get started with GitHub
              </Button>
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <Wordmark size={22} />
          <p>Bring your own server. We turn it into a cloud.</p>
        </div>
      </footer>
    </div>
  );
}
