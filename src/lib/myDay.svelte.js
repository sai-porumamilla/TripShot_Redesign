// "My day": the rider's classes and a pending leave reminder, kept in this browser only.
// The schedule never leaves the device (no account, nothing sent to the proxy).

const KEY = 'myDay';

export const day = $state({
	/** @type {import('./schedule.js').Class[]} */
	classes: [],
	/** A "Remind me" set from the next-class card; the layout fires it on any page. */
	/** @type {{ key: string, at: number, title: string, body: string } | null} */
	reminder: null,
	loaded: false
});

export function loadDay() {
	if (day.loaded) return;
	day.loaded = true;
	try {
		day.classes = JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		// private mode or blocked storage: start empty
	}
}

export function saveDay() {
	try {
		localStorage.setItem(KEY, JSON.stringify(day.classes));
	} catch {
		// storage blocked: kept for this visit only
	}
}
