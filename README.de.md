<p align="center">
  <img src="icon.png" alt="Collinx" width="128" />
</p>

# Collinx

> Eine agent-native Musik-IDE — vereint kreative Ziele, Musikobjekte, Ansichten, Rendering und ästhetisches Gedächtnis in einem einzigen Projektgraphen.

Collinx ist keine traditionelle DAW. Es ist eine auf einem **Projektgraphen** (typisierter Eigenschaftsgraph) aufgebaute Musikproduktionsumgebung, die von 8 spezialisierten **Agenten** betrieben wird, die den Graphen direkt manipulieren, um Komposition, Arrangement, Orchestrierung, Mischung, Notation, Lehre und ästhetisches Lernen zu bewältigen. Jede Agentenoperation erzeugt ein strukturiertes **DiffEnvelope**, das erst nach Benutzerbestätigung in den Hauptzweig geschrieben wird, mit vollständiger Audit-, Rollback- und Domänerklärungsunterstützung.

---

## Kernkonzepte

### Projektgraph

Alle Musikdaten (Noten, Akkorde, Form, Tracks, Effekte, Partitur, ästhetische Evidenz) existieren in einem einzigen typisierten Eigenschaftsgraphen. Knotentypen umfassen `CompositionUnit`, `Phrase`, `Motif`, `Track`, `Player`, `PartLayout`, `NoteSpan`, `AutomationCurve`, `AudioBus`, `RenderArtifact`, `TasteEvidence` und `ExportVersion`. Kantentypen umfassen `contains`, `realizes`, `notates`, `performed_as`, `routed_to`, `rendered_to`, `derived_from`, `suggested_by_agent`, `confirmed_by_user` und `updates_taste`. Vollständige Versionskontrolle und Zweigverwaltung werden unterstützt.

### DiffEnvelope

Das Ausgabeformat aller Agentenoperationen. Enthält Operationssummary, Domänerklärungen, Evidenzreferenzen, Risikoflaggen und ein Rollback-Token. Der Standardberechtigungsbereich ist `proposal_only` — Agenten können nur vorschlagen; Änderungen werden erst nach Benutzerbestätigung in den Hauptgraphen geschrieben.

### Taste Genome

Ein langfristiges Gedächtnismodell für Benutzerästhetik über drei Ebenen:
- **Erklärbare Ebene**: Menschenlesbare Parameter (z.B. `harmony.chromatic_color = 0.33`)
- **Verteilungsebene**: Bayes'sche Verteilungen (Beta, Dirichlet, Bernoulli, Gaussian)
- **Einbettungsebene**: Tag-basierte Einbettungsvektoren

Deckt 8 ästhetische Domänen ab: Harmonie, Melodie, Rhythmus, Textur, Timbre, Form, Mix, Ablehnung.

### Vier-Schicht-Musik-Pipeline

| Schicht | Inhalt |
|---------|--------|
| Composition Layer | Was geschrieben wurde — Noten, Akkorde, Rhythmus, Form |
| Notation Layer | Wie es aussieht — Partitur, Layout, Stimmen |
| Performance Layer | Wie es gespielt wird — Tempokurven, Dynamik, Ausdruck |
| Audio Layer | Wie es klingt — Mischung, Effekte, Export |

---

## Architektur

```
Collinx/
├── packages/
│   ├── core/        @collinx/core       Domänenmodelle, Graph, Diff, Taste, IO
│   ├── agent/       @collinx/agent      8 spezialisierte Agenten
│   ├── ui/          @collinx/ui         React + Vite Frontend (9 Tabs)
│   └── audio/       collinx-audio-engine  C++20/JUCE Audio-Engine
├── docs/            Dokumentation
└── .github/         CI-Pipeline
```

**Tech-Stack**: TypeScript, React 18, Vite 5, pnpm 9 + Turborepo 2, Zod, pdfkit, fflate, VexFlow 5, i18next, Vitest, Playwright, JUCE 8 (C++20)

---

## Pakete

### @collinx/core

