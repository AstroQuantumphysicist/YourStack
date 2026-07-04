import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  GitBranch,
  Globe,
  KeyRound,
  Rocket,
  Server,
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
    icon: Server,
    title: 'Nodes',
    body: 'Attach any server — a VPS, a homelab box, bare metal — with one command. A lightweight agent turns it into managed capacity.',
  },
  {
    icon: Boxes,
    title: 'Apps',
    body: 'Ship Next.js, Node, Python, static sites, or a raw Dockerfile. Health checks, resource limits, and zero-downtime strategies built in.',
  },
  {
    icon: Rocket,
    title: 'Deployments',
    body: 'Every push produces a versioned, reproducible deployment. Roll back to any prior version in a single click.',
  },
  {
    icon: GitBranch,
    title: 'Pipelines',
    body: 'A staged CI/CD pipeline — checkout, install, test, build, deploy, health — streamed live to your dashboard.',
  },
  {
    icon: KeyRound,
    title: 'Secrets',
    body: 'Encrypted at rest with AES-256-GCM. Scope to a project, app, or environment. Values are never shown again.',
  },
  {
    icon: Globe,
    title: 'Domains',
    body: 'Bring your own domain with automatic DNS verification and HTTPS provisioned at the edge via Caddy.',
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
            Everything a platform team needs
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            A complete deployment surface — running entirely on the capacity you control.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
