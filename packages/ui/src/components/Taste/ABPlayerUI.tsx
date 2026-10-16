import React, { useState, useCallback, useEffect, useMemo } from "react";
import { ABPlayer, ABVersion, ABTrial, ABTestResult } from "@collinx/core";
import type { TempoMap } from "@collinx/core";
import styles from "./ABPlayer.module.css";

interface ABPlayerUIProps {
  player: ABPlayer;
  versionA: ABVersion;
  versionB: ABVersion;
  onTestComplete?: (result: ABTestResult) => void;
  tempoMap: TempoMap;
}

type ListeningPhase = "first" | "second" | "vote";

export const ABPlayerUI: React.FC<ABPlayerUIProps> = ({
  player,
  versionA,
  versionB,
  onTestComplete,
  tempoMap,
}) => {
  const [isBlind, setIsBlind] = useState(true);
  const [matchedLoudness, setMatchedLoudness] = useState(true);
  const [loopStart, setLoopStart] = useState(1);
  const [loopEnd, setLoopEnd] = useState(8);
  const [currentTrialIdx, setCurrentTrialIdx] = useState(0);
  const [phase, setPhase] = useState<ListeningPhase>("first");
  const [activeVersion, setActiveVersion] = useState<"A" | "B" | null>(null);
  const [result, setResult] = useState<ABTestResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [trials, setTrials] = useState<ABTrial[]>([]);
  const [testStarted, setTestStarted] = useState(false);

  const maxBar = useMemo(() => Math.max(16, tempoMap.getBarsDuration() || 16), [tempoMap]);

  const currentTrial = trials[currentTrialIdx] ?? null;

  const startTest = useCallback(() => {
    const r = player.createTest(versionA, versionB, {
      mode: isBlind ? "blind" : "labeled",
      loopRange: { startBar: loopStart, endBar: loopEnd },
      matchedLoudness,
      numTrials: 5,
    });
    setTrials(r.trials);
    setCurrentTrialIdx(0);
    setPhase("first");
    setResult(null);
    setShowResult(false);
    setTestStarted(true);
  }, [player, versionA, versionB, isBlind, loopStart, loopEnd, matchedLoudness]);

  const getVersionLabel = useCallback(
    (trial: ABTrial | null, which: "first" | "second"): string => {
      if (!trial) return "?";
      if (!isBlind) {
        const label = trial.playedOrder[which === "first" ? 0 : 1];
        return label;
      }
      return which === "first" ? "版本1" : "版本2";
    },
    [isBlind]
  );

  const getVisibleVersion = useCallback(
    (trial: ABTrial | null, which: "first" | "second"): ABVersion | null => {
      if (!trial) return null;
      return player.getCurrentVersion(trial, which);
    },
    [player]
  );

  const handlePlayVersion = useCallback(
    (which: "first" | "second") => {
      setActiveVersion(which === "first" ? "A" : "B");
    },
    []
  );

  const handleSwitchToSecond = useCallback(() => {
    setPhase("second");
    setActiveVersion("B");
  }, []);

  const handleVote = useCallback(
    (choice: "A" | "B" | "no_preference") => {
      if (!currentTrial) return;

      player.vote(currentTrial.trialId, choice);
      setActiveVersion(null);

      if (currentTrialIdx + 1 >= trials.length) {
        const finalResult = player.getResult();
        setResult(finalResult);
        setShowResult(true);
        onTestComplete?.(finalResult);
      } else {
        setCurrentTrialIdx((idx) => idx + 1);
        setPhase("first");
      }
    },
    [player, currentTrial, currentTrialIdx, trials.length, onTestComplete]
  );

  const handleRelisten = useCallback(() => {
    setPhase("first");
    setActiveVersion(null);
  }, []);

  const toggleBlind = useCallback(() => {
    setIsBlind((b) => !b);
    if (testStarted) {
      startTest();
    }
  }, [testStarted, startTest]);

  const currentFirstVersion = getVisibleVersion(currentTrial, "first");
  const currentSecondVersion = getVisibleVersion(currentTrial, "second");

  return (
    <div className={styles.abPlayer}>
      <div className={styles.header}>
        <h2>A/B 试听对比</h2>
      </div>

      <div className={styles.versionCards}>
        <div
          className={`${styles.versionCard} ${activeVersion === "A" ? styles.active : ""}`}
          onClick={() => handlePlayVersion("first")}
        >
          <div className={styles.versionLabel}>
            {getVersionLabel(currentTrial, "first")}
          </div>
          <div className={styles.versionDescription}>
            {currentFirstVersion?.description ?? versionA.description}
          </div>
        </div>

        <div
          className={`${styles.versionCard} ${activeVersion === "B" ? styles.active : ""}`}
          onClick={() => handlePlayVersion("second")}
        >
          <div className={styles.versionLabel}>
            {getVersionLabel(currentTrial, "second")}
          </div>
          <div className={styles.versionDescription}>
            {currentSecondVersion?.description ?? versionB.description}
          </div>
        </div>
      </div>

      <div className={styles.loopSection}>
        <label>循环范围 (小节)</label>
        <div className={styles.loopSlider}>
          <span>{loopStart}</span>
          <input
            type="range"
            min={1}
            max={Math.max(2, loopEnd - 1)}
            value={loopStart}
            onChange={(e) => setLoopStart(Math.min(Number(e.target.value), loopEnd - 1))}
          />
          <input
            type="range"
            min={Math.min(loopStart + 1, maxBar)}
            max={maxBar}
            value={loopEnd}
            onChange={(e) => setLoopEnd(Math.max(Number(e.target.value), loopStart + 1))}
          />
          <span>{loopEnd}</span>
        </div>
      </div>

      <div className={styles.controls}>
        {!testStarted ? (
          <button onClick={startTest}>开始测试</button>
        ) : (
          <>
            <button
              className={phase === "first" ? styles.activeControl : ""}
              onClick={() => {
                setPhase("first");
                handlePlayVersion("first");
              }}
            >
              {getVersionLabel(currentTrial, "first")}
            </button>
            <button
              className={phase === "second" ? styles.activeControl : ""}
              onClick={() => {
                setPhase("second");
                handlePlayVersion("second");
              }}
            >
              {getVersionLabel(currentTrial, "second")}
            </button>
            {phase === "first" && (
              <button onClick={handleSwitchToSecond}>切换到 {getVersionLabel(currentTrial, "second")}</button>
            )}
          </>
        )}
      </div>

      <div className={styles.toggleRow}>
        <label className={styles.blindToggle}>
          <input type="checkbox" checked={isBlind} onChange={toggleBlind} />
          盲测模式
        </label>
        <label className={styles.loudnessToggle}>
          <input
            type="checkbox"
            checked={matchedLoudness}
            onChange={(e) => setMatchedLoudness(e.target.checked)}
          />
          匹配响度
        </label>
      </div>

      {testStarted && phase === "vote" && (
        <div className={styles.voteButtons}>
          <button
            className={`${styles.voteButton} ${styles.voteButtonA}`}
            onClick={() => handleVote("A")}
          >
            选 {getVersionLabel(currentTrial, "first")}
          </button>
          <button
            className={`${styles.voteButton} ${styles.voteButtonB}`}
            onClick={() => handleVote("B")}
          >
            选 {getVersionLabel(currentTrial, "second")}
          </button>
          <button
            className={`${styles.voteButton} ${styles.voteButtonNeutral}`}
            onClick={() => handleVote("no_preference")}
          >
            无偏好
          </button>
          <button className={styles.relistenButton} onClick={handleRelisten}>
            重听
          </button>
        </div>
      )}

      {testStarted && (
        <div className={styles.progress}>
          第 <span>{currentTrialIdx + 1}</span> / <span>{trials.length}</span> 轮
        </div>
      )}

      {showResult && result && (
        <div className={styles.resultOverlay} onClick={() => setShowResult(false)}>
          <div className={styles.resultPanel} onClick={(e) => e.stopPropagation()}>
            <h3>测试结果</h3>
            <div className={styles.resultStats}>
              <div className={styles.resultStat}>
                <div className={`${styles.resultStatValue} ${styles.winA}`}>
                  {result.summary.versionAWins}
                </div>
                <div className={styles.resultStatLabel}>
                  {isBlind ? "版本1 胜" : "A 胜"}
                </div>
              </div>
              <div className={styles.resultStat}>
                <div className={`${styles.resultStatValue} ${styles.winB}`}>
                  {result.summary.versionBWins}
                </div>
                <div className={styles.resultStatLabel}>
                  {isBlind ? "版本2 胜" : "B 胜"}
                </div>
              </div>
              <div className={styles.resultStat}>
                <div className={`${styles.resultStatValue} ${styles.neutral}`}>
                  {result.summary.noPreference}
                </div>
                <div className={styles.resultStatLabel}>无偏好</div>
              </div>
            </div>

            <div className={styles.confidenceBar}>
              <div
                className={styles.confidenceFill}
                style={{ width: `${(result.summary.confidence * 100).toFixed(0)}%` }}
              />
            </div>
            <div className={styles.confidenceLabel}>
              置信度 {(result.summary.confidence * 100).toFixed(0)}%
            </div>

            <button
              className={styles.resultDismiss}
              onClick={() => setShowResult(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
