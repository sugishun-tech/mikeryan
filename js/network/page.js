import { LIMITS } from '../core/config.js?v=1.3.0';
import { sortEvents } from '../core/utils.js?v=1.3.0';

/** A short EOSE is not proof that the requested interval was exhausted.
 * Probe below it before merging with another relay's older data. Repairs are
 * inclusive at the last second; never step past an unresolved same-second cap.
 * All data here belongs only to the current, explicit query.
 */
export async function readPage(connection, filter) {
  let events = [];
  try {
    events = sortEvents(await connection.query([filter]));
    let exhausted = !events.length, capped = false, blocked = false, repairs = 0;
    const target = filter.limit;
    while (events.length && events.length < target && repairs < LIMITS.pageRepairs) {
      const tail = events.at(-1), low = filter.since ?? 0;
      if (tail.created_at <= low) { exhausted = !capped; break; }
      // Only one older event is needed to disprove exhaustion, regardless of the
      // relay's own result limit. Keep the original authors/kinds/tag constraints.
      const probe = await connection.query([{...filter, until: tail.created_at - 1, limit: 1}]);
      repairs++;
      if (!probe.length) { exhausted = !capped; break; }
      capped = true;
      if (repairs >= LIMITS.pageRepairs) break;
      const prefix = events.filter(e => e.created_at === tail.created_at).length;
      const limit = Math.min(LIMITS.maxPageLimit, Math.max(target, prefix + target));
      const next = await connection.query([{...filter, until: tail.created_at, limit}]);
      repairs++;
      const combined = sortEvents([...events, ...next]);
      // Do not add the probe: it might lie BELOW a same-second hole.
      if (combined.length === events.length) { blocked = true; break; }
      events = combined;
      if (sortEvents(next).at(-1)?.created_at < tail.created_at) capped = false;
    }
    events = events.slice(0, target);
    if (events.length >= target) exhausted = false;
    const tail = events.at(-1);
    return {events, source: {filter, count: events.length, exhausted, blocked,
      oldest: tail ? {id: tail.id, created_at: tail.created_at} : null}};
  } catch (error) {
    error.partial = sortEvents([...events, ...(error.partial ?? [])]);
    throw error;
  }
}
