// The second shuttle of a two-shuttle trip, from `?then=<routeId>&thenStop=<stopId>&thenTo=<stopId>`
// (added by Search): its name, stops and live buses, so the live route and On board pages can
// say where to change and when the next one leaves, and link straight to it.
import { getJSON } from './api.js';
import { shortName } from './departures.js';
import { pickVehicle } from './route.js';
import { resolve } from '$app/paths';

/**
 * @param {Record<string, string>} q  the page's query, as an object
 * @returns {null | {
 *   href: string,
 *   readonly name: string,
 *   readonly color: string | null,
 *   readonly checked: boolean,
 *   next: (arriveAt: number) => number | null,
 *   dispose: () => void
 * }}
 */
export function connection(q) {
	const [id, stop, to] = [q.then, q.thenStop, q.thenTo];
	if (!id || !stop || !to) return null;
	const s = $state({
		/** @type {{ name: string, color: string } | null} */ route: null,
		/** @type {{ vehicles: import('./route.js').Vehicle[] } | null} */ live: null,
		checked: false // a live check came back (or failed), so "none found" means none reporting
	});
	getJSON(`/routes/${id}`).then(
		(d) => (s.route = d),
		() => {}
	);
	const load = () =>
		getJSON(`/routes/${id}/live`).then(
			(d) => ((s.live = d), (s.checked = true)),
			() => (s.checked = true)
		);
	load();
	const poll = setInterval(load, 20000);
	const keep = ['place', 'after', 'scenario'].flatMap((k) => {
		const v = q[k];
		return v ? [`&${k}=${encodeURIComponent(v)}`] : [];
	});
	return {
		href: `${resolve('/route')}/?id=${id}&stop=${stop}&to=${to}${keep.join('')}`,
		get name() {
			return s.route ? shortName(s.route.name) : '';
		},
		get color() {
			return s.route?.color ?? null;
		},
		get checked() {
			return s.checked;
		},
		/** When the next one leaves the change stop, at least a minute after you get there. */
		next: (arriveAt) => {
			const p = s.live ? pickVehicle(s.live.vehicles, stop, arriveAt + 2 * 60000) : null;
			return p ? Date.parse(p.at.eta) : null;
		},
		dispose: () => clearInterval(poll)
	};
}
