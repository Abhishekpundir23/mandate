import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelReplayTimer,
  mediaQueryMatches,
  mountApplication,
  scheduleReplayTick,
  subscribeMediaQuery,
  useAccessibleFocusRegistry,
  useAccessibleScrollTarget,
} from './browser-capabilities';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('browser capability facade', () => {
  it('mounts only into the product root and keeps the host handle private', () => {
    expect(() => mountApplication(<span>missing</span>)).toThrow(/root element is missing/i);
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    act(() => mountApplication(<span>Mounted safely</span>));

    expect(screen.getByText('Mounted safely')).toBeInTheDocument();
  });

  it('reads and subscribes to an approved query without exposing MediaQueryList', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener,
      removeEventListener,
    });
    vi.stubGlobal('matchMedia', matchMedia);
    const listener = vi.fn();

    expect(mediaQueryMatches('(min-width: 1200px)')).toBe(true);
    const unsubscribe = subscribeMediaQuery('(min-width: 1200px)', listener);
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    const change = addEventListener.mock.calls[0]![1] as (event: { matches: boolean }) => void;
    change({ matches: false });
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith('change', change);
  });

  it('schedules and cancels only the fixed replay interval', () => {
    vi.useFakeTimers();
    const tick = vi.fn();

    const timer = scheduleReplayTick(tick);
    vi.advanceTimersByTime(360);
    expect(tick).toHaveBeenCalledTimes(2);
    cancelReplayTimer(timer);
    vi.advanceTimersByTime(180);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('provides opaque focus and compact-scroll operations', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

    function Harness() {
      const focus = useAccessibleFocusRegistry();
      const scroll = useAccessibleScrollTarget();
      return (
        <>
          <button type="button" ref={focus.refFor('destination')}>Destination</button>
          <button type="button" onClick={() => focus.focus('destination')}>Focus</button>
          <section ref={scroll.targetRef}>Inspector</section>
          <button type="button" onClick={scroll.scrollOnCompactViewport}>Scroll</button>
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Destination' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Scroll' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
