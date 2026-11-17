import { describe, it, expect } from 'vitest';
import {
	nearestIndex,
	pathBetween,
	pickVehicle,
	progressRows,
	rideStatus,
	tripProgress
} from './route.js';

const now = Date.parse('2026-11-13T21:00:00Z');
const at = (/** @type {number} */ min) => new Date(now + min * 60000).toISOString();
const next = ['pav', 'tr', 'sh', 'rs', 'ada', 'ws'].map((stopId, i) => ({
	stopId,
	eta: at(2 + i * 2)
}));

describe('route logic', () => {
	it('walks a looping path forward, wrapping past the end', () => {
		const path = [
			[0, 0],
			[0, 1],
			[0, 2],
			[0, 3],
			[0, 4]
		];
		expect(nearestIndex(path, [0.0001, 2.9])).toBe(3);
		expect(pathBetween(path, 1, 3)).toEqual([
			[0, 1],
			[0, 2],
			[0, 3]
		]);
		expect(pathBetween(path, 3, 1)).toEqual([
			[0, 3],
			[0, 4],
			[0, 0],
			[0, 1]
		]);
	});

	it('follows the bus that reaches your stop soonest, skipping ones that already passed', () => {
		const vehicles = [
			{ name: 'late', loc: null, seen: at(0), next: [{ stopId: 'TR', eta: at(12) }] },
			{ name: 'soon', loc: null, seen: at(0), next: [{ stopId: 'tr', eta: at(4) }] },
			{ name: 'gone', loc: null, seen: at(0), next: [{ stopId: 'tr', eta: at(-3) }] }
		];
		expect(pickVehicle(vehicles, 'tr', now)?.vehicle.name).toBe('soon');
		expect(pickVehicle(vehicles, 'nowhere', now)).toBe(null);
	});

	it('lists one stop before yours through your destination, or two stops after', () => {
		expect(progressRows(next, 'tr', 'ada').map((r) => [r.stopId, r.kind])).toEqual([
			['pav', 'next'],
			['tr', 'yours'],
			['sh', 'way'],
			['rs', 'way'],
			['ada', 'dest']
		]);
		expect(progressRows(next, 'sh', null).map((r) => r.kind)).toEqual([
			'way',
			'yours',
			'way',
			'way'
		]);
		expect(progressRows(next, 'pav', null).map((r) => r.kind)).toEqual(['yours', 'way', 'way']);
		expect(progressRows(next, 'missing', null)).toEqual([]);
	});

	it('tracks an on-board trip: stops left, passed stops, the alert stop and arrival', () => {
		const loop = ['ws', 'pav', 'TR', 'sh', 'rs', 'ada'];
		// bus has left Transit Row and The Heights; Ravine & Straight is next
		const onTheWay = [
			{ stopId: 'rs', eta: at(1) },
			{ stopId: 'ada', eta: at(3) },
			{ stopId: 'ws', eta: at(5) }
		];
		const p = tripProgress(onTheWay, loop, 'tr', 'ADA');
		expect(p?.rows.map((r) => [r.stopId, r.passed])).toEqual([
			['TR', true],
			['sh', true],
			['rs', false],
			['ada', false]
		]);
		expect([p?.left, p?.total, p?.arrived, p?.alertAt]).toEqual([2, 3, false, 'rs']);
		expect(p?.rows[3].eta).toBe(at(3));
		// past the destination (it's no longer ahead): arrived
		expect(tripProgress([{ stopId: 'ws', eta: at(5) }], loop, 'tr', 'ada')?.arrived).toBe(true);
		// the trip wraps around the end of the loop; one stop away has no stop-before alert
		expect(tripProgress(onTheWay, loop, 'ada', 'ws')?.rows.map((r) => r.stopId)).toEqual([
			'ada',
			'ws'
		]);
		expect(tripProgress(onTheWay, loop, 'ada', 'ws')?.alertAt).toBe(null);
		expect(tripProgress(onTheWay, loop, 'tr', 'nope')).toBe(null);
	});

	it('tells a friend where a shared ride stands', () => {
		const loop = ['ws', 'pav', 'tr', 'sh', 'rs', 'ada'];
		const riding = tripProgress(
			[
				{ stopId: 'rs', eta: at(1) },
				{ stopId: 'ada', eta: at(3) }
			],
			loop,
			'tr',
			'ada'
		);
		const waiting = tripProgress(
			[
				{ stopId: 'tr', eta: at(2) },
				{ stopId: 'ada', eta: at(8) }
			],
			loop,
			'tr',
			'ada'
		);
		const done = tripProgress([{ stopId: 'ws', eta: at(1) }], loop, 'tr', 'ada');
		const until = now + 3600000;
		expect(rideStatus(riding, now, until)).toBe('riding');
		expect(rideStatus(waiting, now, until)).toBe('boarding');
		expect(rideStatus(done, now, until)).toBe('arrived');
		expect(rideStatus(null, now, until)).toBe('lost');
		expect(rideStatus(riding, until + 1, until)).toBe('ended');
		// next loop: the boarding stop is ahead again after the rider was seen riding
		const nextLoop = tripProgress(
			[
				{ stopId: 'tr', eta: at(20) },
				{ stopId: 'ada', eta: at(26) }
			],
			loop,
			'tr',
			'ada',
			true
		);
		expect(nextLoop?.arrived).toBe(true);
		expect(nextLoop?.rows.every((r) => r.passed && !r.eta)).toBe(true);
		expect(rideStatus(nextLoop, now, until)).toBe('arrived');
	});
});
