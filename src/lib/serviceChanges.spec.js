import { describe, it, expect } from 'vitest';
import { applyServiceChange, scenarioFrom, SCENARIOS } from './serviceChanges.js';
import { departures, LANGSAM } from './departures.js';

const transitRow = { id: 'TR', name: 'Transit Row', loc: [39.13431, -84.51395] };
const mainGate = { id: 'MG', name: 'University Main Gate', loc: [39.1318, -84.5173] };
const now = Date.parse('2026-11-13T15:00:00Z');
const at = (/** @type {number} */ min) => new Date(now + min * 60000).toISOString();
const change = SCENARIOS['mlk-closure'];

describe('service changes', () => {
	it('moves boarding from the closed stop to the temporary stop at the same times', () => {
		const routes = [
			{
				id: 'sw',
				name: 'Southwest',
				color: '#00005C',
				stopIds: ['tr', 'mg'],
				vehicles: [
					{
						next: [
							{ stopId: 'TR', eta: at(8) },
							{ stopId: 'MG', eta: at(12) }
						]
					}
				]
			}
		];
		const out = applyServiceChange(change, [transitRow, mainGate], routes);
		expect(out.closed?.name).toBe('Transit Row');
		expect(out.stops.map((s) => s.name)).toEqual([
			'Jefferson Ave (temporary)',
			'University Main Gate'
		]);
		expect(out.routes[0].stopIds).toEqual(['temp-jefferson-ave', 'mg']);
		expect(out.routes[0].vehicles[0].next[0]).toEqual({ stopId: 'temp-jefferson-ave', eta: at(8) });
		// departures now send you to Jefferson Ave, not the closed Transit Row
		const [d] = departures(out.routes, out.stops, LANGSAM.loc, now);
		expect([d.stop.name, d.minutes]).toEqual(['Jefferson Ave (temporary)', 8]);
	});

	it('leaves data alone when the closed stop is not in it, and reads the scenario from the URL', () => {
		const routes = [{ vehicles: [{ next: [{ stopId: 'MG' }] }] }];
		const out = applyServiceChange(change, [mainGate], routes);
		expect(out.closed).toBe(null);
		expect(out.routes).toBe(routes);
		expect(scenarioFrom('?scenario=mlk-closure')?.id).toBe('mlk-closure');
		expect(scenarioFrom('?scenario=nope')).toBe(null);
		expect(scenarioFrom('')).toBe(null);
	});
});
