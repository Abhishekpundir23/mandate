import { useCallback, useRef, type ReactNode, type RefCallback } from 'react';
import { createRoot } from 'react-dom/client';

export type ApprovedMediaQuery =
  | '(max-width: 899px)'
  | '(min-width: 1200px)'
  | '(prefers-reduced-motion: reduce)';

declare const replayTimerBrand: unique symbol;
export type ReplayTimer = number & { readonly [replayTimerBrand]: true };

function approvedMediaQuery(query: ApprovedMediaQuery): MediaQueryList | undefined {
  if (typeof window.matchMedia !== 'function') return undefined;
  if (query === '(max-width: 899px)') return window.matchMedia('(max-width: 899px)');
  if (query === '(min-width: 1200px)') return window.matchMedia('(min-width: 1200px)');
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

export function mountApplication(application: ReactNode): void {
  const root = document.getElementById('root');
  if (root === null) throw new Error('The MANDATE root element is missing.');
  createRoot(root).render(application);
}

export function mediaQueryMatches(query: ApprovedMediaQuery): boolean {
  return approvedMediaQuery(query)?.matches ?? false;
}

export function subscribeMediaQuery(
  query: ApprovedMediaQuery,
  listener: (matches: boolean) => void,
): () => void {
  const media = approvedMediaQuery(query);
  if (media === undefined) return () => undefined;
  const update = (event: MediaQueryListEvent): void => listener(event.matches);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function scheduleReplayTick(tick: () => void): ReplayTimer {
  return window.setInterval(tick, 180) as ReplayTimer;
}

export function cancelReplayTimer(timer: ReplayTimer): void {
  window.clearInterval(timer);
}

interface AccessibleFocusRegistry {
  readonly refFor: (key: string) => RefCallback<HTMLButtonElement>;
  readonly focus: (key: string) => void;
}

export function useAccessibleFocusRegistry(): AccessibleFocusRegistry {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const refFor = useCallback((key: string): RefCallback<HTMLButtonElement> => (node) => {
    if (node === null) nodes.current.delete(key);
    else nodes.current.set(key, node);
  }, []);
  const focus = useCallback((key: string): void => nodes.current.get(key)?.focus(), []);
  return { refFor, focus };
}

interface AccessibleScrollTarget {
  readonly targetRef: RefCallback<HTMLElement>;
  readonly scrollOnCompactViewport: () => void;
}

export function useAccessibleScrollTarget(): AccessibleScrollTarget {
  const node = useRef<HTMLElement | null>(null);
  const targetRef = useCallback((next: HTMLElement | null): void => {
    node.current = next;
  }, []);
  const scrollOnCompactViewport = useCallback((): void => {
    if (mediaQueryMatches('(max-width: 899px)')) {
      node.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);
  return { targetRef, scrollOnCompactViewport };
}
