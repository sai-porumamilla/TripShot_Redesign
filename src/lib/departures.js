// Pure logic for "next departures near you". No network, no DOM, so it's testable.

/** Fallback location when the rider's location is unknown or off campus. */
export const LANGSAM = {
	name: 'Langsam Library',
	loc: /** @type {[number, number]} */ ([39.1347, -84.5154])
};

/** Farthest stop we'll suggest walking to. */
export const MAX_WALK_M = 800;

/**
 * Time differences smaller than this aren't worth extra walking: walking must beat the best
 * shuttle by this much to be recommended, and among shuttles arriving within this much of the
 * fastest, the one with the least walking is recommended. (Also used by trips.js.)
 */
export const WALK_MARGIN_MIN = 5;

/** Great-circle distance in meters between two [lat, lng] points. */
export function distanceM(
	/** @type {number[]} */ [lat1, lng1],
	/** @type {number[]} */ [lat2, lng2]
) {
	const r = Math.PI / 180;
	const a =
		Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
		Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/**
 * Minutes between buses on a route. TripShot gives a range [shortest, longest] in seconds;
 * use the longest so we never promise a bus sooner than one may come. 0 when unknown.
 */
export const headwayMin = (/** @type {number | number[] | null | undefined} */ sec) =>
	Math.max(0, ...[sec ?? 0].flat()) / 60;

/**
 * @typedef {{ stopId: string, eta: string }} Planned
 * @typedef {{ headwaySec?: number | number[] | null, planned?: { next: Planned[] }[] }} Schedule
 */

/**
 * When a bus next reaches `stopId` after a pass you can't catch (at `missed`, epoch ms).
 * TripShot lists one lap of a bus's ride, so: its next lap, about a headway later, while its
 * scheduled ride lasts (`until`); after that, the first ride scheduled later today (a shift
 * change); null when neither is coming (the last bus of the day). Without schedule data from
 * the proxy, just the headway guess.
 * @param {Schedule} route
 * @param {{ until?: string | null }} vehicle
 * @param {string} stopId
 * @param {number} missed
 * @returns {{ at: number, kind: 'lap' | 'scheduled' } | null}
 */
export function nextPass(route, vehicle, stopId, missed) {
	const headway = headwayMin(route.headwaySec);
	const lap = headway ? missed + headway * 60000 : null;
	const until = vehicle.until ? Date.parse(vehicle.until) : Infinity;
	if (lap !== null && lap <= until) return { at: lap, kind: 'lap' };
	const id = stopId.toLowerCase();
	const [at] = (route.planned ?? [])
		.flatMap((r) => r.next.filter((n) => n.stopId.toLowerCase() === id))
		.map((n) => Date.parse(n.eta))
		.filter((t) => t > missed)
		.sort((a, b) => a - b);
	return at ? { at, kind: 'scheduled' } : null;
}

// ponytail: straight-line distance × 1.2 street factor at 84 m/min (~1.4 m/s); swap in real walking routes if times feel off
export const walkMinutes = (/** @type {number} */ meters) =>
	Math.max(1, Math.ceil((meters * 1.2) / 84));

/** "Uptown Express New" → "Uptown Express" */
export const shortName = (/** @type {string} */ name) => name.replace(/\s+New$/, '');

const COMPASS = /** @type {Record<string, string>} */ ({
	North: 'N',
	South: 'S',
	East: 'E',
	West: 'W',
	Northeast: 'NE',
	Northwest: 'NW',
	Southeast: 'SE',
	Southwest: 'SW'
});
const SPECIAL = /** @type {Record<string, string>} */ ({ 'College of Medicine Connector': 'COM' });

/** Short badge label: "Southwest" → "SW", "Uptown Express" → "UE". */
export function routeAbbrev(/** @type {string} */ name) {
	const n = shortName(name);
	if (SPECIAL[n]) return SPECIAL[n];
	const first = n.split(' ')[0];
	if (COMPASS[first]) return COMPASS[first];
	return n
		.split(/\s+/)
		.filter((w) => /^[A-Z]/.test(w))
		.map((w) => w[0])
		.join('')
		.slice(0, 3);
}

/** White or black text, whichever has more contrast on the given route color. */
export function textOn(/** @type {string} */ hex) {
	const lum = (/** @type {string} */ h) => {
		const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
		const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const l = lum(hex);
	return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000';
}

/**
 * Stops within walking distance, nearest first.
 * @param {{ id: string, name: string, loc: number[] }[]} stops
 * @param {number[]} here
 */
export function nearbyStops(stops, here, max = MAX_WALK_M) {
	return stops
		.map((stop) => ({ stop, meters: distanceM(here, stop.loc) }))
		.filter((s) => s.meters <= max)
		.sort((a, b) => a.meters - b.meters)
		.map((s) => ({ ...s, walk: walkMinutes(s.meters) }));
}

/**
 * The next bus you can actually catch on each route, soonest first.
 * A bus counts only if it reaches the stop no earlier than your walk there.
 * TripShot gives one lap of times per bus, so a bus that will pass your stop before you can
 * get there is also counted at its next pass (`nextPass`: its next lap, or the next scheduled
 * ride), marked `live: false`. Among the boardings within WALK_MARGIN_MIN of the soonest, the
 * shortest walk wins: chasing a bus to a farther stop to board a few minutes sooner isn't worth it.
 * @param {(Schedule & { id: string, name: string, color: string, vehicles: { until?: string | null, next: { stopId: string, eta: string }[] }[] })[]} routes
 * @param {{ id: string, name: string, loc: number[] }[]} stops
 * @param {number[]} here
 * @param {number} now  epoch ms
 */
export function departures(routes, stops, here, now) {
	const near = new Map(nearbyStops(stops, here).map((s) => [s.stop.id.toLowerCase(), s]));
	const out = [];
	for (const route of routes) {
		// every nearby stop where you can board this route, and when
		const options = route.vehicles.flatMap((v) =>
			v.next.flatMap((n) => {
				const s = near.get(n.stopId.toLowerCase());
				if (!s) return [];
				const minutes = (Date.parse(n.eta) - now) / 60000;
				if (minutes >= s.walk - 0.5)
					return [{ stop: s.stop, walk: s.walk, minutes, live: true, scheduled: false }];
				// too soon to walk there: count its next pass instead
				const p = nextPass(route, v, n.stopId, Date.parse(n.eta));
				return p
					? [
							{
								stop: s.stop,
								walk: s.walk,
								minutes: (p.at - now) / 60000,
								live: false,
								scheduled: p.kind === 'scheduled'
							}
						]
					: [];
			})
		);
		if (!options.length) continue;
		const soonest = Math.min(...options.map((o) => o.minutes));
		const best = options
			.filter((o) => o.minutes < soonest + WALK_MARGIN_MIN)
			.reduce((a, b) => (b.walk < a.walk || (b.walk === a.walk && b.minutes < a.minutes) ? b : a));
		out.push({
			route: { id: route.id, name: shortName(route.name), color: route.color },
			stop: best.stop,
			walk: best.walk,
			minutes: Math.max(0, Math.round(best.minutes)),
			live: best.live,
			scheduled: best.scheduled
		});
	}
	return out.sort((a, b) => a.minutes - b.minutes);
}
