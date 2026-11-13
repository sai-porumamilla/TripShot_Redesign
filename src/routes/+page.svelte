<script>
	import Icon from '#lib/Icon.svelte';
	import { getJSON } from '#lib/api.js';
	import { departures, nearbyStops, routeAbbrev, textOn } from '#lib/departures.js';
	import { here, locate } from '#lib/here.svelte.js';
	import RouteMap from '#lib/RouteMap.svelte';
	import { applyServiceChange, scenarioFrom } from '#lib/serviceChanges.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let live = $state(/** @type {{ routes: any[] } | null} */ (null));
	let stops = $state(/** @type {{ id: string, name: string, loc: number[] }[] | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	/** Active service change (only via `?scenario=…` today: TripShot has no structured closures). */
	let change = $state(/** @type {import('#lib/serviceChanges.js').ServiceChange | null} */ (null));

	onMount(() => {
		change = scenarioFrom(location.search);
		locate();
		getJSON('/stops').then(
			(s) => (stops = s),
			() => (failed = true)
		);
		const load = () =>
			getJSON('/live').then(
				(d) => ((live = d), (failed = false)),
				() => (failed = !live)
			);
		load();
		const poll = setInterval(load, 10000); // proxy caches 10 s, same cadence as TripShot's own app
		const tick = setInterval(() => (now = Date.now()), 5000);
		return () => (clearInterval(poll), clearInterval(tick));
	});

	// Live data with the service change (if any) applied: buses serve the temporary stop instead.
	const data = $derived(
		live && stops
			? change
				? applyServiceChange(change, stops, live.routes)
				: { stops, routes: live.routes, closed: null }
			: null
	);
	const list = $derived(data ? departures(data.routes, data.stops, here.loc, now) : null);
	const nearby = $derived(data ? nearbyStops(data.stops, here.loc).slice(0, 2) : []);
	const scenarioQuery = $derived(change ? `&scenario=${change.id}` : '');

	// A route that serves the moved stop, drawn faded for context on the service-change map
	const moved = $derived.by(() => {
		const c = change;
		if (!c || !data?.closed) return null;
		return data.routes.find((r) => r.stopIds?.includes(c.temp.id)) ?? null;
	});
	let movedPath = $state(/** @type {number[][]} */ ([]));
	$effect(() => {
		if (moved)
			getJSON(`/routes/${moved.id}`).then(
				(d) => (movedPath = d.path),
				() => {}
			);
	});
	const from = $derived(here.real ? 'you' : here.name);

	// Service hours from the design: day routes until 10 PM, NightRide 10 PM–2 AM (campus time).
	const hour = $derived(
		Number(
			new Date(now).toLocaleString('en-US', {
				timeZone: 'America/New_York',
				hour: 'numeric',
				hour12: false
			})
		) % 24
	);
	const notice = $derived(
		change
			? change.notice
			: hour >= 7 && hour < 22
				? 'Day routes end at 10 PM. NightRide North and Southwest take over until 2 AM.'
				: hour >= 22 || hour < 2
					? 'NightRide North and Southwest are running until 2 AM.'
					: 'Shuttles aren’t running right now. Day routes start again in the morning.'
	);
</script>

<svelte:head>
	<title>Running now · TripShot</title>
</svelte:head>

<p class="near phone">Near {from === 'you' ? 'you' : from}</p>
<h1>Running now</h1>
<p class="sub desktop">Next departures near {from}</p>

<form class="search" role="search" method="get" action="{resolve('/search')}/">
	<label class="field">
		<Icon name="search" />
		<span class="visually-hidden">Where to?</span>
		<input name="to" type="search" placeholder="Where to? Building, dorm, stop" />
	</label>
	<button class="desktop">Find a trip</button>
</form>

<p class="notice"><Icon name="notice-clock" />{notice}</p>
{#if change}
	<p class="replay">{change.replayNote} <a href={resolve('/')}>Exit replay</a></p>
{/if}

{#snippet changeMap()}
	{#if change && data?.closed}
		<RouteMap
			color={moved?.color ?? '#16181c'}
			path={movedPath}
			trip={[]}
			stops={[change.temp]}
			yourStopId={change.temp.id}
			yourLabel="Board here today"
			bus={null}
			here={here.loc}
			closure={{ closed: data.closed, road: change.road, roadLabel: change.roadLabel }}
			label="Map: {data.closed.name} is closed; board at {change.temp
				.name} instead. Your walk there is shown."
		/>
	{/if}
{/snippet}

{#if change && data?.closed}
	<div class="phone change-map">{@render changeMap()}</div>
{/if}

<div class="columns">
	<section aria-labelledby="dep-title">
		<div class="sec-head">
			<h2 id="dep-title">Next departures near you</h2>
			{#if list}<span class="desktop">{list.length} {list.length === 1 ? 'route' : 'routes'}</span
				>{/if}
		</div>

		{#if list === null}
			<p class="state">
				{failed
					? 'Live shuttle data is unavailable right now. Try again in a moment.'
					: 'Loading live departures…'}
			</p>
		{:else if list.length === 0}
			<p class="state">
				No shuttles you can catch from here right now. Try searching for your destination.
			</p>
		{:else}
			<ul class="deps" aria-live="polite">
				{#each list as d (d.route.id)}
					<li>
						<a
							class="dep"
							href="{resolve('/route')}/?id={d.route.id}&stop={d.stop.id}{scenarioQuery}"
							aria-label="{d.route.name} from {d.stop.name}, {d.minutes === 0
								? 'arriving now'
								: `${d.minutes} minutes`}. See the live route."
						>
							<span
								class="badge"
								class:long={routeAbbrev(d.route.name).length > 2}
								style:background={d.route.color}
								style:color={textOn(d.route.color)}>{routeAbbrev(d.route.name)}</span
							>
							<div class="info">
								<h3>{d.route.name}</h3>
								<p>{d.stop.name} · {d.walk} min walk</p>
							</div>
							<div class="eta">
								<strong>{d.minutes === 0 ? 'Now' : `${d.minutes} min`}</strong>
								<span class="live">• Live</span>
							</div>
							<span class="desktop chev"><Icon name="chevron" /></span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="foot desktop">
			Live arrivals are marked in blue. Scheduled times are estimates, not vehicle locations.
		</p>
	</section>

	<aside class="desktop">
		{#if change && data?.closed}
			<div class="card">
				<p class="label">Where to board today</p>
				<div class="change-map">{@render changeMap()}</div>
			</div>
		{:else}
			<div class="card">
				<p class="label">Not sure which route?</p>
				<h2 class="card-title">Start with your destination.</h2>
				<p class="card-text">
					Search a building, dorm, or stop. Compare shuttle options with walking.
				</p>
				<a class="action" href="{resolve('/search')}/">Search by destination</a>
			</div>
		{/if}
		<div class="card">
			<p class="label">Your nearby stops</p>
			{#each nearby as s (s.stop.id)}
				<p class="stop">{s.stop.name}</p>
				<p class="stop-walk">{s.walk} min walk from {from === 'you' ? 'you' : from}</p>
			{:else}
				<p class="stop-walk">No stops within a 10-minute walk.</p>
			{/each}
		</div>
	</aside>
</div>

<style>
	/* ---------- Phone (default) — Figma frame 1, at 1× ---------- */
	.desktop {
		display: none;
	}
	.near {
		font-size: 14px;
		line-height: 17px;
		color: var(--muted);
	}
	h1 {
		margin-top: 11px;
		font-size: 24px;
		line-height: 29px;
	}
	.search {
		display: flex;
		margin-top: 13px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
	}
	.field {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 50px;
		padding-left: 14px;
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		font-size: 16px;
		outline: none;
	}
	.field input::placeholder {
		color: var(--muted);
	}
	.search:focus-within {
		outline: 3px solid var(--live);
		outline-offset: 2px;
	}
	.notice {
		display: flex;
		gap: 10px;
		margin-top: 12px;
		padding: 10px 14px 12px;
		border-radius: 14px;
		background: var(--notice-bg);
		color: var(--notice-ink);
		font-size: 14px;
		line-height: 18px;
	}
	.notice {
		--icon-size: 14px;
	}
	.notice :global(.icon) {
		margin-top: 2px;
	}
	.replay {
		margin-top: 6px;
		font-size: 12px;
		line-height: 16px;
		color: var(--muted);
	}
	.replay a {
		color: inherit;
		font-weight: 700;
	}
	.change-map {
		height: 160px;
		margin-top: 12px;
		border: 1px solid #b8bdc8;
		border-radius: 12px;
		overflow: hidden;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-top: 18px;
	}
	h2 {
		font-size: 13px;
		line-height: 18px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.deps {
		display: grid;
		gap: 11px;
		margin-top: 8px;
	}
	.dep {
		color: inherit;
		text-decoration: none;
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
		min-height: 80px;
		padding: 0 16px 0 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
	}
	.dep:hover {
		border-color: var(--muted);
	}
	.badge {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		font-size: 15px;
		font-weight: 700;
	}
	.badge.long {
		font-size: 12px;
	}
	.info h3 {
		font-size: 16px;
		line-height: 20px;
	}
	.info p {
		font-size: 14px;
		line-height: 16px;
		color: var(--muted);
	}
	.eta {
		display: grid;
		justify-items: end;
		gap: 4px;
	}
	.eta strong {
		font-size: 20px;
		line-height: 24px;
	}
	.live {
		font-size: 12px;
		line-height: 16px;
		font-weight: 700;
		color: var(--live);
	}
	.state {
		margin-top: 8px;
		padding: 20px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
		font-size: 14px;
	}

	/* ---------- Desktop — Figma frame 01 ---------- */
	@media (min-width: 900px) {
		.phone {
			display: none;
		}
		.desktop {
			display: revert;
		}
		h1 {
			margin: 0;
			font-family: 'Inter', sans-serif;
			font-size: 32px;
			line-height: 40px;
		}
		.sub {
			margin-top: 9px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
		.search {
			margin-top: 31px;
			padding-right: 8px;
			align-items: center;
			border-radius: 16px;
		}
		.field {
			height: 62px;
			gap: 16px;
			padding-left: 21px;
		}
		.field input {
			font-size: 18px;
		}
		.search button,
		.action {
			display: grid;
			place-items: center;
			text-decoration: none;
			height: 48px;
			border: 0;
			border-radius: 10px;
			background: var(--action);
			color: #fff;
			font-size: 16px;
			font-weight: 700;
			cursor: pointer;
		}
		.search button {
			width: 160px;
		}
		.notice {
			align-items: center;
			gap: 16px;
			margin-top: 24px;
			min-height: 64px;
			padding: 0 20px;
			border-radius: 12px;
			font-size: 16px;
			line-height: 24px;
		}
		.notice {
			--icon-size: 24px;
		}
		.notice :global(.icon) {
			margin: 0;
		}
		.columns {
			display: grid;
			grid-template-columns: minmax(0, 720px) 392px;
			gap: 24px;
			align-items: start;
			margin-top: 32px;
		}
		.sec-head {
			margin: 0;
		}
		.sec-head span {
			font-size: 14px;
			color: var(--muted);
		}
		h2 {
			font-size: 12px;
			letter-spacing: 0.8px;
		}
		.deps {
			gap: 16px;
			margin-top: 18px;
		}
		.dep {
			grid-template-columns: auto 1fr auto auto;
			gap: 24px;
			min-height: 112px;
			padding: 0 20px 0 23px;
			border-radius: 16px;
		}
		.badge {
			width: 56px;
			height: 56px;
			border-radius: 12px;
			font-size: 18px;
		}
		.badge.long {
			font-size: 15px;
		}
		.info h3 {
			font-size: 22px;
			line-height: 27.5px;
		}
		.info p {
			margin-top: 7px;
			font-size: 16px;
			line-height: 24px;
		}
		.eta strong {
			font-size: 28px;
			line-height: 35px;
		}
		.live {
			font-size: 14px;
			line-height: 24px;
		}
		.chev {
			display: flex;
		}
		.foot {
			margin-top: 48px;
			font-size: 14px;
			line-height: 24px;
			color: var(--muted);
		}
		aside.desktop {
			display: grid;
			gap: 24px;
		}
		.change-map {
			height: 196px;
			margin-top: 14px;
		}
		.replay {
			margin-top: 8px;
			font-size: 13px;
		}
		.card {
			padding: 23px;
			background: var(--surface);
			border: 1px solid var(--line);
			border-radius: 16px;
		}
		.label {
			font-size: 12px;
			font-weight: 700;
			line-height: 18px;
			letter-spacing: 0.8px;
			text-transform: uppercase;
			color: var(--muted);
		}
		.card-title {
			margin-top: 18px;
			font-size: 26px;
			line-height: 32.5px;
			letter-spacing: 0;
			text-transform: none;
			color: var(--ink);
		}
		.card-text {
			margin-top: 43px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
		.action {
			width: 100%;
			margin-top: 20px;
		}
		.stop {
			margin-top: 21px;
			font-size: 18px;
			font-weight: 700;
			line-height: 22.5px;
		}
		.stop-walk {
			margin-top: 6px;
			font-size: 14px;
			line-height: 24px;
			color: var(--muted);
		}
		.state {
			margin-top: 18px;
		}
	}
</style>
