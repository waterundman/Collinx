<p align="center">
  <img src="icon.png" alt="Collinx" width="96" />
</p>

<h1 align="center">Collinx</h1>

<p align="center">
  <strong>Agent-native Music IDE</strong><br/>
  <sub>Goals / Objects / Views / Renders / Taste Memory — One Graph</sub>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.de.md">Deutsch</a>
</p>

---

Collinx doesn't click buttons for you. It turns your music project into a typed property graph, then lets 8 specialized agents operate on that graph directly — composing, arranging, orchestrating, mixing, engraving, teaching, and learning your taste. Every operation produces a structured DiffEnvelope. You approve it, it lands on main. You don't? Roll it back.

This isn't a chatbot wrapped around a DAW. Agents have tool permissions, operation audits, and domain explanations. What they do — you can inspect, trace, and teach them to do better.

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                     Project Graph                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │Composition│  │ Notation │  │Performance│  │  Audio  │ │
│  │  Layer    │→│  Layer   │→│   Layer   │→│  Layer  │ │
│  │What was   │  │How it    │  │How it's   │  │How it   │ │
│  │written    │  │looks     │  │played     │  │sounds   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│       ↑              ↑              ↑            ↑      │
│  ┌────┴──────────────┴──────────────┴────────────┴────┐ │
│  │              Agent Bus (pub/sub)                   │ │
│  └────┬──────┬──────┬──────┬──────┬──────┬──────┬────┘ │
│     Plan  Compose Arrange Orch.  Mix  Engr. Teach  Taste│
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   DiffEnvelope                        Taste Genome
   (propose → approve → write)     (Bayesian taste memory)
```

**Project Graph** — 12 node types, 10 edge types, version control and branch management. All music data lives here: notes, chords, form, tracks, effects, scores, aesthetic evidence.

**DiffEnvelope** — The output format of every agent operation. Contains summary, domain explanations, evidence references, risk flags, and a rollback token. Default permission: `proposal_only` — agents propose, you decide.

**Taste Genome** — Your aesthetic memory across three layers: explainable (human-readable parameters), distribution (Beta / Dirichlet / Bernoulli), embedding (tag vectors). Covers 8 domains: harmony, melody, rhythm, texture, timbre, form, mix, reject. The more you use it, the better agents understand your taste.

---

## 8 Agents

| | Agent | What it does |
|---|---|---|
| 1 | **Planner** | Decomposes "write a chorus" into a task graph, maps to specific tools |
| 2 | **Composer** | Generates melodies and harmonies — 13 scales, 6 styles, 8 rhythm templates |
| 3 | **Arranger** | Motif → full arrangement. Form structure, energy curves, variant generation |
| 4 | **Orchestrator** | Instrumentation — 30+ instruments, 7 families, register conflict detection, playability validation |
| 5 | **Engraving** | Score layout, collision detection, part extraction (4 house styles) |
| 6 | **Mixing** | Gain structure, FX chains, panning — rule-based, not a black box |
| 7 | **Teaching** | Explains every musical decision at 4 difficulty levels |
| 8 | **Taste Memory** | Analyzes exports, accumulates aesthetic evidence, ranks candidates by taste |

Every agent operation is a DiffEnvelope — inspect, accept, reject, or rollback.

---

## UI — 9 Tabs

| Tab | What it does |
|---|---|
| **compose** | Piano roll + compact score + arrangement timeline |
| **arrange** | Section arrangement + diff preview |
| **orchestrate** | Instrument assignment + conflict display |
| **mixer** | Full mixer — gain, pan, mute, solo, FX chains |
| **score** | Full score — auto-layout, part extraction, MusicXML export |
| **taste** | Taste genome timeline + parameter library + diff reports |
| **teaching** | Multi-level music theory explanations |
| **agent** | Diff queue + chat interface |
| **graph** | Project graph visualization — Canvas 2D force-directed layout |

---

## Quick Start

```bash
# Requires: Node.js >= 18, pnpm 9

pnpm install          # Install dependencies
pnpm dev              # Start all dev servers
pnpm dev:ui           # Start UI only (port 5180)
pnpm build            # Build all packages
pnpm test             # Unit tests (Vitest)
pnpm test:e2e         # E2E tests (Playwright, 84 cases)
pnpm typecheck        # Type checking
```

---

## Tests

```
62+ unit test files   Covering all models, graph, diff, taste, IO, agents
12  E2E spec files    Covering all 9 tabs' core interactions
5   integration       Note→export, mixer chain, graph→diff, form, agent tools
2   suites            Performance + stability
```

---

## Tech Stack

```
TypeScript · React 18 · Vite 5 · pnpm 9 · Turborepo 2
Zod · pdfkit · fflate · VexFlow 5 · i18next
Vitest · Playwright · JUCE 8 (C++20)
```

---

## Project Structure

```
Collinx/
├── packages/
│   ├── core/          Domain models, graph, diff, taste, IO
│   ├── agent/         8 agents + tool registry + agent bus
│   ├── ui/            React frontend + 15 component dirs + E2E tests
│   └── audio/         C++20/JUCE audio engine (VST3/CLAP)
├── docs/              Terminology, iteration plan, research
└── .github/           CI pipeline
```

---

## Roadmap

| Phase | Content | Status |
|---|---|---|
| Phase 0 — PoC | Graph + Diff + Agent | Done |
| Phase 1 — MVP | Arrangement + Piano Roll + Score + Mixer + Taste + Export | 99% |
| Phase 2 — Usability | Engraving + A/B + Overlay + Performance | 95% |
| Phase 3 — Plugins | VST3 + Sandbox | 25% |
| Phase 4 — Ecosystem | CLAP + Market + SDK | — |

---

<p align="center">
  <sub>Private — not publicly released</sub>
</p>
