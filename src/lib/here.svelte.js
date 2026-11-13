// Where the rider is. Defaults to Langsam Library so the demo works from anywhere;
// switches to the real location only when it's actually near campus.
import { distanceM, LANGSAM } from './departures.js';

const CAMPUS_RADIUS_M = 3000;

export const here = $state({ name: LANGSAM.name, loc: LANGSAM.loc, real: false });

export function locate() {
	if (!('geolocation' in navigator)) return;
	navigator.geolocation.getCurrentPosition(
		(p) => {
			const loc = /** @type {[number, number]} */ ([p.coords.latitude, p.coords.longitude]);
			if (distanceM(loc, LANGSAM.loc) > CAMPUS_RADIUS_M) return; // off campus: keep the demo location
			here.loc = loc;
			here.name = 'you';
			here.real = true;
		},
		() => {}, // denied or unavailable: keep the demo location
		{ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
	);
}
