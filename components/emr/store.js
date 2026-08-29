"use client";

/**
 * The workspace's single source of truth. Mirrors the pre-React controller's
 * persistence discipline exactly: optimistic-revision saves against
 * localStorage, a busy gate so two writes never interleave, demo charts that
 * are never persisted, and claim-review reconciliation on every mutation.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDemoEmrState,
  initializeEmrState,
  reconcileClaimReviews,
  saveEmrState,
} from "../../src/emr-model.js";
import { claimEvaluationsForState } from "../../lib/emr/selectors.js";

export function useEmrStore() {
  const [state, setState] = useState(null);
  const [savedState, setSavedState] = useState(null);
  const [status, setStatusState] = useState({ message: "", tone: "" });
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await initializeEmrState();
      if (cancelled) return;
      const demoRequested = new URL(window.location.href).searchParams.get("demo") === "1";
      const empty = !loaded.patients.length && !loaded.storageError && !loaded.recoveryRaw;
      // A first visit lands on the sample chart: every patient here is synthetic
      // and an empty list teaches nothing. A stored chart always wins.
      const next = demoRequested || empty ? createDemoEmrState() : loaded;
      setSavedState(loaded);
      setState(next);
      if (!next.demo && next.storageError) {
        setStatusState({
          message: "로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.",
          tone: "error",
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setStatus = useCallback((message, tone = "") => {
    setStatusState({ message, tone });
  }, []);

  const withTransition = useCallback(async (operation) => {
    if (busyRef.current) throw new Error("다른 로컬 저장 작업이 진행 중입니다. 완료 후 다시 시도하세요.");
    busyRef.current = true;
    setBusy(true);
    try {
      return await operation();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * replaceState swaps the whole state (select patient, demo load, restore),
   * applyMutation funnels a chart edit through claim-review reconciliation and
   * the optimistic save. Both refuse to run over a concurrent transition.
   */
  const replaceState = useCallback(async (producer, { persist = true, message = "", tone = "success" } = {}) => {
    return withTransition(async () => {
      const current = stateRef.current;
      const expectedRevision = current.revision;
      const expectedGeneration = generationRef.current;
      const candidate = await producer(current);
      if (candidate === null || candidate === undefined) return null;
      if (!persist || candidate.demo) {
        setState(candidate);
      } else {
        const saved = await saveEmrState(candidate, undefined, expectedRevision);
        if (generationRef.current !== expectedGeneration) {
          throw new Error("다른 탭 또는 창에서 기록이 바뀌어 이 작업을 적용하지 않았습니다.");
        }
        setState(saved);
        setSavedState(saved);
      }
      if (message) setStatusState({ message, tone });
      return candidate;
    });
  }, [withTransition]);

  const applyMutation = useCallback(async (mutator, message, { announce = true } = {}) => {
    return withTransition(async () => {
      const current = stateRef.current;
      const wasDemo = current.demo;
      const expectedRevision = current.revision;
      const expectedGeneration = generationRef.current;
      if (!wasDemo && current.storageError) {
        throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.");
      }
      const mutated = mutator(current);
      const candidate = reconcileClaimReviews(mutated, claimEvaluationsForState(mutated), new Date().toISOString());
      if (wasDemo) {
        setState({ ...candidate, demo: true });
      } else {
        const saved = await saveEmrState(candidate, undefined, expectedRevision);
        if (generationRef.current !== expectedGeneration) {
          throw new Error("다른 탭 또는 창에서 기록이 바뀌어 이 작업을 적용하지 않았습니다.");
        }
        setState(saved);
        setSavedState(saved);
      }
      if (announce) {
        setStatusState({ message: message + (wasDemo ? " · 예시 환자 변경은 저장되지 않습니다." : ""), tone: "success" });
      }
    });
  }, [withTransition]);

  const bumpGeneration = useCallback(() => { generationRef.current += 1; }, []);

  return {
    state,
    savedState,
    setSavedState,
    status,
    setStatus,
    busy,
    applyMutation,
    replaceState,
    withTransition,
    bumpGeneration,
    ready: state !== null,
  };
}
