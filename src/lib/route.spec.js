import { describe, it, expect } from 'vitest';
import { nearestIndex, pathBetween, pickVehicle, progressRows } from './route.js';

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
});
