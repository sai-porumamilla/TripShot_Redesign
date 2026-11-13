// Service changes (stop closures and moves) layered on top of live TripShot data.
// TripShot's API only publishes these as free-text alerts, so each change is described here
// and applied to the live data: buses that would serve the closed stop serve the temporary
// stop instead, at the same times. Everything downstream (departures, walk times, the live
// route) then works unchanged.

/**
 * @typedef {{ id: string, name: string, loc: number[] }} Stop
 * @typedef {{
 *   id: string, closedStop: string, temp: Stop, notice: string, replayNote: string,
 *   road: number[][], roadLabel: string
 * }} ServiceChange
 */

/** Scenarios that can be replayed with `?scenario=<id>` (none is active by default). */
export const SCENARIOS = /** @type {Record<string, ServiceChange>} */ ({
	// TripShot alert, Oct 7, 2026: MLK Dr closed 9:30–11:30 AM, boarding moved to Jefferson Ave.
	'mlk-closure': {
		id: 'mlk-closure',
		closedStop: 'Transit Row',
		// ponytail: approximate spot on Jefferson Ave (southbound side nearest campus), from the alert's wording
		temp: { id: 'temp-jefferson-ave', name: 'Jefferson Ave (temporary)', loc: [39.135, -84.5119] },
		notice:
			'Transit Row is closed until 11:30 AM (MLK Dr closure). Board on Jefferson Ave instead.',
		replayNote: 'Replaying the Oct 7 MLK Dr closure on live buses.',
		road: [
			[39.13558, -84.51303],
			[39.13569, -84.51324],
			[39.13575, -84.5143],
			[39.13578, -84.51498],
			[39.13567, -84.51555],
			[39.1356, -84.51573],
			[39.13546, -84.516],
			[39.13525, -84.51651],
			[39.13525, -84.51843]
		],
		roadLabel: 'MLK Dr closed until 11:30'
	}
});

/** The scenario named in a query string, if any (`?scenario=mlk-closure`). */
export const scenarioFrom = (/** @type {string} */ search) =>
	SCENARIOS[new URLSearchParams(search).get('scenario') ?? ''] ?? null;

/**
 * Apply a closure to live data.
 * @template {{ stopIds?: string[], vehicles: { next: { stopId: string }[] }[] }} R
 * @param {ServiceChange} change
 * @param {Stop[]} stops   all stops (or one route's stops, in order)
 * @param {R[]} routes     live routes (or `[{ vehicles }]` for a single route)
 * @returns {{ stops: Stop[], routes: R[], closed: Stop | null }}
 */
export function applyServiceChange(change, stops, routes) {
	const closed = stops.find((s) => s.name === change.closedStop) ?? null;
	if (!closed) return { stops, routes, closed };
	const id = closed.id.toLowerCase();
	const swap = (/** @type {string} */ s) => (s.toLowerCase() === id ? change.temp.id : s);
	return {
		closed,
		stops: stops.map((s) => (s === closed ? change.temp : s)),
		routes: routes.map((r) => ({
			...r,
			...(r.stopIds && { stopIds: r.stopIds.map(swap) }),
			vehicles: r.vehicles.map((v) => ({
				...v,
				next: v.next.map((n) => ({ ...n, stopId: swap(n.stopId) }))
			}))
		}))
	};
}
