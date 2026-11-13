<script>
	import RouteMap from '#lib/RouteMap.svelte';
	import { getJSON } from '#lib/api.js';
	import { distanceM, nearbyStops, shortName, textOn, walkMinutes } from '#lib/departures.js';
	import { here, locate } from '#lib/here.svelte.js';
	import { nearestIndex, pathBetween, pickVehicle, progressRows } from '#lib/route.js';
	import { applyServiceChange, scenarioFrom } from '#lib/serviceChanges.js';
	import backWhite from '#lib/assets/icons/back-white.svg';
	import busWhite from '#lib/assets/icons/bus-white.svg';
	import busInk from '#lib/assets/icons/bus-ink.svg';
	import alertBell from '#lib/assets/icons/alert-bell.svg';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	/** @typedef {{ id: string, name: string, loc: number[] }} Stop */
	let params = $state(
		/** @type {{ id: string, stop: string | null, to: string | null } | null} */ (null)
	);
	let detail = $state(
		/** @type {{ name: string, color: string, stops: Stop[], path: number[][] } | null} */ (null)
	);
	let live = $state(/** @type {{ vehicles: import('#lib/route.js').Vehicle[] } | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	let change = $state(/** @type {import('#lib/serviceChanges.js').ServiceChange | null} */ (null));

	onMount(() => {
		// read the query in the browser: the page is prerendered without one
		const q = new URLSearchParams(location.search);
		change = scenarioFrom(location.search);
		const id = q.get('id');
		if (!id) return void (failed = true);
		params = { id, stop: q.get('stop'), to: q.get('to') };
		locate();
		getJSON(`/routes/${id}`).then(
			(d) => (detail = d),
			() => (failed = true)
		);
		const load = () =>
			getJSON(`/routes/${id}/live`).then(
				(d) => ((live = d), (failed = false)),
				() => (failed = !live)
			);
		load();
		const poll = setInterval(load, 10000);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => (clearInterval(poll), clearInterval(tick));
	});

	// Apply an active service change: the closed stop is replaced by the temporary one
	const view = $derived(
		detail && change
			? applyServiceChange(change, detail.stops, [{ vehicles: live?.vehicles ?? [] }])
			: null
	);
	const routeStops = $derived(view?.closed ? view.stops : (detail?.stops ?? []));
	const vehicles = $derived(view?.closed ? view.routes[0].vehicles : (live?.vehicles ?? []));
	const byId = $derived(new Map(routeStops.map((s) => [s.id.toLowerCase(), s])));
	const stopOf = (/** @type {string} */ id) => byId.get(id.toLowerCase());
	// your stop: the one you tapped, or the route's nearest stop to you
	const your = $derived(
		detail
			? (params?.stop && stopOf(params.stop)) ||
					nearbyStops(routeStops, here.loc, Infinity)[0]?.stop
			: undefined
	);
	const dest = $derived(params?.to ? stopOf(params.to) : undefined);
	const walk = $derived(your ? walkMinutes(distanceM(here.loc, your.loc)) : 0);
	const pick = $derived(live && your ? pickVehicle(vehicles, your.id, now) : null);
	const eta = $derived(pick ? Date.parse(pick.at.eta) : null);
	const minutes = $derived(eta === null ? null : Math.max(0, Math.round((eta - now) / 60000)));
	const rows = $derived(
		pick && your ? progressRows(pick.vehicle.next, your.id, dest?.id ?? null) : []
	);
	const seenAgo = $derived(
		pick ? Math.max(0, Math.round((now - Date.parse(pick.vehicle.seen)) / 1000)) : null
	);
	const stale = $derived(seenAgo !== null && seenAgo > 90);
	const late = $derived(pick?.at.status === 'Delayed');

	const name = $derived(detail ? shortName(detail.name) : '');
	const color = $derived(detail?.color ?? '#16181c');
	const onColor = $derived(textOn(color));
	const title = $derived(
		dest ? `${name} → ${dest.name}` : your ? `${name} · from ${your.name}` : name
	);
	const headline = $derived(
		minutes === null
			? live
				? 'No bus on the way'
				: 'Finding your bus…'
			: minutes === 0
				? 'Arriving now'
				: `Arriving in ${minutes} min`
	);
	const fresh = $derived(
		seenAgo === null
			? null
			: stale
				? `Last seen ${Math.round(seenAgo / 60)} min ago`
				: `• Live · updated ${seenAgo}s ago`
	);

	// The solid part of the line: bus → your stop → destination (or the last listed stop)
	const trip = $derived.by(() => {
		const end = dest ?? (rows.length ? stopOf(rows[rows.length - 1].stopId) : undefined);
		if (!detail?.path.length || !pick?.vehicle.loc || !end) return [];
		return pathBetween(
			detail.path,
			nearestIndex(detail.path, pick.vehicle.loc),
			nearestIndex(detail.path, end.loc)
		);
	});
	const bus = $derived(pick?.vehicle.loc ? { loc: pick.vehicle.loc, stale } : null);
	const busNext = $derived(pick ? stopOf(pick.vehicle.next[0]?.stopId ?? '')?.name : undefined);

	const clock = (/** @type {number} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const rowTime = (/** @type {{ eta: string, kind: string }} */ r) => {
		const m = Math.max(0, Math.round((Date.parse(r.eta) - now) / 60000));
		return r.kind === 'dest' ? `~${clock(Date.parse(r.eta))}` : m === 0 ? 'Now' : `${m} min`;
	};
	const SUB = { next: 'Next stop', way: 'On the way', dest: 'Get off here' };

	// "Tell me when to leave": bus arrival − your walk − 1 min buffer, recomputed as the ETA moves
	let alertOn = $state(false);
	let fired = $state(false);
	const leaveAt = $derived(eta === null ? null : eta - (walk + 1) * 60000);
	$effect(() => {
		if (!alertOn || fired || leaveAt === null || now < leaveAt) return;
		fired = true;
		if ('Notification' in window && Notification.permission === 'granted')
			new Notification(`Leave now for ${your?.name}`, {
				body: `${name} arrives in ${minutes} min. Your walk is ${walk} min.`,
				icon: undefined
			});
	});
	async function toggleAlert() {
		if (!alertOn && 'Notification' in window && Notification.permission === 'default')
			await Notification.requestPermission();
		alertOn = !alertOn;
		fired = false;
	}
