import './styles/index.css';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./providers/I18nProvider";
import { SettingsProvider } from "./contexts/SettingsContext";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ProjectProvider } from "./providers/ProjectProvider";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <SettingsProvider>
        <ThemeProvider>
          <ProjectProvider>
            <App />
          </ProjectProvider>
        </ThemeProvider>
      </SettingsProvider>
    </I18nProvider>
  </StrictMode>,
);
