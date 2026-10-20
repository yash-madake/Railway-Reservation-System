/**
 * Timetable-only train position estimation.
 *
 * A route is stored as cumulative distance from the origin. The helper keeps
 * the calculation deterministic and deliberately returns null for distance
 * figures that are not present in the timetable instead of making them up.
 */

const MINUTES_IN_DAY = 24 * 60;

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStops(stops) {
  const firstDay = finiteNumber(stops[0]?.day) ?? 1;
  let previousTime = null;

  return stops.map((stop, index) => {
    const explicitDay = finiteNumber(stop?.day);
    const dayOffset = explicitDay === null ? firstDay : explicitDay;
    const dayBase = (dayOffset - firstDay) * MINUTES_IN_DAY;
    let stopPreviousTime = previousTime;

    const absoluteTime = (value) => {
      const minutes = timeToMinutes(value);
      if (minutes === null) return null;

      let absolute = dayBase + minutes;
      // A missing day_offset is common in hand-entered timetable data. Infer
      // midnight rollover from the ordered station times in that case.
      if (explicitDay === null && stopPreviousTime !== null) {
        while (absolute < stopPreviousTime) absolute += MINUTES_IN_DAY;
      }
      stopPreviousTime = absolute;
      return absolute;
    };

    const arrival = absoluteTime(stop?.arrivalTime);
    const departure = absoluteTime(stop?.departureTime);
    const lastKnown = departure ?? arrival;
    if (lastKnown !== null) previousTime = Math.max(previousTime ?? lastKnown, lastKnown);

    return {
      ...stop,
      arrivalAbs: arrival,
      departureAbs: departure,
      distance: finiteNumber(stop?.distanceKm),
      index,
    };
  });
}

function occurrenceForNow(startAbs, endAbs, now) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const startToday = startAbs;
  const endToday = endAbs;

  if (endToday >= startToday && nowMinutes >= startToday && nowMinutes <= endToday) {
    return { state: 'in_progress', offset: 0, nowMinutes };
  }

  // An overnight service that started yesterday can still be running after
  // midnight. This is why checking only today's departure is insufficient.
  if (endToday >= startToday && nowMinutes + MINUTES_IN_DAY >= startToday && nowMinutes + MINUTES_IN_DAY <= endToday) {
    return { state: 'in_progress', offset: -MINUTES_IN_DAY, nowMinutes: nowMinutes + MINUTES_IN_DAY };
  }

  // For an overnight service, the interval between its arrival and the next
  // departure belongs to the completed run, not to a fictitious new run that
  // has not started yet.
  if (nowMinutes < startToday && endToday > MINUTES_IN_DAY && nowMinutes + MINUTES_IN_DAY > endToday) {
    return { state: 'ended', offset: 0, nowMinutes };
  }

  if (nowMinutes < startToday) {
    return { state: 'not_started', offset: 0, nowMinutes };
  }

  return { state: 'ended', offset: 0, nowMinutes };
}

function interpolateDistance(stops, nowMinutes, state) {
  const total = stops.at(-1)?.distance;
  if (total === null || total === undefined || total <= 0) return null;
  if (state === 'not_started') return 0;
  if (state === 'ended') return total;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const arrival = stop.arrivalAbs;
    const departure = stop.departureAbs;
    const stationTime = departure ?? arrival;

    if (stationTime !== null && nowMinutes >= stationTime && arrival !== null && departure !== null && nowMinutes <= departure) {
      return stop.distance;
    }

    const next = stops[index + 1];
    if (!next || stationTime === null) continue;
    const nextArrival = next.arrivalAbs ?? next.departureAbs;
    if (nextArrival === null || nextArrival <= stationTime || nowMinutes < stationTime || nowMinutes > nextArrival) continue;

    const from = stop.distance;
    const to = next.distance;
    if (from === null || to === null) return null;
    const fraction = (nowMinutes - stationTime) / (nextArrival - stationTime);
    return from + (to - from) * Math.max(0, Math.min(1, fraction));
  }

  const passed = stops.filter((stop) => (stop.departureAbs ?? stop.arrivalAbs) !== null && nowMinutes >= (stop.departureAbs ?? stop.arrivalAbs));
  return passed.at(-1)?.distance ?? 0;
}