</script>

<svelte:head>
	<title>{name ? `${name} live` : 'Live route'} · TripShot</title>
</svelte:head>

{#if failed && !detail}
	<div class="empty">
		<h1>Route unavailable</h1>
		<p>We couldn’t load this route right now.</p>
		<a href={resolve('/')}>Back to running now</a>
	</div>
{:else}
	<div class="page" style:--route={color} style:--on-route={onColor}>
		<div class="desktop heading">
			<h1>Your live route</h1>
			<p>{title}</p>
		</div>

		<header class="arrival" class:dark-text={onColor === '#000000'}>
			<a class="back" href={resolve('/')} aria-label="Back to running now"
				><img src={backWhite} alt="" width="16" height="28" /></a
			>
			<div class="arrival-main">
				<p class="title">{title}</p>
				<p class="headline" aria-live="polite">{headline}</p>
			</div>
			{#if fresh}
				<div class="pills">
					<span class="pill" class:stale>{fresh}</span>
					<span class="pill" class:late>{late ? 'Running late' : 'On time'}</span>
				</div>
			{/if}
		</header>

		{#if fired}
			<p class="leave-now" role="alert">
				Leave now for {your?.name}. The bus arrives in {minutes} min.
			</p>
		{/if}

		<div class="grid">
			<section class="progress card" aria-labelledby="progress-title">
				<h2 id="progress-title" class="label desktop">Route progress</h2>
				<div class="mapbox">
					{#if detail && your}
						<RouteMap
							{color}
							path={detail.path}
							{trip}
							stops={routeStops}
							yourStopId={your.id}
							closure={view?.closed && change
								? { closed: view.closed, road: change.road, roadLabel: change.roadLabel }
								: null}
							destId={dest?.id ?? null}
							{bus}
							here={here.loc}
							label="Map of {name}: the bus, your stop{dest
								? ', your destination'
								: ''}, and your walk to the stop. The same information is in the list."
						/>
					{/if}
				</div>
				<div class="sheet">
					{#if busNext}
						<p class="busrow">
							<span class="phone bus-chip"
								><img src={busWhite} alt="" width="14" height="16" /></span
							>
							<img class="desktop" src={busInk} alt="" width="18" height="21" />
							Bus · next stop {busNext}
						</p>
					{/if}
					{#if rows.length}
						<ol class="rows">
							{#each rows as r (r.stopId)}
								<li class={r.kind}>
									<span class="dot desktop"></span>
									<div class="stop">
										<p class="name">{stopOf(r.stopId)?.name ?? 'Stop'}</p>
										{#if r.kind === 'yours'}
											<p class="sub">Your stop · {walk} min walk</p>
										{:else}
											<p class="sub desktop">{SUB[r.kind]}</p>
										{/if}
									</div>
									<p class="time">{rowTime(r)}</p>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="state">
							{live
								? `No ${name || 'bus'} is heading to ${your?.name ?? 'your stop'} right now.`
								: 'Loading live arrivals…'}
						</p>
					{/if}
				</div>
			</section>

			<aside>
				<div class="card alert">
					<p class="label desktop">
						<img src={alertBell} alt="" width="18" height="23" />Make the wait yours
					</p>
					<p class="desktop alert-title">No need to watch the route.</p>
					<p class="desktop alert-text">
						Get alerted based on your {walk} min walk to {your?.name ?? 'your stop'}.
					</p>
					<button
						class="action"
						class:on={alertOn}
						onclick={toggleAlert}
						disabled={leaveAt === null}
					>
						{alertOn ? 'Cancel alert' : 'Tell me when to leave'}
					</button>
					<p class="helper">
						{#if alertOn && leaveAt !== null}
							We’ll alert you at {clock(leaveAt)}. Keep this page open.
						{:else}
							Alerts you based on your {walk} min walk to the stop
						{/if}
					</p>
				</div>
				<div class="card desktop">
					{#if dest}
						<p class="label">Your destination</p>
						<p class="big-stop">{dest.name}</p>
						{#if rows.at(-1)?.kind === 'dest'}<p class="muted">
								Arrive {rowTime(rows[rows.length - 1])}
							</p>{/if}
					{:else if your}
						<p class="label">Your stop</p>
						<p class="big-stop">{your.name}</p>
						<p class="muted">{walk} min walk from {here.real ? 'you' : here.name}</p>
					{/if}
				</div>
			</aside>
		</div>
	</div>
{/if}

<style>
	/* ---------- Phone (default): Figma frame 3, at 1× ---------- */
	.desktop {
		display: none;
	}
	.page {
		margin: -28px -18px 0;
	}
	.arrival {
		padding: 22px 18px 16px;
		background: var(--route);
		color: var(--on-route);
	}
	.back {
		display: inline-block;
		width: 16px;
		height: 16px;
	}
	.back img {
		display: block;
		width: 8px;
		height: 14px;
		margin: 1px 0 0 4px;
	}
	.dark-text .back img {
		filter: invert(1);
	}
	.title {
		margin-top: 22px;
		font-size: 14px;
		font-weight: 700;
		line-height: 18px;
	}
	.headline {
		margin-top: 2px;
		font-size: 34px;
		font-weight: 700;
		line-height: 42px;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 3px;
	}
	.pill {
		padding: 3px 8px;
		border-radius: 12px;
		background: #fff;
		color: var(--ink);
		font-size: 13px;
		font-weight: 700;
		line-height: 16px;
	}
	.pill.stale {
		color: var(--muted);
	}
	.pill.late {
		color: var(--alert);
	}
	.leave-now {
		margin: 12px 18px 0;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--ink);
		color: #fff;
		font-weight: 700;
	}
	.mapbox {
		height: 220px;
	}
	.sheet {
		position: relative;
		z-index: 500;
		margin-top: -14px;
		padding: 22px 18px 8px;
		border-radius: 16px 16px 0 0;
		background: var(--bg);
		box-shadow: 0 -2px 8px rgb(0 0 0 / 0.12);
	}
	.sheet::before {
		content: '';
		position: absolute;
		top: 7px;
		left: calc(50% - 18px);
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: #b8bdc8;
	}
	.busrow {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 14px;
		font-weight: 700;
		line-height: 18px;
		color: var(--muted);
	}
	.bus-chip {
		display: grid;
		place-items: center;
		width: 24px;
		height: 32px;
		border-radius: 10px;
		background: var(--ink);
	}
	.rows {
		margin-top: 10px;
		padding: 0;
		list-style: none;
	}
	.rows li {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		min-height: 50px;
		padding-left: 32px;
	}
	/* route line down the left: solid up to your stop, dashed after */
	.rows li::before {
		content: '';
		position: absolute;
		left: 10px;
		top: 0;
		bottom: 0;
		border-left: 4px solid var(--route);
	}
	.rows li.yours ~ li::before {
		border-left: 4px dashed #b8bdc8;
	}
	.name {
		font-size: 15px;
		line-height: 20px;
		color: var(--muted);
	}
	.yours .name,
	.dest .name {
		font-weight: 700;
		color: var(--ink);
	}
	.yours .name {
		font-size: 16px;
	}
	.sub {
		font-size: 13px;
		font-weight: 700;
		line-height: 17px;
	}
	.time {
		font-size: 14px;
		line-height: 20px;
		color: var(--muted);
		text-align: right;
	}
	.yours .time {
		font-size: 18px;
		font-weight: 700;
		color: var(--ink);
	}
	.state {
		margin: 12px 0;
		color: var(--muted);
		font-size: 14px;
	}
	/* phone: the alert card becomes the sticky action bar above the bottom nav */
	.alert {
		position: sticky;
		bottom: 48px;
		z-index: 600;
		padding: 16px 17px 12px;
		background: var(--surface);
		border-top: 1px solid var(--line);
		text-align: center;
	}
	.action {
		width: 100%;
		height: 48px;
		border: 0;
		border-radius: 12px;
		background: var(--action);
		color: #fff;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
	}
	.action.on {
		background: var(--surface);
		color: var(--ink);
		border: 2px solid var(--ink);
	}
	.action:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.helper {
		margin-top: 8px;
		font-size: 13px;
		line-height: 18px;
		color: var(--muted);
	}
	.empty {
		display: grid;
		gap: 8px;
		padding-top: 40px;
	}

	/* ---------- Desktop: Figma frame 03 ---------- */
	@media (min-width: 900px) {
		.desktop {
			display: revert;
		}
		.phone {
			display: none;
		}
		.page {
			margin: 0;
			max-width: 1136px;
		}
		.heading h1 {
			font-family: 'Inter', sans-serif;
			font-size: 32px;
			line-height: 40px;
		}
		.heading p {
			margin-top: 9px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
		.arrival {
			display: grid;
			grid-template-columns: 1fr 256px;
			align-items: center;
			min-height: 168px;
			margin-top: 31px;
			padding: 22px 28px;
			border-radius: 16px;
		}
		.back {
			display: none;
		}
		.title {
			margin: 0;
			font-size: 18px;
			line-height: 22.5px;
		}
		.headline {
			margin-top: 18px;
			font-size: 44px;
			line-height: 55px;
		}
		.pills {
			flex-direction: column;
			gap: 20px;
			margin: 0;
		}
		.pill {
			padding: 7px 16px;
			border-radius: 20px;
			font-size: 16px;
			line-height: 24px;
		}
		.leave-now {
			margin: 16px 0 0;
		}
		.grid {
			display: grid;
			grid-template-columns: minmax(0, 720px) 392px;
			gap: 24px;
			align-items: start;
			margin-top: 24px;
		}
		.card {
			padding: 23px;
			background: var(--surface);
			border: 1px solid var(--line);
			border-radius: 16px;
		}
		.label {
			display: flex;
			align-items: center;
			gap: 16px;
			font-size: 12px;
			font-weight: 700;
			line-height: 18px;
			letter-spacing: 0.8px;
			text-transform: uppercase;
			color: var(--muted);
		}
		.progress {
			display: grid;
			grid-template-columns: 1fr 300px;
			grid-template-areas: 'label map' 'sheet map';
			grid-template-rows: auto 1fr;
			column-gap: 24px;
			min-height: 552px;
		}
		.progress > .label {
			grid-area: label;
		}
		.mapbox {
			grid-area: map;
			height: 504px;
			border-radius: 12px;
			overflow: hidden;
		}
		.sheet {
			grid-area: sheet;
			z-index: auto;
			margin: 0;
			padding: 30px 0 0;
			border-radius: 0;
			background: none;
			box-shadow: none;
		}
		.sheet::before {
			display: none;
		}
		.busrow {
			gap: 16px;
			font-size: 18px;
			line-height: 22.5px;
			color: var(--ink);
		}
		.rows {
			margin-top: 24px;
		}
		.rows li {
			min-height: 96px;
			padding-left: 44px;
		}
		.rows li::before {
			left: 11px;
		}
		.dot {
			position: absolute;
			left: 5px;
			top: calc(50% - 8px);
			z-index: 1;
			width: 16px;
			height: 16px;
			border: 1px solid var(--line);
			border-radius: 8px;
			background: #fff;
		}
		.yours .dot {
			background: var(--ink);
			border-color: var(--ink);
		}
		.name {
			font-size: 18px;
			line-height: 22.5px;
			color: var(--ink);
		}
		.yours .name {
			font-size: 22px;
			line-height: 27.5px;
		}
		.sub {
			margin-top: 6px;
			font-size: 14px;
			font-weight: 400;
			line-height: 24px;
			color: var(--muted);
		}
		.yours .sub {
			font-weight: 700;
			color: var(--ink);
		}
		.time {
			font-size: 18px;
			color: var(--ink);
		}
		.yours .time {
			font-size: 24px;
		}
		aside {
			display: grid;
			gap: 24px;
		}
		.alert {
			position: static;
			text-align: left;
			padding: 23px;
		}
		.alert-title {
			margin-top: 36px;
			font-size: 28px;
			font-weight: 700;
			line-height: 35px;
		}
		.alert-text {
			margin-top: 14px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
		.action {
			margin-top: 50px;
			border-radius: 10px;
		}
		.helper {
			text-align: left;
		}
		.big-stop {
			margin-top: 17px;
			font-size: 24px;
			font-weight: 700;
			line-height: 30px;
		}
		.muted {
			margin-top: 50px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
	}
</style>
