<p align="center">
  <img src="icon.png" alt="Collinx" width="128" />
</p>

# Collinx

> An agent-native music IDE — unifying creative goals, music objects, views, renders, and aesthetic memory into a single project graph.

Collinx is not a traditional DAW. It is a music creation environment built on a **Project Graph** (typed property graph), operated by 8 specialized **Agents** that directly manipulate the graph to handle composition, arrangement, orchestration, mixing, notation, teaching, and aesthetic learning. Every agent operation produces a structured **DiffEnvelope** that is committed to the main branch only after user confirmation, with full audit, rollback, and domain explanation support.

---

## Core Concepts

### Project Graph

All music data (notes, chords, form, tracks, effects, score, aesthetic evidence) lives in a single typed property graph. Node types include `CompositionUnit`, `Phrase`, `Motif`, `Track`, `Player`, `PartLayout`, `NoteSpan`, `AutomationCurve`, `AudioBus`, `RenderArtifact`, `TasteEvidence`, and `ExportVersion`. Edge types include `contains`, `realizes`, `notates`, `performed_as`, `routed_to`, `rendered_to`, `derived_from`, `suggested_by_agent`, `confirmed_by_user`, and `updates_taste`. Full version control and branch management are supported.

### DiffEnvelope

The output format of all agent operations. Contains operation summary, domain explanations, evidence references, risk flags, and a rollback token. The default permission scope is `proposal_only` — agents can only propose; changes are written to the main graph only after user confirmation.

### Taste Genome

A long-term memory model of user aesthetics across three layers:
- **Explainable layer**: Human-readable parameters (e.g., `harmony.chromatic_color = 0.33`)
- **Distribution layer**: Bayesian distributions (Beta, Dirichlet, Bernoulli, Gaussian)
- **Embedding layer**: Tag-based embedding vectors

Covers 8 aesthetic domains: Harmony, Melody, Rhythm, Texture, Timbre, Form, Mix, Reject.

### Four-Layer Music Pipeline

| Layer | Content |
|-------|---------|
| Composition Layer | What was written — notes, chords, rhythm, form |
| Notation Layer | How it looks — score, layout, parts |
| Performance Layer | How it's played — tempo curves, dynamics, expression |
| Audio Layer | How it sounds — mixing, effects, export |

---

## Architecture

```
Collinx/
├── packages/
│   ├── core/        @collinx/core       Domain models, graph, diff, taste, IO
│   ├── agent/       @collinx/agent      8 specialized agents
│   ├── ui/          @collinx/ui         React + Vite frontend (9 tabs)
│   └── audio/       collinx-audio-engine  C++20/JUCE audio engine
├── docs/            Documentation
└── .github/         CI pipeline
```

**Tech Stack**: TypeScript, React 18, Vite 5, pnpm 9 + Turborepo 2, Zod, pdfkit, fflate, VexFlow 5, i18next, Vitest, Playwright, JUCE 8 (C++20)

---

## Packages

### @collinx/core

Core domain layer containing:
- **Models** (16 modules): NoteEvent, TempoMap, HarmonyPlan, Motif, Phrase, Section, FormRole, FormTemplate, EnergyCurve, Instrument, MixerState, FXChain, DSP effects, ScoreModel, EngravingEngine, StemRenderer
- **Graph system**: ProjectGraph (CRUD, traversal, validation, serialization), RevisionStore (commit, checkpoint, restore)
- **Diff system**: DiffEnvelope, DiffEngine (apply, rollback, validate, merge, conflict detection), DiffLog
- **Taste system** (12 modules): TasteGenome, TasteStore, EvidenceExtractor, ExportAnalyzer, UpdateEngine, ScoringEngine, ReportGenerator, TentativeBuffer, ProjectOverlay, ABPlayer
- **IO**: MIDI import/export, MusicXML 4.0, PDF score, WAV audio, `.agentmusic` container format
- **Agent infrastructure**: ToolRegistry (14 built-in tools), AgentBus (point-to-point, request/response, pub/sub)

### @collinx/agent

8 specialized agents:

| Agent | Responsibility |
|-------|---------------|
| **Planner** | Decomposes natural language goals into task graphs, maps keywords to tools |
| **Composer** | Generates melodies and harmonies (13 scales, 6 style templates, 8 rhythm templates) |
| **Arranger** | Expands motifs into full arrangements, designs form structure and energy curves |
| **Orchestrator** | Instrumentation, voice assignment, register conflict detection, playability validation (30+ instruments, 7 families) |
| **EngravingAgent** | Score layout, collision detection, part extraction (4 house styles) |
| **MixingAgent** | Suggests gain structure, FX chains, stereo panning |
| **TeachingAgent** | Explains musical decisions at 4 difficulty levels (Beginner/Intermediate/Advanced/Professional) |
| **TasteMemoryAgent** | Analyzes exports, confirms/rejects aesthetic evidence, rolls back genome, ranks candidates by taste |

### @collinx/ui

