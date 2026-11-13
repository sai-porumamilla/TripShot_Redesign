import { describe, it, expect } from 'vitest';
import {
	departures,
	nearbyStops,
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
