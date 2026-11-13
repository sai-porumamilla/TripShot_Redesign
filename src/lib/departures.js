// Pure logic for "next departures near you". No network, no DOM, so it's testable.

/** Fallback location when the rider's location is unknown or off campus. */
export const LANGSAM = {
	name: 'Langsam Library',
	loc: /** @type {[number, number]} */ ([39.1347, -84.5154])
};

/** Farthest stop we'll suggest walking to. */
export const MAX_WALK_M = 800;

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
 * @param {{ id: string, name: string, color: string, vehicles: { next: { stopId: string, eta: string }[] }[] }[]} routes
 * @param {{ id: string, name: string, loc: number[] }[]} stops
 * @param {number[]} here
 * @param {number} now  epoch ms
 */
export function departures(routes, stops, here, now) {
	const near = new Map(nearbyStops(stops, here).map((s) => [s.stop.id.toLowerCase(), s]));
	const out = [];
	for (const route of routes) {
		let best = null;
		for (const v of route.vehicles)
			for (const n of v.next) {
				const s = near.get(n.stopId.toLowerCase());
				if (!s) continue;
				const minutes = (Date.parse(n.eta) - now) / 60000;
				if (minutes < s.walk - 0.5) continue; // you can't get there in time
				if (!best || minutes < best.minutes || (minutes === best.minutes && s.walk < best.walk))
					best = { stop: s.stop, walk: s.walk, minutes };
			}
		if (best)
			out.push({
				route: { id: route.id, name: shortName(route.name), color: route.color },
				stop: best.stop,
				walk: best.walk,
				minutes: Math.max(0, Math.round(best.minutes)),
				live: true
			});
	}
	return out.sort((a, b) => a.minutes - b.minutes);
}