React 18 + Vite 5 frontend with 9 tabs:

| Tab | Components | Function |
|-----|-----------|----------|
| **compose** | PianoRollView, ScorePanel, ArrangementView | Piano roll editing + compact score + arrangement timeline |
| **arrange** | ArrangementView, ArrangerPanel | Section arrangement + diff preview |
| **orchestrate** | ArrangementView, OrchestratorPanel | Instrument assignment + conflict display |
| **mixer** | MixerConsole | Full mixer console (gain, pan, mute, solo, FX chains) |
| **score** | ScorePanel | Full score (auto-layout, part extraction, MusicXML export) |
| **taste** | TasteTimelineView, TasteLibraryPanel, TasteDiffPanel | Taste genome timeline + parameter library + diff reports |
| **teaching** | TeachingPanel | Multi-level music theory explanations |
| **agent** | AgentPanel, AgentChat | Diff queue + chat interface |
| **graph** | GraphView, NodeDetail | Project graph visualization (Canvas 2D, force-directed layout) |

### collinx-audio-engine

C++20 audio engine (JUCE 8.0.1):
- VST3 and CLAP plugin hosting with sandboxed crash detection
- Built-in wavetable synthesizer
- DSP: parallel processing, latency compensation
- MIDI effect chains and routing
- Preset management
- Async plugin scanning
- Performance monitoring and profiling
- Automation curves

---

## Quick Start

### Prerequisites

- Node.js >= 18
- pnpm 9.0.0
- CMake 3.22+ (audio engine)
- C++20 compiler (audio engine)

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev          # Start all dev servers
pnpm dev:ui       # Start UI only (port 5180)
```

### Build

```bash
pnpm build        # Build all packages via Turborepo
```

### Test

```bash
pnpm test         # Run all tests (Vitest unit tests)
pnpm test:core    # Core package tests only
pnpm test:agent   # Agent package tests only
pnpm test:e2e     # Playwright E2E tests (84 test cases)
```

### Other

```bash
pnpm typecheck    # TypeScript type checking
pnpm lint         # ESLint
pnpm format       # Prettier formatting
```

---

## Test Coverage

- **62+ unit test files**: Covering all models, graph system, diff system, taste system, IO, agent infrastructure, and 8 agents
- **12 E2E test files** (Playwright): Covering all 9 tabs' core interaction flows
- **Integration tests**: Note-to-export, mixer render chain, graph-to-diff, form orchestration, agent tool chain
- **Performance and stability test suites**

---

## Iteration Plan

Current version: v0.6.0 (UI) / v0.1.0 (packages)

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 (PoC) | Graph + Diff + Agent | 100% |
| Phase 1 (MVP) | Arrangement + PianoRoll + Score + Mixer + Taste + Export | 99% |
| Phase 2 (Usability) | Engraving + A/B + Overlay + Performance | 95% |
| Phase 3 (Plugins) | VST3 + Sandbox | 25% |
| Phase 4 (Ecosystem) | CLAP + Market + SDK | 0% |

---

## Project Structure

```
Collinx/
├── .github/workflows/       CI pipeline
├── .playwright-mcp/         Playwright MCP logs
├── docs/
│   ├── CONTEXT.md           Terminology and concept definitions
│   ├── ITERATION-PLAN.md    Iteration plan
│   ├── deep-research-report.md
│   ├── audio/               Audio research documents
│   ├── bayesian-history/    Bayesian planning history
│   └── ui/                  UI development docs
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── schema/      Zod graph schema definitions
│   │       ├── graph/       ProjectGraph + RevisionStore
│   │       ├── model/       16 domain models
│   │       ├── diff/        DiffEnvelope + DiffEngine + DiffLog
│   │       ├── taste/       Taste Genome system (12 modules)
│   │       ├── agent/       ToolRegistry + AgentBus
│   │       ├── io/          MIDI/MusicXML/PDF/WAV/.agentmusic
│   │       └── util/        Utility functions
│   ├── agent/
│   │   └── src/
│   │       ├── planner.ts       Task planning
│   │       ├── composer.ts      Melody/harmony generation
│   │       ├── arranger/        Arrangement (variants, motif transforms, energy curves)
│   │       ├── orchestrator/    Orchestration (voicing, conflict detection)
│   │       ├── engraving/       Notation (layout, collision, parts)
│   │       ├── mixing/          Mix suggestions
│   │       ├── teaching/        Teaching explanations
│   │       ├── taste-memory/    Aesthetic memory
│   │       └── tools.ts         Tool registration
│   ├── ui/
│   │   ├── e2e/             Playwright E2E tests
│   │   └── src/
│   │       ├── components/  15 component directories
│   │       ├── contexts/    React Contexts
│   │       ├── hooks/       Custom hooks
│   │       ├── i18n/        Internationalization
│   │       ├── styles/      Design tokens + themes
│   │       └── data/        Demo data
│   └── audio/
│       └── src/             C++20/JUCE audio engine
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## License

Private — not publicly released.
