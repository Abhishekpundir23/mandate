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
