// Pure logic for "search by destination": compare live shuttle trips with walking.
import { distanceM, nearbyStops, shortName, walkMinutes } from './departures.js';

/**
 * @typedef {{ id: string, name: string, loc: number[] }} Stop
 * @typedef {{ id: string, name: string, color: string }} RouteRef
 * @typedef {{ at: Stop, board: Stop, route: RouteRef, arriveAt: number, departAt: number, walk: number }} Change
 * A trip. With `change`, it's two shuttles: `route`/`board`/`departAt` are the first one,
 * `change` is where you switch, and `alight`/`walkFrom`/`arriveAt` are the end of the trip.
 * @typedef {{ route: RouteRef, board: Stop, alight: Stop, walkTo: number, walkFrom: number, departAt: number, arriveAt: number, change?: Change }} Trip
 */

/**
 * Time differences smaller than this aren't worth extra walking: walking must beat the best
 * shuttle by this much to be recommended, and among shuttles arriving within this much of the
 * fastest, the one with the least walking is recommended.
 */
export const WALK_MARGIN_MIN = 5;

/** A destination counts as "at the stop" (no final walk) within this distance. */
const AT_STOP_M = 40;

// ponytail: one change only (two shuttles); add a second change if a route pair ever needs it
/** You can change between stops this close (or at the same stop). */
const TRANSFER_M = 200;
/** Longest wait for the second shuttle that's still worth suggesting. */
const MAX_WAIT_MIN = 20;
/** A change costs about this much, in minutes of walking, when comparing trips. */
const CHANGE_PENALTY_MIN = 5;

/**
 * Best trip per route (and per pair of routes, for trips with one change) from `from` to `to`,
 * plus the walk-only option.
 * A shuttle trip: walk to a nearby stop, catch a live bus there (it must arrive no earlier
 * than your walk), ride it to a stop near the destination, walk the rest. A two-shuttle trip
 * rides the first bus to a stop where another route's bus leaves after you get there (with
 * a minute to spare, plus any short walk between stops) and no more than MAX_WAIT_MIN later.
 * Per route (pair), and then across all of them, the same rule picks the recommendation
 * (see `easiest`).
 * @param {{ id: string, name: string, color: string, vehicles: { next: { stopId: string, eta: string }[] }[] }[]} routes
 * @param {{ id: string, name: string, loc: number[] }[]} stops
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} now epoch ms
 * @param {number} [arriveBy] epoch ms: only trips that get there by then, and the
 *   recommendation becomes the one you can leave latest for (not the one arriving first)
 */
