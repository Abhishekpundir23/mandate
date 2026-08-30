import type { JsonValue } from '../domain/types';
import type { ComparisonRun, RuntimeEvent } from './runner';

export interface ReplayLane {
  readonly events: readonly RuntimeEvent[];
  readonly world: Readonly<Record<string, JsonValue>>;
}
export interface ReplayFrame {
  readonly index: number;
  readonly eventCount: number;
  readonly standard: ReplayLane;
  readonly mandate: ReplayLane;
  readonly complete: boolean;
}

function worldAt(
  events: readonly RuntimeEvent[],
  initialWorld: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return events.at(-1)?.world ?? initialWorld;
}

export function buildReplayFrames(comparison: ComparisonRun): readonly ReplayFrame[] {
  const maximumEvents = Math.max(
    comparison.standard.events.length,
    comparison.mandate.events.length,
  );
  const frames: ReplayFrame[] = [];

  for (let eventCount = 0; eventCount <= maximumEvents; eventCount += 1) {
    const standardEvents = Object.freeze(comparison.standard.events.slice(0, eventCount));
    const mandateEvents = Object.freeze(comparison.mandate.events.slice(0, eventCount));
    frames.push(Object.freeze({
      index: eventCount,
      eventCount,
      standard: Object.freeze({
        events: standardEvents,
        world: worldAt(standardEvents, comparison.standard.initialWorld),
      }),
      mandate: Object.freeze({
        events: mandateEvents,
        world: worldAt(mandateEvents, comparison.mandate.initialWorld),
      }),
      complete: eventCount === maximumEvents,
    }));
  }

  return Object.freeze(frames);
}