function timelinePosition(stops, nowMinutes, state) {
  if (stops.length <= 1 || state === 'not_started') return 0;
  if (state === 'ended') return stops.length - 1;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const stopTime = stop.departureAbs ?? stop.arrivalAbs;
    if (stop.arrivalAbs !== null && stop.departureAbs !== null && nowMinutes >= stop.arrivalAbs && nowMinutes <= stop.departureAbs) return index;

    const next = stops[index + 1];
    const nextTime = next?.arrivalAbs ?? next?.departureAbs;
    if (stopTime !== null && nextTime !== null && nowMinutes >= stopTime && nowMinutes <= nextTime) {
      const fraction = nextTime === stopTime ? 0 : (nowMinutes - stopTime) / (nextTime - stopTime);
      return index + Math.max(0, Math.min(1, fraction));
    }
  }

  const passedIndex = stops.reduce((last, stop, index) => {
    const time = stop.departureAbs ?? stop.arrivalAbs;
    return time !== null && nowMinutes >= time ? index : last;
  }, 0);
  return passedIndex;
}

export function estimateTrainPosition(stops = [], now = new Date()) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return {
      state: 'unknown',
      statusLabel: 'Position unavailable',
      coveredDistanceKm: null,
      remainingDistanceKm: null,
      completionPercent: null,
      currentStopIndex: null,
      timelinePosition: null,
      between: null,
    };
  }

  const normalized = normalizeStops(stops);
  const first = normalized[0];
  const last = normalized.at(-1);
  const startAbs = first.departureAbs ?? first.arrivalAbs;
  let endAbs = last.arrivalAbs ?? last.departureAbs;

  if (startAbs === null || endAbs === null) {
    return {
      state: 'unknown',
      statusLabel: 'Position unavailable',
      coveredDistanceKm: null,
      remainingDistanceKm: null,
      completionPercent: null,
      currentStopIndex: null,
      timelinePosition: null,
      between: null,
    };
  }

  while (endAbs < startAbs) endAbs += MINUTES_IN_DAY;
  const occurrence = occurrenceForNow(startAbs, endAbs, now);
  // occurrence.nowMinutes is already shifted onto the timetable's service
  // day when an overnight run started yesterday.
  const currentMinutes = occurrence.nowMinutes;
  const covered = interpolateDistance(normalized, currentMinutes, occurrence.state);
  const total = last.distance;
  const hasDistance = total !== null && total > 0 && covered !== null;
  const safeCovered = hasDistance ? Math.max(0, Math.min(total, covered)) : null;
  const remaining = safeCovered === null ? null : Math.max(0, total - safeCovered);
  const completion = safeCovered === null ? null : Math.round((safeCovered / total) * 100);
  const position = timelinePosition(normalized, currentMinutes, occurrence.state);

  let currentStopIndex = null;
  let between = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const stop = normalized[index];
    if (stop.arrivalAbs !== null && stop.departureAbs !== null && currentMinutes >= stop.arrivalAbs && currentMinutes <= stop.departureAbs) {
      currentStopIndex = index;
      break;
    }
    const departure = stop.departureAbs ?? stop.arrivalAbs;
    const next = normalized[index + 1];
    const nextArrival = next?.arrivalAbs ?? next?.departureAbs;
    if (departure !== null && nextArrival !== null && currentMinutes >= departure && currentMinutes < nextArrival) {
      currentStopIndex = index + 1;
      between = { fromIndex: index, toIndex: index + 1 };
      break;
    }
  }
  if (occurrence.state === 'not_started') currentStopIndex = 0;
  if (occurrence.state === 'ended') currentStopIndex = normalized.length - 1;

  const currentName = normalized[currentStopIndex]?.station?.name;
  const statusLabel = occurrence.state === 'not_started'
    ? 'Journey not started'
    : occurrence.state === 'ended'
      ? 'Journey completed'
      : between
        ? `Between ${normalized[between.fromIndex].station?.name ?? 'stations'} and ${normalized[between.toIndex].station?.name ?? 'stations'}`
        : currentName
          ? `At ${currentName}`
          : 'In progress';

  return {
    state: occurrence.state,
    statusLabel,
    coveredDistanceKm: safeCovered,
    remainingDistanceKm: remaining,
    completionPercent: completion,
    currentStopIndex,
    timelinePosition: position,
    between,
    hasDistance,
  };
}

export function formatDistance(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
}

