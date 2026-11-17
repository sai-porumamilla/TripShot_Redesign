// Pure logic for "My day": class times in campus time, the next class, when to leave for it,
// and reading a class schedule from an .ics calendar file. No network, no DOM.
import { distanceM, walkMinutes } from './departures.js';
import { leaveFor, planTrips, searchPlaces, WALK_MARGIN_MIN, walkIsBest } from './trips.js';

/**
 * A class as the rider saved it. `place` is a campus place name, `start` is "HH:MM" campus time.
 * @typedef {{ id: string, name: string, place: string, days: string[], start: string }} Class
 */

export const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Aim to be there this long before class starts. */
export const ARRIVE_EARLY_MIN = 5;
/** Live ETAs only reach about this far ahead; later classes get planned once they're in range. */
export const LIVE_HORIZON_MIN = 45;

const parts = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/New_York',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	hourCycle: 'h23',
	weekday: 'short'
});

/** Campus wall-clock date and time for an instant. */
export function campus(/** @type {number} */ t) {
	const p = Object.fromEntries(parts.formatToParts(t).map((x) => [x.type, x.value]));
	return {
		y: +p.year,
		m: +p.month,
		d: +p.day,
		h: +p.hour,
		min: +p.minute,
		dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
	};
}

/**
 * The instant of campus time `hhmm` on the campus date `dayOffset` days after `now`.
 * ponytail: uses today's UTC offset, so a class right after a DST switch is off by an hour
 */
export function campusTime(
	/** @type {number} */ now,
	/** @type {number} */ dayOffset,
	/** @type {string} */ hhmm
) {
	const c = campus(now);
	const offset = Date.UTC(c.y, c.m - 1, c.d, c.h, c.min) - Math.floor(now / 60000) * 60000;
	const [h, mi] = hhmm.split(':').map(Number);
	return Date.UTC(c.y, c.m - 1, c.d + dayOffset, h, mi) - offset;
}

/**
 * Class meetings in the next 7 days that haven't started yet, soonest first.
 * `day` is 0 for today, 1 for tomorrow, …
 * @param {Class[]} classes
 * @param {number} now
 */
export function upcoming(classes, now) {
	const dow = campus(now).dow;
	const out = [];
	for (let day = 0; day < 7; day++)
		for (const cls of classes)
			if (cls.days.includes(DAYS[(dow + day) % 7])) {
				const at = campusTime(now, day, cls.start);
				if (at > now) out.push({ cls, at, day });
			}
	return out.sort((a, b) => a.at - b.at);
}

/**
 * Every class meeting on one day (0 = today), in order, including ones already started.
 * @param {Class[]} classes
 * @param {number} now
 * @param {number} day
 */
export function classesOn(classes, now, day) {
	const dow = DAYS[(campus(now).dow + day) % 7];
	return classes
		.filter((c) => c.days.includes(dow))
		.map((cls) => ({ cls, at: campusTime(now, day, cls.start) }))
		.sort((a, b) => a.at - b.at);
}

/**
 * When to leave for a class at `classAt`, from `from` to `to`:
 * - `later`: too far ahead for live ETAs; plan at `planAt`, with today's typical trip time
 * - `shuttle`: the bus you can leave latest for and still arrive ARRIVE_EARLY_MIN early
 * - `walk`: walking, when no bus makes it or walking lets you leave WALK_MARGIN_MIN+ later
 * @param {Parameters<typeof planTrips>[0]} routes
 * @param {Parameters<typeof planTrips>[1]} stops
 * @param {number[]} from
 * @param {number[]} to
 * @param {number} classAt
 * @param {number} now
 */
export function planFor(routes, stops, from, to, classAt, now) {
	const walk = walkMinutes(distanceM(from, to));
	if (classAt - now > LIVE_HORIZON_MIN * 60000) {
		const p = planTrips(routes, stops, from, to, now);
		const s = walkIsBest(p) ? null : p.shuttles[0];
		return /** @type {const} */ ({
			kind: 'later',
			planAt: classAt - LIVE_HORIZON_MIN * 60000,
			typical: s ? Math.round((s.arriveAt - now) / 60000) : walk,
			by: s ? s.route.name : 'walking'
		});
	}
	const deadline = classAt - ARRIVE_EARLY_MIN * 60000;
	const trip = planTrips(routes, stops, from, to, now, deadline).shuttles[0];
	const walkLeave = deadline - walk * 60000;
	if (!trip || walkLeave >= leaveFor(trip) + WALK_MARGIN_MIN * 60000)
		return /** @type {const} */ ({ kind: 'walk', leaveAt: walkLeave, walk });
	return /** @type {const} */ ({ kind: 'shuttle', leaveAt: leaveFor(trip), trip });
}

