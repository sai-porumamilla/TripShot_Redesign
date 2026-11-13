// Pure logic for "search by destination": compare live shuttle trips with walking.
import { distanceM, nearbyStops, shortName, walkMinutes } from './departures.js';

/**
 * @typedef {{ id: string, name: string, loc: number[] }} Stop
 * @typedef {{ route: { id: string, name: string, color: string }, board: Stop, alight: Stop, walkTo: number, walkFrom: number, departAt: number, arriveAt: number }} Trip
 */

/**
 * Time differences smaller than this aren't worth extra walking: walking must beat the best
 * shuttle by this much to be recommended, and among shuttles arriving within this much of the
 * fastest, the one with the least walking is recommended.
 */
export const WALK_MARGIN_MIN = 5;

/** A destination counts as "at the stop" (no final walk) within this distance. */
const AT_STOP_M = 40;

/**
 * Best trip per route from `from` to `to`, plus the walk-only option.
 * A shuttle trip: walk to a nearby stop, catch a live bus there (it must arrive no earlier
 * than your walk), ride it to a stop near the destination, walk the rest.
 * Per route, and then across routes, the same rule picks the recommendation (see `easiest`).
 * @param {{ id: string, name: string, color: string, vehicles: { next: { stopId: string, eta: string }[] }[] }[]} routes
 * @param {{ id: string, name: string, loc: number[] }[]} stops
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} now epoch ms
 */
export function planTrips(routes, stops, from, to, now) {
	const key = (/** @type {string} */ id) => id.toLowerCase();
	const boards = new Map(nearbyStops(stops, from).map((s) => [key(s.stop.id), s]));
	const alights = new Map(
		nearbyStops(stops, to).map((s) => [
			key(s.stop.id),
			{ ...s, walk: s.meters <= AT_STOP_M ? 0 : s.walk }
		])
	);
	const shuttles = /** @type {Trip[]} */ ([]);
	for (const route of routes) {
		const options = /** @type {Trip[]} */ ([]);
		for (const v of route.vehicles)
			v.next.forEach((n, i) => {
				const b = boards.get(key(n.stopId));
				if (!b) return;
				const departAt = Date.parse(n.eta);
				if ((departAt - now) / 60000 < b.walk - 0.5) return; // can't make it
				for (const m of v.next.slice(i + 1)) {
					const a = alights.get(key(m.stopId));
					if (!a || key(a.stop.id) === key(b.stop.id)) continue;
					options.push({
						route: { id: route.id, name: shortName(route.name), color: route.color },
						board: b.stop,
						alight: a.stop,
						walkTo: b.walk,
						walkFrom: a.walk,
						departAt,
						arriveAt: Date.parse(m.eta) + a.walk * 60000
					});
				}
			});
		const best = easiest(options);
		if (best) shuttles.push(best);
	}
	shuttles.sort((a, b) => a.arriveAt - b.arriveAt);
	const recommended = easiest(shuttles);
	if (recommended)
		(shuttles.splice(shuttles.indexOf(recommended), 1), shuttles.unshift(recommended));
	const walkMin = walkMinutes(distanceM(from, to));
	return { shuttles, walk: { minutes: walkMin, arriveAt: now + walkMin * 60000 } };
}

/**
 * Among trips arriving within WALK_MARGIN_MIN of the fastest, the one with the least walking
 * (then the earliest). Saving a minute or two isn't worth a long walk.
 * @param {Trip[]} trips
 */
function easiest(trips) {
	if (!trips.length) return null;
	const fastest = Math.min(...trips.map((t) => t.arriveAt));
	const walk = (/** @type {Trip} */ t) => t.walkTo + t.walkFrom;
	return trips
		.filter((t) => t.arriveAt <= fastest + WALK_MARGIN_MIN * 60000)
		.reduce((a, b) =>
			walk(b) < walk(a) || (walk(b) === walk(a) && b.arriveAt < a.arriveAt) ? b : a
		);
}

/**
 * Case-insensitive place search: names starting with the query first, then names containing it.
 * @template {{ name: string }} T
 * @param {T[]} places
 * @param {string} query
 */
export function searchPlaces(places, query, limit = 6) {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const starts = [],
		contains = [];
	for (const p of places) {
		const n = p.name.toLowerCase();
		if (n.startsWith(q) || n.split(/[\s&/-]+/).some((w) => w.startsWith(q))) starts.push(p);
		else if (n.includes(q)) contains.push(p);
	}
	return [...starts, ...contains].slice(0, limit);
}

/**
 * Recommend walking only when it's clearly faster: riding is less effort (and safer at night),
 * so a shuttle that arrives within WALK_MARGIN_MIN of walking still wins.
 * @param {{ shuttles: { arriveAt: number }[], walk: { arriveAt: number } }} plan
 */
export function walkIsBest(plan) {
	const s = plan.shuttles[0];
	return !s || plan.walk.arriveAt + WALK_MARGIN_MIN * 60000 <= s.arriveAt;
}
