import { describe, it, expect } from 'vitest';
import {
	departures,
	nearbyStops,
	nextPass,
	routeAbbrev,
	textOn,
	walkMinutes,
	LANGSAM
} from './departures.js';

const transitRow = { id: 'A', name: 'Transit Row', loc: [39.13431, -84.51395] }; // ~140 m from Langsam
const mainGate = { id: 'B', name: 'University Main Gate', loc: [39.1318, -84.5173] }; // ~400 m
const farAway = { id: 'C', name: 'Ada & Ravine', loc: [39.12646, -84.52573] }; // >1 km
const stops = [transitRow, mainGate, farAway];
const now = Date.parse('2026-11-13T21:00:00Z');
const at = (/** @type {number} */ min) => new Date(now + min * 60000).toISOString();

describe('departures', () => {
	it('boards the same bus at the nearest stop, not a farther stop it reaches seconds earlier', () => {
		// regression: the bus hits Main Gate (6 min walk) at 8.6 min, then Transit Row (2 min walk) at 9 min
		const routes = [
			{
				id: 'ne',
				name: 'Northeast',
				color: '#228124',
				vehicles: [
					{
						next: [
							{ stopId: 'B', eta: at(8.6) },
							{ stopId: 'A', eta: at(9) }
						]
					}
				]
			}
		];
		const [d] = departures(routes, stops, LANGSAM.loc, now);
		expect([d.stop.name, d.walk, d.minutes]).toEqual(['Transit Row', 2, 9]);
	});

	it('waits for the next lap at the nearest stop instead of chasing the bus to a farther one', () => {
		// regression: the only bus passes Transit Row (2 min walk) in 30 s, then reaches Main Gate
		// (6 min walk) at 10 min. Its next lap reaches Transit Row ~13 min later: within 5 min of
		// Main Gate, so wait at the closer stop (an estimate, not a live time).
		const route = (/** @type {number} */ gate) => ({
			id: 'ne',
			name: 'Northeast',
			color: '#228124',
			headwaySec: [720, 780], // TripShot's range: the estimate uses the longest
			vehicles: [
				{
					next: [
						{ stopId: 'A', eta: at(0.5) },
						{ stopId: 'B', eta: at(gate) }
					]
				}
			]
		});
		const [d] = departures([route(10)], stops, LANGSAM.loc, now);
		expect([d.stop.name, d.walk, d.minutes, d.live]).toEqual(['Transit Row', 2, 14, false]);
		// but when the farther stop gets you on 5+ min sooner, it's worth the walk
		const [far] = departures([route(7)], stops, LANGSAM.loc, now);
		expect([far.stop.name, far.minutes, far.live]).toEqual(['University Main Gate', 7, true]);
	});

	it('knows when the next bus comes: next lap, the next scheduled ride, or none today', () => {
		const ride = { headwaySec: [780, 780], planned: [{ next: [{ stopId: 'A', eta: at(64) }] }] };
		const missed = now + 0.5 * 60000;
		// its ride runs past the next lap: the bus comes back round
		expect(nextPass(ride, { until: at(60) }, 'a', missed)).toEqual({
			at: missed + 780000,
			kind: 'lap'
		});
		// its ride ends first (a shift change): the next ride's scheduled time
		expect(nextPass(ride, { until: at(5) }, 'A', missed)).toEqual({
			at: now + 64 * 60000,
			kind: 'scheduled'
		});
		// nothing later today: none
		expect(nextPass({ ...ride, planned: [] }, { until: at(5) }, 'A', missed)).toBe(null);
		// no schedule data from the proxy: just the headway guess
		expect(nextPass({ headwaySec: 780 }, {}, 'A', missed)?.kind).toBe('lap');
		// Running now leaves the route out when the last bus of the day is too close to catch
		const last = {
			id: 'ne',
			name: 'Northeast',
			color: '#228124',
			headwaySec: 780,
			planned: [],
			vehicles: [{ until: at(5), next: [{ stopId: 'A', eta: at(0.5) }] }]
		};
		expect(departures([last], stops, LANGSAM.loc, now)).toEqual([]);
	});

	it('still prefers a sooner bus over a later one at a closer stop', () => {
		const routes = [
			{
				id: 'n',
				name: 'North',
				color: '#F27107',
				vehicles: [
					{ next: [{ stopId: 'A', eta: at(20) }] },
					{ next: [{ stopId: 'B', eta: at(7) }] }
				]
			}
		];
		const [d] = departures(routes, stops, LANGSAM.loc, now);
		expect([d.stop.name, d.minutes]).toEqual(['University Main Gate', 7]);
	});

	it('picks the soonest catchable bus per route and sorts by time', () => {
		const routes = [
			{
				id: 'n',
				name: 'North',
				color: '#F27107',
				vehicles: [{ next: [{ stopId: 'B', eta: at(6) }] }]
			},
			{
				id: 'sw',
				name: 'Southwest',
				color: '#00005C',
				vehicles: [
					{
						next: [
							{ stopId: 'a', eta: at(4) },
							{ stopId: 'C', eta: at(1) }
						]
					}
				]
			}
		];
		const d = departures(routes, stops, LANGSAM.loc, now);
		expect(d.map((x) => [x.route.name, x.stop.name, x.minutes])).toEqual([
			['Southwest', 'Transit Row', 4],
			['North', 'University Main Gate', 6]
		]);
	});

	it("skips a bus you can't walk to in time, and stops out of walking range", () => {
		const routes = [
			{
				id: 'n',
				name: 'North',
				color: '#F27107',
				vehicles: [
					{
						next: [
							{ stopId: 'B', eta: at(1) },
							{ stopId: 'C', eta: at(9) }
						]
					}
				]
			}
		];
		expect(departures(routes, stops, LANGSAM.loc, now)).toEqual([]);
	});

	it('keeps the route name short and finds nearby stops nearest first', () => {
		const d = departures(
			[
				{
					id: 'ue',
					name: 'Uptown Express New',
					color: '#000000',
					vehicles: [{ next: [{ stopId: 'A', eta: at(11) }] }]
				}
			],
			stops,
			LANGSAM.loc,
			now
		);
		expect(d[0].route.name).toBe('Uptown Express');
		expect(nearbyStops(stops, LANGSAM.loc).map((s) => s.stop.name)).toEqual([
			'Transit Row',
			'University Main Gate'
		]);
	});
});

describe('helpers', () => {
	it('abbreviates route names and picks readable text colors', () => {
		expect(
			[
				'Southwest',
				'North',
				'Uptown Express New',
				'College of Medicine Connector',
				'Southwest Night Ride',
				'Innovation District'
			].map(routeAbbrev)
		).toEqual(['SW', 'N', 'UE', 'COM', 'SW', 'ID']);
		expect([textOn('#00005C'), textOn('#F27107'), textOn('#F297DE'), textOn('#000000')]).toEqual([
			'#ffffff',
			'#000000',
			'#000000',
			'#ffffff'
		]);
		expect([walkMinutes(10), walkMinutes(140), walkMinutes(400)]).toEqual([1, 2, 6]);
	});
});
