// Read-only proxy in front of UC's TripShot API.
// Logs in with the TRIPSHOT_USER / TRIPSHOT_PASSWORD secrets, exposes a few
// trimmed GET endpoints, and adds CORS for the prototype's origins.
// Only the paths below are reachable. Nothing is forwarded as-is, so callers
// can't use the session for anything else.

const UPSTREAM = 'https://uc.tripshot.com';
const REGION = 'ca558ddc-d7f2-4b48-9cac-deea1134f820';
const ALLOWED_ORIGINS = [
	'https://sai-porumamilla.github.io',
	'http://localhost:5173',
	'http://localhost:4173',
	'http://localhost:5199'
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-isolate state shared across requests (not request data):
// the upstream session and a short-lived response cache.
// ponytail: in-memory per isolate, so each isolate logs in once and caches
// separately. Move to KV if TripShot ever complains about login volume.
/** @type {Promise<{ token: string, sessionId: string, expires: number }> | null} */
let session = null;
/** @type {Map<string, { at: number, data: unknown }>} */
const cache = new Map();

export default {
	/** @param {Request} request @param {{ TRIPSHOT_USER: string, TRIPSHOT_PASSWORD: string }} env */
	async fetch(request, env) {
		const origin = request.headers.get('origin') ?? '';
		const cors = ALLOWED_ORIGINS.includes(origin)
			? { 'access-control-allow-origin': origin, vary: 'origin' }
			: {};
		if (request.method === 'OPTIONS')
			return new Response(null, {
				status: 204,
				headers: { ...cors, 'access-control-allow-methods': 'GET' }
			});
		if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

		const parts = new URL(request.url).pathname.split('/').filter(Boolean);
		/** @type {[string, number, () => Promise<unknown>] | null} */
		let handler = null;
		if (parts.length === 1 && parts[0] === 'live') handler = ['live', 10, () => liveAll(env)];
		else if (parts.length === 1 && parts[0] === 'routes')
			handler = ['routes', 300, () => routes(env)];
		else if (parts.length === 1 && parts[0] === 'stops')
			handler = ['stops', 3600, () => stops(env)];
		else if (parts[0] === 'routes' && UUID.test(parts[1] ?? '')) {
			const id = parts[1].toLowerCase();
			if (parts.length === 2) handler = [`route:${id}`, 300, () => routeDetail(env, id)];
			else if (parts.length === 3 && parts[2] === 'live')
				handler = [`live:${id}`, 10, () => live(env, id)];
		}
		if (!handler)
			return json(
				{
					error: 'not found',
					endpoints: ['/live', '/routes', '/stops', '/routes/:id', '/routes/:id/live']
				},
				404,
				cors
			);

		const [key, ttl, load] = handler;
		try {
			return json(await cached(key, ttl, load), 200, cors, ttl);
		} catch (e) {
			console.error(JSON.stringify({ msg: 'upstream failed', key, error: String(e) }));
			return json({ error: 'upstream unavailable' }, 502, cors);
		}
	}
};

/** Return a cached value if it is younger than ttl seconds, otherwise load and cache it. */
async function cached(
	/** @type {string} */ key,
	/** @type {number} */ ttl,
	/** @type {() => Promise<any>} */ load
) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < ttl * 1000) return hit.data;
	const data = await load();
	cache.set(key, { at: Date.now(), data });
	return data;
}

/** @param {unknown} data @param {number} status @param {Record<string, string>} cors @param {number} [ttl] */
function json(data, status, cors, ttl) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json',
			...cors,
			...(ttl ? { 'cache-control': `public, max-age=${ttl}` } : {})
		}
	});
}

/** @param {{ TRIPSHOT_USER: string, TRIPSHOT_PASSWORD: string }} env */
async function login(env) {
	const res = await fetch(`${UPSTREAM}/v1/webLogin`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: env.TRIPSHOT_USER, password: env.TRIPSHOT_PASSWORD })
	});
	if (!res.ok) throw new Error(`login failed: ${res.status}`);
	const j = /** @type {{ token: string, sessionId: string, expiresIn: number }} */ (
		await res.json()
	);
	// renew an hour before TripShot's expiry
	return {
		token: j.token,
		sessionId: j.sessionId,
		expires: Date.now() + (j.expiresIn - 3600) * 1000
	};
}

