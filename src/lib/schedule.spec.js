import { describe, it, expect } from 'vitest';
import {
	campusTime,
	classesOn,
	matchPlace,
	parseIcs,
	planFor,
	sampleSchedule,
	upcoming
} from './schedule.js';

// Monday Nov 16 2026, 8:30 AM in Cincinnati (EST = UTC−5)
const now = Date.parse('2026-11-16T13:30:00Z');
const at = (/** @type {number} */ min) => new Date(now + min * 60000).toISOString();
const info = {
	id: 'a',
	name: 'INFO 3020',
	place: 'Digital Futures',
	days: ['MO', 'WE'],
	start: '09:05'
};
const later = { id: 'b', name: 'INFO 4040', place: 'Lindner', days: ['MO'], start: '13:25' };

describe('my day', () => {
	it('finds class times in campus time: today, later today, and next week', () => {
		expect(campusTime(now, 0, '09:05')).toBe(Date.parse('2026-11-16T14:05:00Z'));
		const next = upcoming([later, info], now);
		expect(next.slice(0, 3).map((u) => [u.cls.name, u.day])).toEqual([
			['INFO 3020', 0],
			['INFO 4040', 0],
			['INFO 3020', 2] // Wednesday
		]);
		// after 9:05, today's list still shows it (for the timeline), but it's no longer upcoming
		const noon = now + 4 * 3600000;
		expect(classesOn([later, info], noon, 0).map((c) => c.cls.name)).toEqual([
			'INFO 3020',
			'INFO 4040'
		]);
		expect(upcoming([info], noon)[0].day).toBe(2);
	});

	it('plans when to leave: the latest bus that still gets you there early, or later', () => {
		const stops = [
			{ id: 'TR', name: 'Transit Row', loc: [39.13431, -84.51395] },
			{ id: 'DF', name: 'Digital Futures stop', loc: [39.1185, -84.5102] }
		];
		const bus = (/** @type {number} */ dep, /** @type {number} */ arr) => ({
			next: [
				{ stopId: 'TR', eta: at(dep) },
				{ stopId: 'DF', eta: at(arr) }
			]
		});
		const routes = [
			{
				id: 'id',
				name: 'Innovation District',
				color: '#924949',
				vehicles: [bus(3, 13), bus(13, 23), bus(25, 35)]
			}
		];
		const from = [39.1347, -84.5154];
		const to = [39.1186, -84.5101]; // next to the DF stop
		const classAt = campusTime(now, 0, '09:05'); // 35 min away; be there by 9:00
		const p = planFor(routes, stops, from, to, classAt, now);
		// the 8:43 bus arrives 8:53 (the 8:55 bus would be too late); leave = 8:43 − walk − 1
		expect(p.kind).toBe('shuttle');
		if (p.kind !== 'shuttle') return;
		expect(p.trip.departAt).toBe(Date.parse(at(13)));
		expect(p.leaveAt).toBe(Date.parse(at(13)) - (p.trip.walkTo + 1) * 60000);
		// a class hours away is planned later, with today's typical trip time
		const l = planFor(routes, stops, from, to, campusTime(now, 0, '13:25'), now);
		expect(l).toMatchObject({ kind: 'later', planAt: campusTime(now, 0, '12:40') });
	});

	it('reads classes from an .ics export and matches their buildings', () => {
		const ics = [
			'BEGIN:VCALENDAR',
			'BEGIN:VEVENT',
			'SUMMARY:INFO 3020 Lecture',
			'DTSTART;TZID=America/New_York:20260824T090500',
			'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261204T235900Z',
			'LOCATION:Lindner Hall 0300',
			'END:VEVENT',
			// one event per meeting, in UTC, with a folded line: merged into one class
			'BEGIN:VEVENT',
			'SUMMARY:INFO 4040',
			'DTSTART:20261117T182500Z',
			'LOCATION:Baldwin',
			'  Hall 645',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'SUMMARY:INFO 4040',
			'DTSTART:20261119T182500Z',
			'LOCATION:Baldwin Hall 645',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'SUMMARY:Essay due',
			'DTSTART;VALUE=DATE:20261120',
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');
		expect(parseIcs(ics)).toEqual([
			{
				name: 'INFO 3020 Lecture',
				location: 'Lindner Hall 0300',
				days: ['MO', 'WE', 'FR'],
				start: '09:05'
			},
			{ name: 'INFO 4040', location: 'Baldwin Hall 645', days: ['TU', 'TH'], start: '13:25' }
		]);
		const places = [{ name: 'Carl H. Lindner Hall' }, { name: 'Baldwin Hall' }];
		expect(matchPlace(places, 'Lindner Hall 0300')?.name).toBe('Carl H. Lindner Hall');
		expect(matchPlace(places, 'Baldwin 645')?.name).toBe('Baldwin Hall');
		expect(matchPlace(places, 'Online')).toBe(null);
	});

	it('makes a sample day with a class soon, or tomorrow morning late at night', () => {
		expect(sampleSchedule(now).map((c) => c.start)).toEqual(['09:05', '13:25']);
		const night = Date.parse('2026-11-17T04:30:00Z'); // Mon 11:30 PM
		const s = sampleSchedule(night);
		expect(s[0].start).toBe('09:05');
		expect(upcoming(s, night)[0].day).toBe(1);
	});
});
