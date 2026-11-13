import { describe, it, expect } from 'vitest';
import { planTrips, searchPlaces, walkIsBest } from './trips.js';
import { LANGSAM } from './departures.js';

const transitRow = { id: 'TR', name: 'Transit Row', loc: [39.13431, -84.51395] }; // ~140 m from Langsam
const mainGate = { id: 'MG', name: 'University Main Gate', loc: [39.1318, -84.5173] }; // ~400 m
const ada = { id: 'AR', name: 'Ada & Ravine', loc: [39.12646, -84.52573] }; // ~1.3 km
const stops = [transitRow, mainGate, ada];
const now = Date.parse('2026-11-13T21:00:00Z');
const at = (/** @type {number} */ min) => new Date(now + min * 60000).toISOString();
const atMs = (/** @type {number} */ min) => now + min * 60000;
const route = (
	/** @type {string} */ name,
	/** @type {{ stopId: string, eta: string }[]} */ next
) => ({ id: name.toLowerCase(), name, color: '#00005C', vehicles: [{ next }] });

describe('planTrips', () => {
	it('boards near you, rides to the destination stop, and has no final walk when the destination is the stop', () => {
		const { shuttles } = planTrips(
			[
				route('Southwest', [
					{ stopId: 'TR', eta: at(4) },
					{ stopId: 'AR', eta: at(15) }
				])
			],
			stops,
			LANGSAM.loc,
			ada.loc,
			now
		);
		expect(shuttles).toHaveLength(1);
		expect([
			shuttles[0].board.name,
			shuttles[0].alight.name,
			shuttles[0].walkTo,
			shuttles[0].walkFrom
		]).toEqual(['Transit Row', 'Ada & Ravine', 2, 0]);
		expect(shuttles[0].arriveAt).toBe(now + 15 * 60000);
	});

	it('ranks routes by arrival time and ignores buses you cannot reach or that go the wrong way', () => {
		const { shuttles } = planTrips(
			[
				route('North', [
					{ stopId: 'MG', eta: at(6) },
					{ stopId: 'AR', eta: at(20) }
				]),
				route('Southwest', [
					{ stopId: 'TR', eta: at(4) },
					{ stopId: 'AR', eta: at(15) }
				]),
				route('Missed', [
					{ stopId: 'MG', eta: at(1) },
					{ stopId: 'AR', eta: at(9) }
				]), // 6 min walk, bus in 1
				route('Backwards', [
					{ stopId: 'AR', eta: at(2) },
					{ stopId: 'TR', eta: at(9) }
				])
			],
			stops,
			LANGSAM.loc,
			ada.loc,
			now
		);
		expect(shuttles.map((s) => s.route.name)).toEqual(['Southwest', 'North']);
	});

	it('always includes the walk-only option', () => {
		const { shuttles, walk } = planTrips([], stops, LANGSAM.loc, ada.loc, now);
		expect(shuttles).toEqual([]);
		expect(walk.minutes).toBeGreaterThan(15);
		expect(walk.arriveAt).toBe(now + walk.minutes * 60000);
	});
});

describe('recommended shuttle', () => {
	it('prefers less walking when another trip arrives only a little sooner', () => {
		const vanguard = { id: 'VG', name: 'Vanguard', loc: [39.13201, -84.52999] }; // ~800 m from Ada & Ravine
		const { shuttles } = planTrips(
			[
				route('Northwest', [
					{ stopId: 'TR', eta: at(4) },
					{ stopId: 'VG', eta: at(12) }
				]),
				route('Southwest', [
					{ stopId: 'TR', eta: at(5) },
					{ stopId: 'AR', eta: at(23) }
				])
			],
			[...stops, vanguard],
			LANGSAM.loc,
			ada.loc,
			now
		);
		// Northwest arrives ~2 min sooner but needs an ~11 min walk; Southwest drops you at the door
		expect(shuttles.map((t) => [t.route.name, t.walkFrom])).toEqual([
			['Southwest', 0],
			['Northwest', 11]
		]);
	});
});

describe('within one route', () => {
	it('rides to the destination stop instead of getting off early and walking', () => {
		const ravine = { id: 'RS', name: 'Ravine & Straight', loc: [39.12984, -84.52537] }; // ~390 m before Ada & Ravine
		const { shuttles } = planTrips(
			[
				route('Southwest', [
					{ stopId: 'TR', eta: at(5) },
					{ stopId: 'RS', eta: at(14) },
					{ stopId: 'AR', eta: at(19) }
				])
			],
			[...stops, ravine],
			LANGSAM.loc,
			ada.loc,
			now
		);
		expect([shuttles[0].alight.name, shuttles[0].walkFrom]).toEqual(['Ada & Ravine', 0]);
	});
});

describe('searchPlaces', () => {
	it('matches word starts before substrings, case-insensitively', () => {
		const places = [
			{ name: 'Langsam Library' },
			{ name: 'Blegen Library' },
			{ name: 'Ada & Ravine' },
			{ name: 'Ravine & Straight' }
		];
		expect(searchPlaces(places, 'rav').map((p) => p.name)).toEqual([
			'Ada & Ravine',
			'Ravine & Straight'
		]);
		expect(searchPlaces(places, 'LIB').map((p) => p.name)).toEqual([
			'Langsam Library',
			'Blegen Library'
		]);
		expect(searchPlaces(places, 'brar').map((p) => p.name)).toEqual([
			'Langsam Library',
			'Blegen Library'
		]);
		expect(searchPlaces(places, '  ')).toEqual([]);
	});
});

describe('walkIsBest', () => {
	const plan = (/** @type {number} */ walkAt, /** @type {number[]} */ shuttleAts) => ({
		walk: { arriveAt: atMs(walkAt) },
		shuttles: shuttleAts.map((m) => ({ arriveAt: atMs(m) }))
	});
	it('rides unless walking is at least 5 minutes faster', () => {
		expect(walkIsBest(plan(19, [21]))).toBe(false); // walk saves 2 min: still ride
		expect(walkIsBest(plan(10, [16]))).toBe(true); // walk saves 6 min
		expect(walkIsBest(plan(10, []))).toBe(true); // no shuttle at all
	});
});