/** GET an upstream path with the shared session; logs in again once on 401. */
async function upstream(/** @type {any} */ env, /** @type {string} */ path, retried = false) {
	const s = await (session && (await session).expires > Date.now()
		? session
		: (session = login(env).catch((e) => ((session = null), Promise.reject(e)))));
	const res = await fetch(UPSTREAM + path, {
		headers: { authorization: `Bearer ${s.token}`, 'x-session-id': s.sessionId }
	});
	if (res.status === 401 && !retried) {
		session = null;
		return upstream(env, path, true);
	}
	if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status}`);
	return res.json();
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
/** @param {{ lt: number, lg: number }} p */
const ll = (p) => [p.lt, p.lg];

/** @param {any} env */
async function routes(env) {
	const d = today();
	const j = await upstream(env, `/v1/p/shared/route?startDay=${d}&endDay=${d}&regionId=${REGION}`);
	return j.routes.map((/** @type {any} */ r) => {
		const x = r.InternalRoute;
		return { id: x.routeId, name: x.publicName ?? x.name, color: x.color };
	});
}

/** @param {any} env */
async function stops(env) {
	const j = await upstream(env, '/v1/stop?coalesce=true&onlyUsed=true&withTags=true');
	return j.map((/** @type {any} */ s) => ({ id: s.stopId, name: s.name, loc: ll(s.location) }));
}

/** @param {any} env @param {string} id */
async function routeDetail(env, id) {
	const j = await upstream(env, `/v3/p/shared/route/${id}?day=${today()}&breakupExactLoops=true`);
	const r = j.InternalRouteDetails;
	const tt = [...r.inexactTimetables, ...r.exactTimetables][0];
	const nav = tt?.navigations?.[0];
	return {
		id: r.route.routeId,
		name: r.route.publicName ?? r.route.name,
		color: r.route.color,
		headwaySec: tt?.headwayRangeSec ?? null,
		stops: (tt?.stops ?? []).map((/** @type {any} */ s) => ({
			id: s.stopId,
			name: s.name,
			loc: ll(s.location)
		})),
		path: (nav?.legs ?? []).flatMap((/** @type {any} */ leg) =>
			leg.steps.flatMap((/** @type {any} */ st) => decodePolyline(st.polyline))
		)
	};
}

/** @param {any} env @param {string} id */
async function live(env, id) {
	const j = await upstream(env, `/v2/p/shared/route/${id}/live?day=${today()}`);
	const data = j.InternalRouteLiveData;
	const rides = [...data.inexactLiveData, ...data.exactLiveData].flatMap(
		(/** @type {any} */ x) => x.liveRides ?? []
	);
	return {
		at: new Date().toISOString(),
		// Only rider-facing fields. Driver, shift, device and ride-history data are dropped on purpose.
		vehicles: rides.map((/** @type {any} */ { vehicle, vehicleStatus: vs, ride }) => ({
			name: vehicle.name,
			loc: vs.location ? ll(vs.location) : null,
			bearing: vs.bearing,
			speed: vs.speed,
			seen: vs.when,
			capacity: vehicle.capacity,
			occupancy: vs.apcOccupancy ?? null,
			next: ride.stopStatus
				.filter((/** @type {any} */ s) => s.Awaiting)
				.map((/** @type {any} */ { Awaiting: a }) => ({
					stopId: a.stopId,
					eta: a.expectedArrivalTime,
					scheduled: a.scheduledDepartureTime,
					status: a.riderStatus ?? null
				}))
		}))
	};
}

/**
 * Every route running today with its stop IDs and live vehicles, in one call.
 * Reuses the per-route caches, so it costs no more upstream traffic than polling each route.
 * @param {any} env
 */
async function liveAll(env) {
	const rs = await cached('routes', 300, () => routes(env));
	const results = await Promise.allSettled(
		rs.map(async (/** @type {{ id: string, name: string, color: string }} */ r) => {
			const id = r.id.toLowerCase();
			const [d, l] = await Promise.all([
				cached(`route:${id}`, 300, () => routeDetail(env, id)),
				cached(`live:${id}`, 10, () => live(env, id))
			]);
			return {
				id,
				name: r.name,
				color: r.color,
				headwaySec: d.headwaySec,
				stopIds: d.stops.map((/** @type {{ id: string }} */ s) => s.id.toLowerCase()),
				vehicles: l.vehicles
			};
		})
	);
	// one failing route shouldn't blank the whole screen
	return {
		at: new Date().toISOString(),
		routes: results.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))
	};
}

/** Google encoded polyline → [[lat, lng], ...] */
export function decodePolyline(/** @type {string} */ str) {
	const out = [];
	let lat = 0,
		lng = 0,
		i = 0;
	while (i < str.length) {
		for (const k of [0, 1]) {
			let shift = 0,
				result = 0,
				b;
			do {
				b = str.charCodeAt(i++) - 63;
				result |= (b & 0x1f) << shift;
				shift += 5;
			} while (b >= 0x20);
			const d = result & 1 ? ~(result >> 1) : result >> 1;
			if (k === 0) lat += d;
			else lng += d;
		}
		out.push([lat / 1e5, lng / 1e5]);
	}
	return out;
}
