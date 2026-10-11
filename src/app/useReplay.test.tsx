import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReplayFrames } from '../runtime/replay';
import { runComparison } from '../runtime/runner';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import { useReplay } from './useReplay';

function setReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe('useReplay', () => {
  const frames = buildReplayFrames(runComparison(draftIsNotSubmit));

  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts at the empty causal frame without exposing future outcomes', () => {
    const { result } = renderHook(() => useReplay(frames));

    expect(result.current.step).toBe(0);
    expect(result.current.frame).toBe(frames[0]);
    expect(result.current.frame.eventCount).toBe(0);
    expect(result.current.status).toBe('idle');
  });

  it('resets an in-progress replay to the empty frame', () => {
    const { result } = renderHook(() => useReplay(frames));

    act(() => result.current.run());
    act(() => vi.advanceTimersToNextTimer());
    expect(result.current.step).toBe(1);

    act(() => result.current.reset());
    expect(result.current.step).toBe(0);
    expect(result.current.frame.eventCount).toBe(0);
    expect(result.current.status).toBe('idle');
  });

  it('advances every frame in order and finishes on the full trace', () => {
    const { result } = renderHook(() => useReplay(frames));
    const visited = [0];

    act(() => result.current.run());
    while (result.current.status === 'running') {
      act(() => vi.advanceTimersToNextTimer());
      visited.push(result.current.step);
    }

    expect(visited).toEqual(frames.map(({ index }) => index));
    expect(result.current.frame).toBe(frames.at(-1));
    expect(result.current.status).toBe('complete');
  });

  it('keeps a repeated run request on one replay sequence', () => {
    const { result } = renderHook(() => useReplay(frames));

    act(() => {
      result.current.run();
      result.current.run();
    });
    act(() => vi.advanceTimersToNextTimer());

    expect(result.current.step).toBe(1);
    expect(result.current.status).toBe('running');
  });

  it('holds the current milestone while paused and resumes from that milestone', () => {
    const { result } = renderHook(() => useReplay(frames));
    expect(result.current.pause).toBeTypeOf('function');
    act(() => result.current.run());
    act(() => vi.advanceTimersToNextTimer());
    act(() => result.current.pause());

    expect(result.current.status).toBe('paused');
    expect(result.current.step).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.step).toBe(1);

    act(() => result.current.resume());
    act(() => vi.advanceTimersToNextTimer());
    expect(result.current.step).toBe(2);
    expect(result.current.status).toBe('running');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('steps through milestones manually without revealing a completion receipt early', () => {
    const { result } = renderHook(() => useReplay(frames));
    expect(result.current.next).toBeTypeOf('function');

    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.status).toBe('paused');
    expect(result.current.frame.complete).toBe(false);
    expect(result.current.frame.mandate).not.toHaveProperty('receipt');
    expect(vi.getTimerCount()).toBe(0);

    for (let step = 2; step < frames.length; step += 1) {
      act(() => result.current.next());
      expect(result.current.step).toBe(step);
      expect(result.current.frame.complete).toBe(step === frames.length - 1);
    }
    expect(result.current.status).toBe('complete');
    act(() => result.current.next());
    expect(result.current.step).toBe(frames.length - 1);
  });

  it('ignores manual advancement during automatic replay', () => {
    const { result } = renderHook(() => useReplay(frames));
    expect(result.current.next).toBeTypeOf('function');
    act(() => result.current.run());
    act(() => result.current.next());
    expect(result.current.step).toBe(0);
    act(() => vi.advanceTimersToNextTimer());
    expect(result.current.step).toBe(1);
  });

  it('restarts a paused inspection without leaving a timer or future evidence', () => {
    const { result } = renderHook(() => useReplay(frames));
    expect(result.current.next).toBeTypeOf('function');
    act(() => result.current.next());
    act(() => result.current.reset());
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.step).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(result.current.frame.eventCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('respects reduced motion when resuming a manually stepped replay', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useReplay(frames));
    expect(result.current.next).toBeTypeOf('function');
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    act(() => result.current.resume());
    expect(result.current.status).toBe('complete');
    expect(result.current.step).toBe(frames.length - 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('jumps directly to completion when reduced motion is requested', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useReplay(frames));

    act(() => result.current.run());

    expect(result.current.step).toBe(frames.length - 1);
    expect(result.current.frame).toBe(frames.at(-1));
    expect(result.current.status).toBe('complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the old sequence when the scenario frames change', () => {
    const secondFrames = frames.slice(0, 3);
    const { result, rerender } = renderHook(
      ({ replayFrames }) => useReplay(replayFrames),
      { initialProps: { replayFrames: frames } },
    );

    act(() => result.current.run());
    act(() => vi.advanceTimersToNextTimer());
    rerender({ replayFrames: secondFrames });

    expect(result.current.step).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(result.current.frame).toBe(secondFrames[0]);
  });
});
