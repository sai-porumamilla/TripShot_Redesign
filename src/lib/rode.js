// "Rode past the boarding stop" (see rideStatus in route.js), kept in this tab so a reload or a
// phone killing the tab doesn't forget it. It lapses 30 min after the expected arrival, so riding
// the same bus between the same stops later doesn't start out "arrived".

/** @param {Record<string, string>} q */
const key = (q) => `rode:${q.id}:${q.bus}:${q.stop}:${q.to}`;

/** @param {Record<string, string>} q */
export function recalled(q) {
	try {
		return Date.now() < Number(sessionStorage.getItem(key(q)));
	} catch {
		return false;
	}
}

/** @param {Record<string, string>} q @param {string | null | undefined} destEta */
export function remember(q, destEta) {
	try {
		sessionStorage.setItem(key(q), String((Date.parse(destEta ?? '') || Date.now()) + 30 * 60000));
	} catch {
		// storage blocked: kept for this visit only
	}
}
