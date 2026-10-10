import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  cancelReplayTimer,
  mediaQueryMatches,
  scheduleReplayTick,
} from '../platform/browser-capabilities';
import type { ReplayFrame } from '../runtime/replay';

export type ReplayStatus = 'idle' | 'running' | 'paused' | 'complete';

interface ReplayState {
  readonly step: number;
  readonly status: ReplayStatus;
}

type ReplayAction =
  | { readonly type: 'RUN'; readonly reducedMotion: boolean; readonly finalStep: number }
  | { readonly type: 'RESET' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'RESUME'; readonly reducedMotion: boolean; readonly finalStep: number }
  | { readonly type: 'STEP'; readonly finalStep: number }
  | { readonly type: 'ADVANCE'; readonly finalStep: number };

function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
  if (action.type === 'RESET') {
    return { step: 0, status: 'idle' };
  }
  if (action.type === 'RUN') {
    if (state.status === 'running') return state;
    return action.reducedMotion
      ? { step: action.finalStep, status: 'complete' }
      : { step: 0, status: action.finalStep === 0 ? 'complete' : 'running' };
  }
  if (action.type === 'PAUSE') {
    return state.status === 'running' ? { ...state, status: 'paused' } : state;
  }
  if (action.type === 'RESUME') {
    if (state.status !== 'paused') return state;
    return action.reducedMotion
      ? { step: action.finalStep, status: 'complete' }
      : { ...state, status: 'running' };
  }
  if (action.type === 'STEP') {
    if (state.status === 'running' || state.status === 'complete') return state;
    const step = Math.min(state.step + 1, action.finalStep);
    return { step, status: step === action.finalStep ? 'complete' : 'paused' };
  }
  if (state.status !== 'running') return state;
  const step = Math.min(state.step + 1, action.finalStep);
  return { step, status: step === action.finalStep ? 'complete' : 'running' };
}

function prefersReducedMotion(): boolean {
  return mediaQueryMatches('(prefers-reduced-motion: reduce)');
}

export interface ReplayController {
  readonly frame: ReplayFrame;
  readonly step: number;
  readonly status: ReplayStatus;
  readonly run: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly next: () => void;
  readonly reset: () => void;
}

export function useReplay(frames: readonly ReplayFrame[]): ReplayController {
  if (frames.length === 0) {
    throw new TypeError('Replay requires at least one frame.');
  }
  const finalStep = frames.length - 1;
  const [state, dispatch] = useReducer(replayReducer, {
    step: 0,
    status: 'idle',
  });
  const previousFrames = useRef(frames);

  useEffect(() => {
    if (previousFrames.current !== frames) {
      previousFrames.current = frames;
      dispatch({ type: 'RESET' });
    }
  }, [frames]);

  useEffect(() => {
    if (state.status !== 'running') return undefined;
    const timer = scheduleReplayTick(() => {
      dispatch({ type: 'ADVANCE', finalStep });
    });
    return () => cancelReplayTimer(timer);
  }, [finalStep, state.status]);

  const run = useCallback(() => {
    dispatch({ type: 'RUN', reducedMotion: prefersReducedMotion(), finalStep });
  }, [finalStep]);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const pause = useCallback(() => dispatch({ type: 'PAUSE' }), []);
  const resume = useCallback(() => {
    dispatch({ type: 'RESUME', reducedMotion: prefersReducedMotion(), finalStep });
  }, [finalStep]);
  const next = useCallback(() => dispatch({ type: 'STEP', finalStep }), [finalStep]);
  const frame = frames[Math.min(state.step, finalStep)]!;

  return { frame, step: state.step, status: state.status, run, pause, resume, next, reset };
}
