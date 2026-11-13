// Read-only TripShot data via our Cloudflare Worker (see proxy/ and CLAUDE.md).
export const PROXY = 'https://tripshot-proxy.tripshot-proxy.workers.dev';

/** @param {string} path e.g. "/live" */
export async function getJSON(path) {
	const res = await fetch(PROXY + path);
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res.json();
}