Kern-Domänenschicht mit:
- **Modelle** (16 Module): NoteEvent, TempoMap, HarmonyPlan, Motif, Phrase, Section, FormRole, FormTemplate, EnergyCurve, Instrument, MixerState, FXChain, DSP-Effekte, ScoreModel, EngravingEngine, StemRenderer
- **Graphsystem**: ProjectGraph (CRUD, Traversal, Validierung, Serialisierung), RevisionStore (Commit, Checkpoint, Restore)
- **Diff-System**: DiffEnvelope, DiffEngine (Anwendung, Rollback, Validierung, Merge, Konflikterkennung), DiffLog
- **Taste-System** (12 Module): TasteGenome, TasteStore, EvidenceExtractor, ExportAnalyzer, UpdateEngine, ScoringEngine, ReportGenerator, TentativeBuffer, ProjectOverlay, ABPlayer
- **IO**: MIDI-Import/Export, MusicXML 4.0, PDF-Partitur, WAV-Audio, `.agentmusic`-Containerformat
- **Agenteninfrastruktur**: ToolRegistry (14 integrierte Tools), AgentBus (Punkt-zu-Punkt, Request/Response, Pub/Sub)

### @collinx/agent

8 spezialisierte Agenten:

| Agent | Verantwortung |
|-------|--------------|
| **Planner** | Zerlegt natürlichsprachliche Ziele in Taskgraphen, ordnet Schlüsselwörtern Tools zu |
| **Composer** | Generiert Melodien und Harmonien (13 Skalen, 6 Stilvorlagen, 8 Rhythmusvorlagen) |
| **Arranger** | Erweitert Motive zu vollständigen Arrangements, entwirf Formstrukturen und Energiekurven |
| **Orchestrator** | Instrumentierung, Stimmzuweisung, Registerkonflikt-Erkennung, Spielbarkeitsvalidierung (30+ Instrumente, 7 Familien) |
| **EngravingAgent** | Partitur-Layout, Kollisionserkennung, Stimmenextraktion (4 Hausstile) |
| **MixingAgent** |schlägt Gain-Struktur, FX-Ketten, Stereo-Panning vor |
| **TeachingAgent** | Erklärt musikalische Entscheidungen auf 4 Schwierigkeitsstufen (Anfänger/Fortgeschritten/Experte/Profi) |
| **TasteMemoryAgent** | Analysiert Exporte, bestätigt/verwirft ästhetische Evidenz, rollt Genom zurück, rankt Kandidaten nach Geschmack |

### @collinx/ui

React 18 + Vite 5 Frontend mit 9 Tabs:

| Tab | Komponenten | Funktion |
|-----|------------|----------|
| **compose** | PianoRollView, ScorePanel, ArrangementView | Piano-Roll-Bearbeitung + kompakte Partitur + Arrangement-Zeitleiste |
| **arrange** | ArrangementView, ArrangerPanel | Abschnittsarrangement + Diff-Vorschau |
| **orchestrate** | ArrangementView, OrchestratorPanel | Instrumentenzuweisung + Konfliktanzeige |
| **mixer** | MixerConsole | Vollständiges Mischpult (Gain, Pan, Mute, Solo, FX-Ketten) |
| **score** | ScorePanel | Vollständige Partitur (Auto-Layout, Stimmenextraktion, MusicXML-Export) |
| **taste** | TasteTimelineView, TasteLibraryPanel, TasteDiffPanel | Taste-Genom-Zeitleiste + Parameter-Bibliothek + Diff-Berichte |
| **teaching** | TeachingPanel | Musiktheorie-Erklärungen auf mehreren Ebenen |
| **agent** | AgentPanel, AgentChat | Diff-Warteschlange + Chat-Schnittstelle |
| **graph** | GraphView, NodeDetail | Projektgraph-Visualisierung (Canvas 2D, Kraftgerichtetes Layout) |

### collinx-audio-engine

C++20 Audio-Engine (JUCE 8.0.1):
- VST3- und CLAP-Plugin-Hosting mit sandboxed Crash-Erkennung
- Integrierter Wavetable-Synthesizer
- DSP: Parallele Verarbeitung, Latenzkompensation
- MIDI-Effektketten und Routing
- Preset-Verwaltung
- Asynchrone Plugin-Suche
- Leistungsüberwachung und Profiling
- Automatisierungskurven

---

## Schnellstart

### Voraussetzungen

- Node.js >= 18
- pnpm 9.0.0
- CMake 3.22+ (Audio-Engine)
- C++20-Compiler (Audio-Engine)

### Installation

```bash
pnpm install
```

