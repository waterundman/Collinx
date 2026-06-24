import React, { useState, useCallback, useMemo } from "react";
import styles from "./ModulationMatrix.module.css";

interface ModulationSource {
  id: string;
  name: string;
  type: "lfo" | "envelope" | "mpe" | "macro" | "velocity" | "modwheel";
  value: number;
}

interface ModulationDestination {
  id: string;
  name: string;
  paramId: number;
}

interface ModulationRoute {
  id: string;
  sourceId: string;
  destinationId: string;
  depth: number;
  bipolar: boolean;
}

interface ModulationMatrixProps {
  sources?: ModulationSource[];
  destinations?: ModulationDestination[];
  routes?: ModulationRoute[];
  onRouteChange?: (route: ModulationRoute) => void;
  onRouteAdd?: (route: ModulationRoute) => void;
  onRouteRemove?: (routeId: string) => void;
  onSourceSelect?: (sourceId: string) => void;
  onDestinationSelect?: (destinationId: string) => void;
}

const defaultSources: ModulationSource[] = [
  { id: "lfo1", name: "LFO 1", type: "lfo", value: 0 },
  { id: "lfo2", name: "LFO 2", type: "lfo", value: 0 },
  { id: "env1", name: "Envelope 1", type: "envelope", value: 0 },
  { id: "env2", name: "Envelope 2", type: "envelope", value: 0 },
  { id: "mpe-pressure", name: "MPE Pressure", type: "mpe", value: 0 },
  { id: "mpe-slide", name: "MPE Slide", type: "mpe", value: 0 },
  { id: "macro1", name: "Macro 1", type: "macro", value: 0 },
  { id: "velocity", name: "Velocity", type: "velocity", value: 0 },
  { id: "modwheel", name: "Mod Wheel", type: "modwheel", value: 0 },
];

const defaultDestinations: ModulationDestination[] = [
  { id: "pitch", name: "Pitch", paramId: 0 },
  { id: "filter-cutoff", name: "Filter Cutoff", paramId: 1 },
  { id: "filter-res", name: "Filter Resonance", paramId: 2 },
  { id: "volume", name: "Volume", paramId: 3 },
  { id: "pan", name: "Pan", paramId: 4 },
  { id: "attack", name: "Attack", paramId: 5 },
  { id: "decay", name: "Decay", paramId: 6 },
  { id: "sustain", name: "Sustain", paramId: 7 },
  { id: "release", name: "Release", paramId: 8 },
];

