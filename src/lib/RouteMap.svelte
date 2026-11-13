<script>
	// Live map for one route (Leaflet + muted OpenStreetMap tiles).
	// Supports the stop list, never replaces it: everything shown here is also in the list.
	import 'leaflet/dist/leaflet.css';
	import { onMount } from 'svelte';
	import yourStopSvg from '#lib/assets/map/your-stop.svg';
	import destinationSvg from '#lib/assets/map/destination.svg';
	import youSvg from '#lib/assets/map/you.svg';
	import busSvg from '#lib/assets/map/bus-icon.svg';
	import recenterSvg from '#lib/assets/map/recenter.svg';
	import homeSvg from '#lib/assets/map/home-icon.svg';
	import { distanceM } from '#lib/departures.js';

	/**
	 * @type {{
	 *   color: string,
	 *   path: number[][],
	 *   trip: number[][],
	 *   stops: { id: string, name: string, loc: number[] }[],
	 *   yourStopId: string,
	 *   destId?: string | null,
	 *   bus: { loc: number[], stale: boolean } | null,
	 *   here: number[],
	 *   label: string,
	 *   yourLabel?: string,
	 *   destLabel?: string | null,
	 *   goal?: number[] | null
	 * }}
	 */
	let {
		color,
		path,
		trip,
		stops,
		yourStopId,
		destId = null,
		bus,
		here,
		label,
		yourLabel = 'Your stop',
		destLabel = null,
		goal = null
	} = $props();

	/** @type {HTMLDivElement} */
	let el;
	/** @type {import('leaflet') | null} */
	let L = $state(null);
	/** @type {import('leaflet').Map} */
	let map;
	/** @type {import('leaflet').LayerGroup} */
	let routeLayer;
	/** @type {import('leaflet').Marker | null} */
	let busMarker = null;
	let fitted = false;

	onMount(() => {
		let cancelled = false;
		import('leaflet').then((mod) => {
			if (cancelled) return;
			L = mod.default ?? mod;
			map = L.map(el, {
				zoomControl: false,
				zoomSnap: 0.25,
				scrollWheelZoom: false,
				attributionControl: true
			});
			map.attributionControl.setPrefix(false);
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				className: 'muted-tiles',
				attribution:
					'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}).addTo(map);
			routeLayer = L.layerGroup().addTo(map);
		});
		return () => ((cancelled = true), map?.remove());
	});

	const img = (/** @type {string} */ src, /** @type {number} */ size) =>
		/** @type {import('leaflet').DivIconOptions} */ ({
			html: `<img src="${src}" alt="" width="${size}" height="${size}">`,
			className: 'pin',
			iconSize: [size, size],
			iconAnchor: [size / 2, size / 2]
		});

	// Route, stops, you: redraw when the data changes
	$effect(() => {
		if (!L || !routeLayer) return;
		const Lf = L;
		routeLayer.clearLayers();
		const ll = (/** @type {number[]} */ p) => /** @type {[number, number]} */ ([p[0], p[1]]);
		if (path.length)
			Lf.polyline(path.map(ll), { color, weight: 4, opacity: 0.3, interactive: false }).addTo(
				routeLayer
			);
		if (trip.length > 1)
			Lf.polyline(trip.map(ll), { color, weight: 6, opacity: 1, interactive: false }).addTo(
				routeLayer
			);
		const your = stops.find((s) => s.id.toLowerCase() === yourStopId.toLowerCase());
		const dest = destId ? stops.find((s) => s.id.toLowerCase() === destId.toLowerCase()) : null;
		if (your)
			Lf.polyline([ll(here), ll(your.loc)], {
				color: '#2261b4',
				weight: 3,
				dashArray: '2 8',
				lineCap: 'round',
				interactive: false
			}).addTo(routeLayer);
		for (const s of stops) {
			if (s === your || s === dest) continue;
			Lf.circleMarker(ll(s.loc), { radius: 5, color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
				.bindTooltip(s.name)
				.addTo(routeLayer);
		}
		if (dest)
			Lf.marker(ll(dest.loc), {
				icon: Lf.divIcon(img(destinationSvg, 18)),
				title: dest.name,
				keyboard: false
			})
				.bindTooltip(destLabel ?? dest.name, {
					permanent: true,
					direction: 'right',
					offset: [12, 0],
					className: 'map-label'
				})
				.addTo(routeLayer);
		if (your)
			Lf.marker(ll(your.loc), {
				icon: Lf.divIcon(img(yourStopSvg, 22)),
				title: your.name,
				keyboard: false,
				zIndexOffset: 500
			})
				.bindTooltip(yourLabel, {
					permanent: true,
					direction: 'bottom',
					offset: [0, 12],
					className: 'map-label'
				})
				.addTo(routeLayer);
		// final walk from the drop-off to the destination door (trip previews)
		if (goal && dest && distanceM(goal, dest.loc) > 40) {
			Lf.polyline([ll(dest.loc), ll(goal)], {
				color: '#16181c',
				weight: 3,
				dashArray: '2 8',
				lineCap: 'round',
				interactive: false
			}).addTo(routeLayer);
			Lf.marker(ll(goal), {
				icon: Lf.divIcon({
					html: `<span class="home"><img src="${homeSvg}" alt="" width="14" height="14"></span>`,
					className: 'pin',
					iconSize: [24, 24],
					iconAnchor: [12, 12]
				}),
				keyboard: false,
				title: 'Destination'
			}).addTo(routeLayer);
		}
		Lf.marker(ll(here), {
			icon: Lf.divIcon(img(youSvg, 40)),
			interactive: false,
			keyboard: false,
			zIndexOffset: 400
		}).addTo(routeLayer);
		if (!fitted && trip.length > 1) (recenter(), (fitted = true));
	});

	// Bus: glide to each new position instead of jumping
	$effect(() => {
		if (!L || !map) return;
		if (!bus?.loc) return void (busMarker?.remove(), (busMarker = null));
		const to = /** @type {[number, number]} */ ([bus.loc[0], bus.loc[1]]);
		if (!busMarker) {
			busMarker = L.marker(to, {
				icon: L.divIcon({
					html: `<span class="bus"><img src="${busSvg}" alt="" width="15" height="18"></span>`,
					className: 'pin',
					iconSize: [36, 36],
					iconAnchor: [18, 18]
				}),
				zIndexOffset: 1000,
				keyboard: false,
				title: 'Bus'
			}).addTo(map);
		}
		busMarker.getElement()?.classList.toggle('stale', bus.stale);
		const m = busMarker,
			from = m.getLatLng(),
			t0 = performance.now();
		let raf = 0;
		const step = (/** @type {number} */ t) => {
			const k = Math.min(1, (t - t0) / 1500);
			m.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]);
			if (k < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	function recenter() {
		if (!L || !map) return;
		const pts = [...trip, here, ...(bus?.loc ? [bus.loc] : []), ...(goal ? [goal] : [])].map(
			(p) => /** @type {[number, number]} */ ([p[0], p[1]])
		);
		if (pts.length) {
			// small maps (trip previews) get proportionally less padding
			const pad = Math.min(28, Math.round(el.clientHeight / 6));
			map.fitBounds(L.latLngBounds(pts), { padding: [pad, pad], maxZoom: 17 });
		}
	}
</script>

<div class="wrap">
	<div class="map" bind:this={el} role="img" aria-label={label}></div>
	<button class="recenter" onclick={recenter} aria-label="Recenter map on your trip"
		><img src={recenterSvg} alt="" width="20" height="20" /></button
	>
</div>

<style>
	.wrap {
		position: relative;
		height: 100%;
	}
	.map {
		height: 100%;
		background: #fff;
	}
	/* Muted basemap: gray tiles at half strength over white, so the route stands out */
	.map :global(.muted-tiles) {
		filter: grayscale(1);
		opacity: 0.5;
	}
	.map :global(.pin) {
		background: none;
		border: 0;
	}
	.map :global(.pin img) {
		display: block;
	}
	.map :global(.bus) {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: 3px solid #fff;
		border-radius: 18px;
		background: var(--ink);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
	}
	.map :global(.home) {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 2px solid #fff;
		border-radius: 6px;
		background: var(--ink);
	}
	.map :global(.stale .bus) {
		background: var(--muted);
		opacity: 0.7;
	}
	.map :global(.map-label) {
		padding: 4px 8px;
		border: 0;
		border-radius: 6px;
		box-shadow: 0 1px 1.5px rgb(0 0 0 / 0.15);
		font:
			700 12px/1.2 'Roboto',
			sans-serif;
		color: var(--ink);
	}
	.map :global(.map-label::before) {
		display: none;
	}
	.map :global(.leaflet-control-attribution) {
		padding: 1px 4px;
		font-size: 9px;
		color: var(--muted);
		background: rgb(255 255 255 / 0.85);
	}
	.recenter {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 500;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 1px solid #b8bdc8;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
	}
</style>