### Entwicklung

```bash
pnpm dev          # Alle Dev-Server starten
pnpm dev:ui       # Nur UI starten (Port 5180)
```

### Build

```bash
pnpm build        # Alle Pakete über Turborepo bauen
```

### Test

```bash
pnpm test         # Alle Tests ausführen (Vitest Unit-Tests)
pnpm test:core    # Nur Core-Paket-Tests
pnpm test:agent   # Nur Agent-Paket-Tests
pnpm test:e2e     # Playwright E2E-Tests (84 Testfälle)
```

### Sonstiges

```bash
pnpm typecheck    # TypeScript-Typprüfung
pnpm lint         # ESLint
pnpm format       # Prettier-Formatierung
```

---

## Testabdeckung

- **62+ Unit-Test-Dateien**: Abdeckung aller Modelle, Graphsystem, Diff-System, Taste-System, IO, Agenteninfrastruktur und 8 Agenten
- **12 E2E-Test-Dateien** (Playwright): Abdeckung aller 9 Tabs' Kerninteraktionsabläufe
- **Integrationstests**: Note-zu-Export, Mischpult-Renderkette, Graph-zu-Diff, Formorchestrierung, Agenten-Toolkette
- **Leistungs- und Stabilitätstest-Suiten

---

## Iterationsplan

Aktuelle Version: v0.6.0 (UI) / v0.1.0 (Pakete)

| Phase | Beschreibung | Status |
|-------|-------------|--------|
| Phase 0 (PoC) | Graph + Diff + Agent | 100% |
| Phase 1 (MVP) | Arrangement + PianoRoll + Partitur + Mischpult + Taste + Export | 99% |
| Phase 2 (Benutzbarkeit) | Gravur + A/B + Overlay + Leistung | 95% |
| Phase 3 (Plugins) | VST3 + Sandbox | 25% |
| Phase 4 (Ökosystem) | CLAP + Markt + SDK | 0% |

---

## Projektstruktur

```
Collinx/
├── .github/workflows/       CI-Pipeline
├── .playwright-mcp/         Playwright MCP-Logs
├── docs/
│   ├── CONTEXT.md           Begriffs- und Konzeptdefinitionen
│   ├── ITERATION-PLAN.md    Iterationsplan
│   ├── deep-research-report.md
│   ├── audio/               Audio-Forschungsdokumente
│   ├── bayesian-history/    Bayes'sche Planungshistorie
│   └── ui/                  UI-Entwicklungsdokumentation
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── schema/      Zod-Graphschema-Definitionen
│   │       ├── graph/       ProjectGraph + RevisionStore
│   │       ├── model/       16 Domänenmodelle
│   │       ├── diff/        DiffEnvelope + DiffEngine + DiffLog
│   │       ├── taste/       Taste-Genom-System (12 Module)
│   │       ├── agent/       ToolRegistry + AgentBus
│   │       ├── io/          MIDI/MusicXML/PDF/WAV/.agentmusic
│   │       └── util/        Hilfsfunktionen
│   ├── agent/
│   │   └── src/
│   │       ├── planner.ts       Aufgabenplanung
│   │       ├── composer.ts      Melodie-/Harmoniegenerierung
│   │       ├── arranger/        Arrangement (Varianten, Motivtransformationen, Energiekurven)
│   │       ├── orchestrator/    Orchestrierung (Stimmführung, Konflikterkennung)
│   │       ├── engraving/       Notation (Layout, Kollision, Stimmen)
│   │       ├── mixing/          Mischvorschläge
│   │       ├── teaching/        Lehrerklärungen
│   │       ├── taste-memory/    Ästhetisches Gedächtnis
│   │       └── tools.ts         Tool-Registrierung
│   ├── ui/
│   │   ├── e2e/             Playwright E2E-Tests
│   │   └── src/
│   │       ├── components/  15 Komponentenverzeichnisse
│   │       ├── contexts/    React Contexts
│   │       ├── hooks/       Benutzerdefinierte Hooks
│   │       ├── i18n/        Internationalisierung
│   │       ├── styles/      Design-Token + Themes
│   │       └── data/        Demodaten
│   └── audio/
│       └── src/             C++20/JUCE Audio-Engine
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## Lizenz

Privat — nicht öffentlich veröffentlicht.