export const ModulationMatrix: React.FC<ModulationMatrixProps> = ({
  sources = defaultSources,
  destinations = defaultDestinations,
  routes: initialRoutes = [],
  onRouteChange,
  onRouteAdd,
  onRouteRemove,
  onSourceSelect,
  onDestinationSelect,
}) => {
  const [routes, setRoutes] = useState<ModulationRoute[]>(initialRoutes);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [editingRoute, setEditingRoute] = useState<string | null>(null);

  const handleSourceClick = useCallback(
    (sourceId: string) => {
      setSelectedSource((prev) => (prev === sourceId ? null : sourceId));
      onSourceSelect?.(sourceId);
    },
    [onSourceSelect]
  );

  const handleDestinationClick = useCallback(
    (destId: string) => {
      setSelectedDestination((prev) => (prev === destId ? null : destId));
      onDestinationSelect?.(destId);
    },
    [onDestinationSelect]
  );

  const handleAddRoute = useCallback(() => {
    if (!selectedSource || !selectedDestination) return;

    const existingRoute = routes.find(
      (r) => r.sourceId === selectedSource && r.destinationId === selectedDestination
    );

    if (existingRoute) return;

    const newRoute: ModulationRoute = {
      id: `route-${Date.now()}`,
      sourceId: selectedSource,
      destinationId: selectedDestination,
      depth: 1,
      bipolar: false,
    };

    setRoutes((prev) => [...prev, newRoute]);
    onRouteAdd?.(newRoute);
    setSelectedSource(null);
    setSelectedDestination(null);
  }, [selectedSource, selectedDestination, routes, onRouteAdd]);

  const handleRemoveRoute = useCallback(
    (routeId: string) => {
      setRoutes((prev) => prev.filter((r) => r.id !== routeId));
      onRouteRemove?.(routeId);
    },
    [onRouteRemove]
  );

  const handleDepthChange = useCallback(
    (routeId: string, depth: number) => {
      setRoutes((prev) =>
        prev.map((r) => (r.id === routeId ? { ...r, depth } : r))
      );
      const route = routes.find((r) => r.id === routeId);
      if (route) {
        onRouteChange?.({ ...route, depth });
      }
    },
    [routes, onRouteChange]
  );

  const handleBipolarToggle = useCallback(
    (routeId: string) => {
      setRoutes((prev) =>
        prev.map((r) =>
          r.id === routeId ? { ...r, bipolar: !r.bipolar } : r
        )
      );
      const route = routes.find((r) => r.id === routeId);
      if (route) {
        onRouteChange?.({ ...route, bipolar: !route.bipolar });
      }
    },
    [routes, onRouteChange]
  );

  const getSourceById = useCallback(
    (id: string) => sources.find((s) => s.id === id),
    [sources]
  );

  const getDestinationById = useCallback(
    (id: string) => destinations.find((d) => d.id === id),
    [destinations]
  );

  const sourceTypes = useMemo(() => {
    const types = new Set(sources.map((s) => s.type));
    return Array.from(types);
  }, [sources]);

  return (
    <div className={styles.matrix}>
      <div className={styles.header}>
        <span className={styles.title}>Modulation Matrix</span>
        <button
          className={styles.addRouteBtn}
          onClick={handleAddRoute}
          disabled={!selectedSource || !selectedDestination}
        >
          + Add Route
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.sourcesPanel}>
          <span className={styles.panelTitle}>Sources</span>
          {sourceTypes.map((type) => (
            <div key={type} className={styles.sourceGroup}>
              <span className={styles.sourceGroupTitle}>{type.toUpperCase()}</span>
              {sources
                .filter((s) => s.type === type)
                .map((source) => (
                  <div
                    key={source.id}
                    className={`${styles.sourceItem} ${
                      selectedSource === source.id ? styles.sourceItemSelected : ""
                    }`}
                    onClick={() => handleSourceClick(source.id)}
                  >
                    <span className={styles.sourceIndicator} />
                    <span className={styles.sourceName}>{source.name}</span>
                    <span className={styles.sourceValue}>
                      {source.value.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className={styles.routesPanel}>
          <span className={styles.panelTitle}>Routes</span>
          <div className={styles.routesList}>
            {routes.length === 0 ? (
              <div className={styles.routesEmpty}>
                <span>No modulation routes</span>
              </div>
            ) : (
              routes.map((route) => {
                const source = getSourceById(route.sourceId);
                const destination = getDestinationById(route.destinationId);
                return (
                  <div key={route.id} className={styles.routeItem}>
                    <div className={styles.routeHeader}>
                      <span className={styles.routeSource}>{source?.name ?? "?"}</span>
                      <span className={styles.routeArrow}>→</span>
                      <span className={styles.routeDestination}>
                        {destination?.name ?? "?"}
                      </span>
                      <button
                        className={styles.routeDelete}
                        onClick={() => handleRemoveRoute(route.id)}
                      >
                        ×
                      </button>
                    </div>
                    <div className={styles.routeConfig}>
                      <div className={styles.routeDepthControl}>
                        <span className={styles.routeDepthLabel}>Depth</span>
                        <input
                          type="range"
                          className={styles.routeDepthSlider}
                          min={route.bipolar ? -1 : 0}
                          max={1}
                          step={0.01}
                          value={route.depth}
                          onChange={(e) =>
                            handleDepthChange(route.id, parseFloat(e.target.value))
                          }
                        />
                        <span className={styles.routeDepthValue}>
                          {route.depth.toFixed(2)}
                        </span>
                      </div>
                      <button
                        className={`${styles.routeBipolarBtn} ${
                          route.bipolar ? styles.routeBipolarActive : ""
                        }`}
                        onClick={() => handleBipolarToggle(route.id)}
                      >
                        Bi
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={styles.destinationsPanel}>
          <span className={styles.panelTitle}>Destinations</span>
          {destinations.map((dest) => (
            <div
              key={dest.id}
              className={`${styles.destinationItem} ${
                selectedDestination === dest.id ? styles.destinationItemSelected : ""
              }`}
              onClick={() => handleDestinationClick(dest.id)}
            >
              <span className={styles.destinationName}>{dest.name}</span>
              <span className={styles.destinationParamId}>#{dest.paramId}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          {routes.length} route{routes.length !== 1 ? "s" : ""} •{" "}
          {sources.length} sources • {destinations.length} destinations
        </span>
      </div>
    </div>
  );
};