/**
 * The campus place named in a free-text location ("Lindner Hall 0300" → Carl H. Lindner Hall):
 * the longest leading run of words that matches a place.
 * @template {{ name: string }} P
 * @param {P[]} places
 * @param {string} text
 */
export function matchPlace(places, text) {
	const words = text.split(/\s+/).filter(Boolean);
	for (let n = words.length; n > 0; n--) {
		const q = words.slice(0, n).join(' ');
		if (q.length < 3) break;
		const hit = searchPlaces(places, q, 1)[0];
		if (hit) return hit;
	}
	return null;
}

/**
 * Classes from an .ics calendar file (a Catalyst or Google Calendar export).
 * Timed events become classes on their weekday (or their weekly BYDAY days); events with the
 * same name, time and location are merged, so one-event-per-meeting exports work too.
 * All-day items (like Canvas due dates) are skipped. `location` is the raw text to match.
 * @param {string} text
 * @returns {{ name: string, location: string, days: string[], start: string }[]}
 */
export function parseIcs(text) {
	const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); // unfold continued lines
	/** @type {Record<string, { value: string, params: string[] }>[]} */
	const events = [];
	/** @type {Record<string, { value: string, params: string[] }> | null} */
	let ev = null;
	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') ev = {};
		else if (line === 'END:VEVENT') (ev && events.push(ev), (ev = null));
		else if (ev) {
			const i = line.indexOf(':');
			if (i < 0) continue;
			const [key, ...params] = line.slice(0, i).split(';');
			ev[key.toUpperCase()] = { value: line.slice(i + 1), params };
		}
	}
	const unescape = (/** @type {string} */ s) =>
		s
			.replace(/\\n/gi, ' ')
			.replace(/\\([,;\\])/g, '$1')
			.trim();
	/** @type {Map<string, { name: string, location: string, days: string[], start: string }>} */
	const merged = new Map();
	for (const e of events) {
		const m = e.DTSTART?.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
		if (!m || !e.SUMMARY) continue;
		let [y, mo, d, h, mi] = m.slice(1).map(Number);
		let dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
		if (e.DTSTART.value.endsWith('Z')) {
			const c = campus(Date.UTC(y, mo - 1, d, h, mi)); // UTC → campus time
			[h, mi, dow] = [c.h, c.min, c.dow];
		}
		const byday = e.RRULE?.value.match(/BYDAY=([^;]+)/)?.[1];
		const days = byday ? byday.split(',').map((x) => x.replace(/[^A-Z]/g, '')) : [DAYS[dow]];
		const start = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
		const name = unescape(e.SUMMARY.value);
		const location = unescape(e.LOCATION?.value ?? '');
		const key = `${name}|${start}|${location}`;
		const prev = merged.get(key);
		if (prev) prev.days = [...new Set([...prev.days, ...days])];
		else merged.set(key, { name, location, days, start });
	}
	return [...merged.values()].map((c) => ({
		...c,
		days: DAYS.filter((d) => c.days.includes(d)) // week order
	}));
}

/**
 * A believable sample day for trying the feature: a class ~35 min from now (so it's planned
 * on live buses) and one a few hours later. Late at night it's tomorrow morning instead.
 * @param {number} now
 * @returns {Class[]}
 */
export function sampleSchedule(now) {
	const c = campus(now);
	const hm = (/** @type {number} */ mins) =>
		`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
	let first = Math.ceil((c.h * 60 + c.min + 35) / 5) * 5;
	let day = DAYS[c.dow];
	if (first > 20 * 60 + 30) [first, day] = [9 * 60 + 5, DAYS[(c.dow + 1) % 7]];
	const second = Math.min(first + 260, 21 * 60 + 30);
	const days = [...new Set([day, 'MO', 'WE', 'FR'])];
	return [
		{ id: 'sample-1', name: 'INFO 3020', place: 'Digital Futures', days, start: hm(first) },
		{ id: 'sample-2', name: 'INFO 4040', place: 'Carl H. Lindner Hall', days, start: hm(second) }
	];
}
