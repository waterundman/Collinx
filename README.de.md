<p align="center">
  <img src="icon.png" alt="Collinx" width="96" />
</p>

<h1 align="center">Collinx</h1>

<p align="center">
  <strong>Agent-native Musik-IDE</strong><br/>
  <sub>Ziele / Objekte / Ansichten / Renders / Geschmacksgedächtnis — Ein Graph</sub>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a>
</p>

---

Collinx klickt nicht für dich. Es verwandelt dein Musikprojekt in einen typisierten Eigenschaftsgraphen und lässt 8 spezialisierte Agenten direkt darauf operieren — komponieren, arrangeren, orchestrieren, mischen, notieren, lehren und deinen Geschmack lernen. Jede Operation erzeugt ein strukturiertes DiffEnvelope. Du genehmigst es, es landet auf Main. Nicht gewünscht? Rollback.

Das ist kein Chatbot-Wrapper um eine DAW. Agenten haben Tool-Berechtigungen, Operations-Audits und Domänerklärungen. Was sie tun — du kannst es prüfen, nachverfolgen und ihnen beibringen, es besser zu machen.

---

## So funktioniert es

```
┌─────────────────────────────────────────────────────────┐
│                     Project Graph                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │Composition│  │ Notation │  │Performance│  │  Audio  │ │
│  │  Layer    │→│  Layer   │→│   Layer   │→│  Layer  │ │
│  │Was wurde  │  │Wie es    │  │Wie es     │  │Wie es   │ │
│  │geschrieben│  │aussieht  │  │gespielt   │  │klingt   │ │
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
   (Vorschlag → Genehmigung → Write) (Bayes'sches Geschmacksgedächtnis)
```

**Project Graph** — 13 Knotentypen, 10 Kantentypen, Versionskontrolle und Zweigverwaltung. Alle Musikdaten leben hier: Noten, Akkorde, Form, Tracks, Effekte, Partituren, ästhetische Evidenz.

**DiffEnvelope** — Das Ausgabeformat jeder Agentenoperation. Enthält Zusammenfassung, Domänerklärungen, Evidenzreferenzen, Risikoflaggen und ein Rollback-Token. Standardberechtigung: `proposal_only` — Agenten schlagen vor, du entscheidest.

**Taste Genome** — Dein ästhetisches Gedächtnis über drei Ebenen: Erklärbar (menschenlesbare Parameter), Verteilung (Beta / Dirichlet / Bernoulli), Einbettung (Tag-Vektoren). Deckt 8 Domänen ab: Harmonie, Melodie, Rhythmus, Textur, Timbre, Form, Mix, Ablehnung. Je mehr du es nutzt, desto besser verstehen dich die Agenten.

---

## 8 Agenten

| | Agent | Was er tut |
|---|---|---|
| 1 | **Planner** | Zerlegt "schreib einen Refrain" in einen Taskgraphen, ordnet Tools zu |
| 2 | **Composer** | Generiert Melodien und Harmonien — 13 Skalen, 6 Stile, 8 Rhythmusvorlagen |
| 3 | **Arranger** | Motiv → vollständiges Arrangement. Formstruktur, Energiekurven, Variantengenerierung |
| 4 | **Orchestrator** | Instrumentierung — 30+ Instrumente, 7 Familien, Registerkonflikterkennung, Spielbarkeitsvalidierung |
| 5 | **Engraving** | Partitur-Layout, Kollisionserkennung, Stimmenextraktion (4 Hausstile) |
| 6 | **Mixing** | Gain-Struktur, FX-Ketten, Panning — regelbasiert, keine Blackbox |
| 7 | **Teaching** | Erklärt jede musikalische Entscheidung auf 4 Schwierigkeitsstufen |
| 8 | **Taste Memory** | Analysiert Exporte, sammelt ästhetische Evidenz, rankt Kandidaten nach Geschmack |

Jede Agentenoperation ist ein DiffEnvelope — prüfen, annehmen, ablehnen oder rollback.

---

## UI — 9 Tabs

| Tab | Was er tut |
|---|---|
| **compose** | Piano-Roll + kompakte Partitur + Arrangement-Zeitleiste |
| **arrange** | Abschnittsarrangement + Diff-Vorschau |
| **orchestrate** | Instrumentenzuweisung + Konfliktanzeige |
| **mixer** | Vollständiges Mischpult — Gain, Pan, Mute, Solo, FX-Ketten |
| **score** | Vollständige Partitur — Auto-Layout, Stimmenextraktion, MusicXML-Export |
| **taste** | Taste-Genom-Zeitleiste + Parameter-Bibliothek + Diff-Berichte |
| **teaching** | Musiktheorie-Erklärungen auf mehreren Ebenen |
| **agent** | Diff-Warteschlange + Chat-Schnittstelle |
| **graph** | Projektgraph-Visualisierung — Canvas 2D kraftgerichtetes Layout |

---

## Schnellstart

```bash
# Voraussetzungen: Node.js >= 18, pnpm 9

pnpm install          # Abhängigkeiten installieren
pnpm dev              # Alle Dev-Server starten
pnpm dev:ui           # Nur UI starten (Port 5180)
pnpm build            # Alle Pakete bauen
pnpm test             # Unit-Tests (Vitest)
pnpm test:e2e         # E2E-Tests (Playwright, 90 Fälle)
pnpm typecheck        # Typprüfung
```

---

## Tests

```
144 Unit-Test-Dateien   core 51 / agent 19 / ui 74 — Modelle, Graph, Diff, Taste, IO, Agenten
21  E2E-Spec-Dateien    90 Fälle über alle 9 Tabs' Kerninteraktionen
5   Integrationstests   Note→Export, Mischkette, Graph→Diff, Form, Agenten-Tools
2   Suiten              Leistung + Stabilität
```

---

## Tech-Stack

```
TypeScript · React 18 · Vite 5 · pnpm 9 · Turborepo 2
Zod · pdfkit · fflate · VexFlow 5 · i18next
Vitest · Playwright · JUCE 8 (C++20)
```

---

## Projektstruktur

```
Collinx/
├── packages/
│   ├── core/          Domänenmodelle, Graph, Diff, Taste, IO, Tool-Registry
│   ├── agent/         8 Agenten + 17 Tools
│   ├── ui/            React-Frontend + 21 Komponenten + E2E-Tests
│   ├── desktop/       Electron-Shell + native Engine-Bridge (N-API / Ringpuffer / AudioWorklet)
│   ├── audio-engine/  Engine-Vertrag (nur Typen, noch nicht angebunden)
│   └── audio/         C++20/JUCE Audio-Engine (VST3/CLAP, nur Desktop)
├── docs/              Architektur (architecture.md ist maßgeblich), Glossar, Versionshistorie
└── .github/           CI-Pipeline
```

---

## Roadmap

| Phase | Inhalt | Status |
|---|---|---|
| Phase 0 — PoC | Graph + Diff + Agent | Done |
| Phase 1 — MVP | Arrangement + Piano-Roll + Partitur + Mischpult + Taste + Export | 99% |
| Phase 2 — Benutzbarkeit | Gravur + A/B + Overlay + Leistung | 95% |
| Phase 3 — Plugins | VST3 + Sandbox | Scan an echte Verzeichnisse angebunden; Laden wartet auf nativen Host |
| Phase 4 — Ökosystem | CLAP + Markt + SDK | — |

---

<p align="center">
  <sub>Privat — nicht öffentlich veröffentlicht</sub>
</p>
