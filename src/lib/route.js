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

/**
 * Progress of a ride on one bus from `boardId` to `destId`, for the on-board screen.
 * `stopIds` is the route's loop order; a stop counts as passed once it's no longer among
 * the bus's upcoming stops (up to its first arrival at the destination).
 * @param {NextStop[]} next
 * @param {string[]} stopIds
 * @param {string} boardId
 * @param {string} destId
 * @returns {{ rows: { stopId: string, eta: string | null, passed: boolean }[],
 *   left: number, total: number, arrived: boolean, alertAt: string | null } | null}
 */
export function tripProgress(next, stopIds, boardId, destId) {
	const lc = (/** @type {string} */ s) => s.toLowerCase();
	const ids = stopIds.map(lc);
	const b = ids.indexOf(lc(boardId));
	const d = ids.indexOf(lc(destId));
	if (b < 0 || d < 0 || b === d) return null;
	const count = (d - b + ids.length) % ids.length; // stops from board to dest, wrapping the loop
	const upTo = next.findIndex((n) => lc(n.stopId) === lc(destId));
	const ahead = new Map(next.slice(0, upTo + 1).map((n) => [lc(n.stopId), n.eta]));
	const rows = Array.from({ length: count + 1 }, (_, i) => {
		const id = stopIds[(b + i) % ids.length];
		return { stopId: id, eta: ahead.get(lc(id)) ?? null, passed: !ahead.has(lc(id)) };
	});
	return {
		rows,
		left: rows.slice(1).filter((r) => !r.passed).length,
		total: count,
		arrived: upTo < 0,
		// the stop before yours: the alert goes off once the bus gets there
		alertAt: count > 1 ? rows[count - 1].stopId : null
	};
}

/**
 * Where a shared ride stands, for the friend's view (`/ride/`): `ended` once the link has
 * expired, `arrived` when the bus has passed the destination, `boarding` while it hasn't
 * reached the boarding stop yet, otherwise `riding`. `lost` when the bus isn't reporting.
 * @param {ReturnType<typeof tripProgress>} prog
 * @param {number} now
 * @param {number} until
 */
export function rideStatus(prog, now, until) {
	if (now > until) return 'ended';
	if (!prog) return 'lost';
	if (prog.arrived) return 'arrived';
	return prog.rows[0].passed ? 'riding' : 'boarding';
}