export function planTrips(routes, stops, from, to, now, arriveBy) {
	const key = (/** @type {string} */ id) => id.toLowerCase();
	const boards = new Map(nearbyStops(stops, from).map((s) => [key(s.stop.id), s]));
	const alights = new Map(
		nearbyStops(stops, to).map((s) => [
			key(s.stop.id),
			{ ...s, walk: s.meters <= AT_STOP_M ? 0 : s.walk }
		])
	);
	const shuttles = /** @type {Trip[]} */ ([]);
	const latest = arriveBy !== undefined;
	const ref = (/** @type {{ id: string, name: string, color: string }} */ r) => ({
		id: r.id,
		name: shortName(r.name),
		color: r.color
	});
	// every live (route, bus, position, ETA), by stop: where a second shuttle can be caught
	/** @type {Map<string, { route: (typeof routes)[number], next: { stopId: string, eta: string }[], i: number }[]>} */
	const atStop = new Map();
	for (const route of routes)
		for (const v of route.vehicles)
			v.next.forEach((n, i) => {
				const k = key(n.stopId);
				atStop.set(k, [...(atStop.get(k) ?? []), { route, next: v.next, i }]);
			});
	const stopById = new Map(stops.map((s) => [key(s.id), s]));
	/** @type {Map<string, { stop: Stop, walk: number }[]>} */
	const near = new Map(); // stops you can change to from a stop (itself first)
	const changeStops = (/** @type {Stop} */ t) => {
		const k = key(t.id);
		if (!near.has(k))
			near.set(
				k,
				stops
					.filter((s) => s === t || distanceM(s.loc, t.loc) <= TRANSFER_M)
					.map((s) => ({ stop: s, walk: s === t ? 0 : walkMinutes(distanceM(s.loc, t.loc)) }))
			);
		return near.get(k) ?? [];
	};
	/** @type {Map<string, Trip[]>} */
	const pairs = new Map();

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
					const arriveAt = Date.parse(m.eta) + a.walk * 60000;
					if (latest && arriveAt > (arriveBy ?? 0)) continue;
					options.push({
						route: ref(route),
						board: b.stop,
						alight: a.stop,
						walkTo: b.walk,
						walkFrom: a.walk,
						departAt,
						arriveAt
					});
				}
				// two shuttles: get off at a later stop and catch another route there
				for (const m of v.next.slice(i + 1)) {
					const t = stopById.get(key(m.stopId));
					if (!t || alights.has(key(t.id)) || key(t.id) === key(b.stop.id)) continue;
					const offAt = Date.parse(m.eta);
					for (const c of changeStops(t))
						for (const e of atStop.get(key(c.stop.id)) ?? []) {
							if (e.route === route) continue;
							const departB = Date.parse(e.next[e.i].eta);
							if (departB < offAt + (c.walk + 1) * 60000) continue; // you'd miss it
							if (departB > offAt + MAX_WAIT_MIN * 60000) continue; // too long a wait
							for (const n of e.next.slice(e.i + 1)) {
								const a = alights.get(key(n.stopId));
								if (!a || key(a.stop.id) === key(c.stop.id)) continue;
								const arriveAt = Date.parse(n.eta) + a.walk * 60000;
								if (latest && arriveAt > (arriveBy ?? 0)) continue;
								const pair = `${route.id}>${e.route.id}`;
								pairs.set(pair, [
									...(pairs.get(pair) ?? []),
									{
										route: ref(route),
										board: b.stop,
										alight: a.stop,
										walkTo: b.walk,
										walkFrom: a.walk,
										departAt,
										arriveAt,
										change: {
											at: t,
											board: c.stop,
											route: ref(e.route),
											arriveAt: offAt,
											departAt: departB,
											walk: c.walk
										}
									}
								]);
							}
						}
				}
			});
		const best = easiest(options, latest);
		if (best) shuttles.push(best);
	}
	for (const options of pairs.values()) {
		const best = easiest(options, latest);
		if (best) shuttles.push(best);
	}
	shuttles.sort((a, b) => a.arriveAt - b.arriveAt);
	const recommended = easiest(shuttles, latest);
	if (recommended)
		(shuttles.splice(shuttles.indexOf(recommended), 1), shuttles.unshift(recommended));
	const walkMin = walkMinutes(distanceM(from, to));
	return { shuttles, walk: { minutes: walkMin, arriveAt: now + walkMin * 60000 } };
}

/** When you'd have to leave for a trip: walk to the stop, plus a minute to spare. */
export const leaveFor = (/** @type {Trip} */ t) => t.departAt - (t.walkTo + 1) * 60000;

/**
 * Among trips within WALK_MARGIN_MIN of the best, the easiest: the least walking, counting a
 * change of shuttle as CHANGE_PENALTY_MIN of walking. Saving a minute or two isn't worth a
 * long walk or an extra shuttle. "Best" is the earliest arrival, or with `latest` (arrive-by
 * planning) the latest you can leave.
 * @param {Trip[]} trips
 * @param {boolean} [latest]
 */
function easiest(trips, latest = false) {
	if (!trips.length) return null;
	const cost = (/** @type {Trip} */ t) => (latest ? -leaveFor(t) : t.arriveAt);
	const best = Math.min(...trips.map(cost));
	const effort = (/** @type {Trip} */ t) =>
		t.walkTo + t.walkFrom + (t.change ? t.change.walk + CHANGE_PENALTY_MIN : 0);
	return trips
		.filter((t) => cost(t) <= best + WALK_MARGIN_MIN * 60000)
		.reduce((a, b) =>
			effort(b) < effort(a) || (effort(b) === effort(a) && cost(b) < cost(a)) ? b : a
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
