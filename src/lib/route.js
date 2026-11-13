// Pure logic for the live-route screen: which bus to follow, which stops to list,
// and which part of the route line is "your trip". No network or DOM.
import { distanceM } from './departures.js';

/** Index of the path point closest to `pt`. */
export function nearestIndex(/** @type {number[][]} */ path, /** @type {number[]} */ pt) {
	let best = 0,
		bestD = Infinity;
	path.forEach((p, i) => {
		const d = distanceM(p, pt);
		if (d < bestD) ((best = i), (bestD = d));
	});
	return best;
}

/** Points from index `from` forward to `to` along a looping route path (wraps past the end). */
export function pathBetween(
	/** @type {number[][]} */ path,
	/** @type {number} */ from,
	/** @type {number} */ to
) {
	return from <= to ? path.slice(from, to + 1) : [...path.slice(from), ...path.slice(0, to + 1)];
}

/**
 * @typedef {{ stopId: string, eta: string, status?: string | null }} NextStop
 * @typedef {{ name: string, loc: number[] | null, seen: string, next: NextStop[] }} Vehicle
 */

/**
 * The bus that reaches `stopId` soonest (ignoring arrivals already more than a minute past).
 * @param {Vehicle[]} vehicles
 * @param {string} stopId
 * @param {number} now epoch ms
 */
export function pickVehicle(vehicles, stopId, now) {
	const id = stopId.toLowerCase();
	let best = null;
	for (const v of vehicles) {
		const n = v.next.find((s) => s.stopId.toLowerCase() === id);
		if (!n || Date.parse(n.eta) < now - 60000) continue;
		if (!best || Date.parse(n.eta) < Date.parse(best.at.eta)) best = { vehicle: v, at: n };
	}
	return best;
}

/**
 * Stops to list under the map: the stop before yours, your stop, then up to your
 * destination (or the next two stops when there's no destination).
 * @param {NextStop[]} next
 * @param {string} stopId
 * @param {string | null} toId
 * @returns {{ stopId: string, eta: string, kind: 'next' | 'yours' | 'way' | 'dest' }[]}
 */
export function progressRows(next, stopId, toId) {
	const ids = next.map((n) => n.stopId.toLowerCase());
	const yours = ids.indexOf(stopId.toLowerCase());
	if (yours < 0) return [];
	const dest = toId ? ids.indexOf(toId.toLowerCase(), yours + 1) : -1;
	const end = dest >= 0 ? dest : Math.min(next.length - 1, yours + 2);
	const start = Math.max(0, yours - 1);
	return next.slice(start, end + 1).map((n, k) => {
		const i = start + k;
		const kind = i === yours ? 'yours' : i === dest ? 'dest' : i === 0 ? 'next' : 'way';
		return { stopId: n.stopId, eta: n.eta, kind };
	});
}
