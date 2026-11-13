<script>
	import Icon from '#lib/Icon.svelte';
	import RouteMap from '#lib/RouteMap.svelte';
	import { getJSON } from '#lib/api.js';
	import { textOn } from '#lib/departures.js';
	import { here, locate } from '#lib/here.svelte.js';
	import places from '#lib/places.json';
	import { nearestIndex, pathBetween } from '#lib/route.js';
	import { planTrips, searchPlaces, walkIsBest } from '#lib/trips.js';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import { onMount } from 'svelte';

	/** @typedef {{ name: string, loc: number[], kind: string, id?: string }} Place */
	let stops = $state(/** @type {{ id: string, name: string, loc: number[] }[]} */ ([]));
	let live = $state(/** @type {{ routes: any[] } | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	let query = $state('');
	let dest = $state(/** @type {Place | null} */ (null));
	let open = $state(false);

	// Campus places from OpenStreetMap + live shuttle stops (stops win on duplicate names).
	const allPlaces = $derived.by(() => {
		/** @type {Record<string, Place>} */
		const byName = {};
		for (const p of /** @type {Place[]} */ (places)) byName[p.name.toLowerCase()] = p;
		for (const s of stops) byName[s.name.toLowerCase()] = { ...s, kind: 'Shuttle stop' };
		return Object.values(byName);
	});
	const suggestions = $derived(open && query !== dest?.name ? searchPlaces(allPlaces, query) : []);

	onMount(() => {
		locate();
		query = new URLSearchParams(location.search).get('to') ?? '';
		getJSON('/stops').then(
			(s) => {
				stops = s;
				if (query)
					choose(
						allPlaces.find((p) => p.name.toLowerCase() === query.toLowerCase()) ??
							searchPlaces(allPlaces, query)[0]
					);
			},
			() => (failed = true)
		);
		const load = () =>
			getJSON('/live').then(
				(d) => ((live = d), (failed = false)),
				() => (failed = !live)
			);
		load();
		const poll = setInterval(load, 10000);
		const tick = setInterval(() => (now = Date.now()), 5000);
		return () => (clearInterval(poll), clearInterval(tick));
	});

	/** @param {Place | undefined} p */
	function choose(p) {
		if (!p) return;
		dest = p;
		query = p.name;
		open = false;
		// A query-only relative URL can't lose the GitHub Pages base path, which is what this rule guards.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`?to=${encodeURIComponent(p.name)}`, {});
	}

	const plan = $derived(
		dest && live && stops.length ? planTrips(live.routes, stops, here.loc, dest.loc, now) : null
	);
	const shuttle = $derived(plan?.shuttles[0]);
	const walkWins = $derived(!!plan && walkIsBest(plan));
	const others = $derived(plan ? plan.shuttles.slice(walkWins ? 0 : 1, walkWins ? 2 : 3) : []);

	// Route line for the recommended ride (fetched once per route)
	/** @type {Record<string, number[][]>} */
	const paths = $state({});
	$effect(() => {
		const id = shuttle?.route.id;
		if (id && !paths[id])
			getJSON(`/routes/${id}`).then(
				(d) => (paths[id] = d.path),
				() => {}
			);
	});
	const ride = $derived.by(() => {
		const p = shuttle && paths[shuttle.route.id];
		if (!p?.length || !shuttle) return [];
		return pathBetween(p, nearestIndex(p, shuttle.board.loc), nearestIndex(p, shuttle.alight.loc));
	});

	const clock = (/** @type {number} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const mins = (/** @type {number} */ t) => Math.max(0, Math.round((t - now) / 60000));
	const from = $derived(here.real ? 'Your location' : `Current location (${here.name})`);
	const home = $derived(dest?.kind === 'Dorm' || dest?.kind === 'Apartments');
</script>

<svelte:head>
	<title>{dest ? `To ${dest.name}` : 'Search'} · TripShot</title>
</svelte:head>

<div class="desktop heading">
	<h1>{dest ? (home ? 'Find your way home' : 'Find your way there') : 'Where to?'}</h1>
	<p>
		{dest
			? `Compare your options to ${dest.name}`
			: 'Search a building, dorm, or stop. Compare the shuttle with walking.'}
	</p>
</div>

<form
	class="search"
	role="search"
	onsubmit={(e) => {
		e.preventDefault();
		choose(suggestions[0] ?? searchPlaces(allPlaces, query)[0]);
	}}
>
	<div class="desktop from">
		<span class="field-label">From</span>
		<span>{from}</span>
	</div>
	<span class="desktop arrow" aria-hidden="true">→</span>
	<label class="to">
		<span class="desktop field-label">To</span>
		<span class="input-row">
			<span class="phone"><Icon name="search" /></span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="search"
				placeholder="Building, dorm, stop"
				autocomplete="off"
				role="combobox"
				aria-label="Destination"
				aria-autocomplete="list"
				aria-controls="suggestions"
				aria-expanded={suggestions.length > 0}
				autofocus={!query}
				bind:value={query}
				oninput={() => (open = true)}
				onfocus={() => (open = true)}
			/>
		</span>
	</label>
	<button class="desktop action">Search</button>
	{#if suggestions.length}
		<ul id="suggestions" class="suggestions" role="listbox" aria-label="Destinations">
			{#each suggestions as p (p.name)}
				<li role="option" aria-selected="false">
					<button type="button" onclick={() => choose(p)}
						><strong>{p.name}</strong><span>{p.kind}</span></button
					>
				</li>
			{/each}
		</ul>
	{/if}
</form>

<p class="phone from-line">From: {from}</p>

{#if !dest}
	<p class="state">Type a building, dorm, or stop. We’ll compare the shuttle with walking.</p>
{:else if !plan}
	<p class="state">
		{failed ? 'Live shuttle data is unavailable right now.' : 'Checking live shuttles…'}
	</p>
{:else}
	<div class="columns">
		<section aria-labelledby="best-title">
			<h2 id="best-title" class="phone label">Best way right now</h2>
			<div class="best" style:--route={walkWins ? 'var(--line)' : shuttle?.route.color}>
				<p class="desktop label">Best way right now</p>
				{#if walkWins || !shuttle}
					<div class="best-head">
						<p class="arrive">Arrive ~{clock(plan.walk.arriveAt)}</p>
						<p class="total">{plan.walk.minutes} min total</p>
					</div>
					<p class="chips"><span class="chip">Walk {plan.walk.minutes} min</span></p>
					<p class="lead"><strong>Walking is fastest right now.</strong></p>
					<p class="sub">No shuttle gets you there sooner.</p>
				{:else}
					<div class="best-head">
						<p class="arrive">Arrive ~{clock(shuttle.arriveAt)}</p>
						<p class="total">{mins(shuttle.arriveAt)} min total</p>
					</div>
					<p class="chips">
						<span class="chip">Walk {shuttle.walkTo} min</span><span class="arr" aria-hidden="true"
							>→</span
						>
						<span
							class="chip route"
							style:background={shuttle.route.color}
							style:color={textOn(shuttle.route.color)}>{shuttle.route.name}</span
						>
						{#if shuttle.walkFrom}<span class="arr" aria-hidden="true">→</span><span class="chip"
								>Walk {shuttle.walkFrom} min</span
							>{/if}
					</p>
					<p class="lead">
						Board at <strong>{shuttle.board.name}</strong> in {mins(shuttle.departAt)} min.
					</p>
					<p class="sub">Get off at <strong>{shuttle.alight.name}</strong>.</p>
					<a
						class="action"
						href="{resolve('/route')}/?id={shuttle.route.id}&stop={shuttle.board.id}&to={shuttle
							.alight.id}">View live route</a
					>
				{/if}
			</div>

			{#if shuttle && !walkWins}
				<div class="phone preview">
					<RouteMap
						color={shuttle.route.color}
						path={[]}
						trip={ride}
						stops={[shuttle.board, shuttle.alight]}
						yourStopId={shuttle.board.id}
						destId={shuttle.alight.id}
						yourLabel="Board · {shuttle.board.name}"
						destLabel="Get off · {shuttle.alight.name}"
						goal={dest.loc}
						bus={null}
						here={here.loc}
						label="Trip preview: walk to {shuttle.board.name}, ride {shuttle.route.name} to {shuttle
							.alight.name}, then walk to {dest.name}."
					/>
				</div>
			{/if}

			{#if others.length || !walkWins}
				<h2 class="label others-title">Other options</h2>
				<ul class="others">
					{#each others as t (t.route.id)}
						<li>
							<a
								class="option"
								href="{resolve('/route')}/?id={t.route.id}&stop={t.board.id}&to={t.alight.id}"
							>
								<span
									><strong>{t.route.name}</strong><span
										>From {t.board.name} · {t.walkTo} min walk</span
									></span
								>
								<strong class="time">~{clock(t.arriveAt)}</strong>
							</a>
						</li>
					{/each}
					{#if !walkWins}
						<li>
							<div class="option">
								<span
									><strong>Walk</strong><span>No shuttle needed · {plan.walk.minutes} min</span
									></span
								>
								<strong class="time">~{clock(plan.walk.arriveAt)}</strong>
							</div>
						</li>
					{/if}
				</ul>
			{/if}
		</section>

		{#if shuttle && !walkWins}
			<aside class="desktop journey">
				<p class="label">Your journey</p>
				<p class="journey-title">{here.real ? 'You' : here.name.split(' ')[0]} → {dest.name}</p>
				<div class="preview">
					<RouteMap
						color={shuttle.route.color}
						path={[]}
						trip={ride}
						stops={[shuttle.board, shuttle.alight]}
						yourStopId={shuttle.board.id}
						destId={shuttle.alight.id}
						yourLabel="Board · {shuttle.board.name}"
						destLabel="Get off · {shuttle.alight.name}"
						goal={dest.loc}
						bus={null}
						here={here.loc}
						label="Trip preview: walk to {shuttle.board.name}, ride {shuttle.route.name} to {shuttle
							.alight.name}, then walk to {dest.name}."
					/>
				</div>
				<ol class="timeline">
					<li>
						<strong>{here.real ? 'Your location' : here.name}</strong><span
							>Start here · current location</span
						>
					</li>
					<li class="board">
						<strong>{shuttle.board.name}</strong><span
							>Walk {shuttle.walkTo} min · board {shuttle.route.name}</span
						>
					</li>
					<li>
						<strong>{shuttle.alight.name}</strong><span
							>Get off · arrive ~{clock(shuttle.arriveAt - shuttle.walkFrom * 60000)}</span
						>
					</li>
					{#if shuttle.walkFrom}
						<li>
							<strong>{dest.name}</strong><span>Walk {shuttle.walkFrom} min to the door</span>
						</li>
					{/if}
				</ol>
			</aside>
		{/if}
	</div>
{/if}

<style>
	/* ---------- Phone (default): Figma frame 2, at 1× ---------- */
	.desktop {
		display: none;
	}
	.search {
		position: relative;
		display: flex;
		align-items: center;
		background: var(--surface);
		border: 2px solid #b8bdc8;
		border-radius: 14px;
	}
	.search:focus-within {
		outline: 3px solid var(--live);
		outline-offset: 2px;
	}
	.to {
		flex: 1;
	}
	.input-row {
		display: flex;
		align-items: center;
		gap: 13px;
		height: 48px;
		padding-left: 14px;
	}
	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		font-size: 16px;
		font-weight: 700;
		outline: none;
	}
	input::placeholder {
		font-weight: 400;
		color: var(--muted);
	}
	.suggestions {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		z-index: 900;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
	}
	.suggestions button {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-radius: 10px;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.suggestions button:hover,
	.suggestions button:focus-visible {
		background: var(--nav-active);
	}
	.suggestions span {
		color: var(--muted);
		font-size: 13px;
	}
	.from-line {
		margin-top: 12px;
		font-size: 13px;
		line-height: 18px;
		color: var(--muted);
	}
	.label {
		font-size: 13px;
		font-weight: 700;
		line-height: 18px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	section > .label:first-child {
		margin-top: 10px;
	}
	.best {
		position: relative;
		margin-top: 8px;
		padding: 16px 15px 17px 21px;
		background: var(--surface);
		border: 2px solid #b8bdc8;
		border-radius: 16px;
		overflow: hidden;
	}
	.best::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 6px;
		background: var(--route);
	}
	.best-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.arrive {
		font-size: 22px;
		font-weight: 700;
		line-height: 28px;
	}
	.total {
		font-size: 14px;
		line-height: 18px;
		color: var(--muted);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 11px;
	}
	.chip {
		padding: 3px 8px;
		border-radius: 8px;
		background: #edf0f5;
		font-size: 14px;
		font-weight: 700;
		line-height: 18px;
	}
	.arr {
		font-size: 18px;
		font-weight: 700;
	}
	.lead,
	.sub {
		font-size: 14px;
		line-height: 19px;
		color: #2d323c;
	}
	.lead {
		margin-top: 13px;
	}
	.action {
		display: grid;
		place-items: center;
		height: 46px;
		margin-top: 14px;
		border: 0;
		border-radius: 12px;
		background: var(--action);
		color: #fff;
		font-size: 16px;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.search .action {
		display: none;
	}
	.preview {
		height: 140px;
		margin-top: 12px;
		border: 1px solid #b8bdc8;
		border-radius: 12px;
		overflow: hidden;
	}
	.others-title {
		margin-top: 16px;
	}
	.others {
		display: grid;
		gap: 11px;
		margin-top: 8px;
	}
	.option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 65px;
		padding: 0 16px 0 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
		color: inherit;
		text-decoration: none;
	}
	a.option:hover {
		border-color: var(--muted);
	}
	.option > span {
		display: grid;
	}
	.option strong:first-child {
		font-size: 16px;
		line-height: 20px;
	}
	.option > span > span {
		font-size: 14px;
		line-height: 18px;
		color: var(--muted);
	}
	.option .time {
		font-size: 16px;
	}
	.state {
		margin-top: 16px;
		padding: 20px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
		font-size: 14px;
	}

	/* ---------- Desktop: Figma frame 02 ---------- */
	@media (min-width: 900px) {
		.desktop {
			display: revert;
		}
		.phone {
			display: none;
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
		.search {
			margin-top: 31px;
			min-height: 80px;
			padding: 0 24px 0 23px;
			gap: 24px;
			border: 1px solid var(--line);
			border-radius: 16px;
		}
		.from {
			display: grid;
			flex: 0 0 430px;
			gap: 6px;
			font-size: 17px;
		}
		.field-label {
			display: block;
			font-size: 12px;
			font-weight: 700;
			line-height: 18px;
			letter-spacing: 0.8px;
			text-transform: uppercase;
			color: var(--muted);
		}
		.arrow {
			font-size: 24px;
			font-weight: 700;
			color: var(--muted);
		}
		.to {
			display: grid;
			gap: 6px;
		}
		.input-row {
			height: auto;
			padding: 0;
		}
		input {
			font-size: 18px;
		}
		.search .action {
			display: grid;
			width: 128px;
			margin: 0;
		}
		.columns {
			display: grid;
			grid-template-columns: minmax(0, 720px) 392px;
			gap: 24px;
			align-items: start;
			margin-top: 24px;
		}
		.label {
			font-size: 12px;
			letter-spacing: 0.8px;
		}
		.best {
			margin: 0;
			padding: 23px;
			border-width: 1px;
		}
		.best::before {
			width: 8px;
		}
		.best-head {
			margin-top: 20px;
		}
		.arrive {
			font-size: 36px;
			line-height: 45px;
		}
		.total {
			font-size: 18px;
		}
		.chips {
			gap: 16px;
			margin-top: 29px;
		}
		.chip {
			min-width: 128px;
			padding: 6px 16px;
			border-radius: 9px;
			font-size: 16px;
			line-height: 24px;
			text-align: center;
		}
		.arr {
			font-size: 22px;
			font-weight: 400;
			color: var(--muted);
		}
		.lead {
			margin-top: 26px;
			font-size: 18px;
			font-weight: 700;
			line-height: 22.5px;
			color: var(--ink);
		}
		.lead strong {
			font-weight: 700;
		}
		.sub {
			margin-top: 11px;
			font-size: 16px;
			line-height: 24px;
			color: var(--muted);
		}
		.sub strong {
			font-weight: 400;
		}
		.action {
			height: 48px;
			margin-top: 19px;
			border-radius: 10px;
		}
		.others-title {
			margin-top: 28px;
		}
		.others {
			gap: 20px;
			margin-top: 16px;
		}
		.option {
			min-height: 88px;
			padding: 0 24px 0 23px;
			border-radius: 16px;
		}
		.option strong:first-child {
			font-size: 20px;
			line-height: 25px;
		}
		.option > span > span {
			margin-top: 7px;
			font-size: 16px;
			line-height: 24px;
		}
		.option .time {
			font-size: 22px;
		}
		.journey {
			padding: 23px;
			background: var(--surface);
			border: 1px solid var(--line);
			border-radius: 16px;
		}
		.journey-title {
			margin-top: 18px;
			font-size: 24px;
			font-weight: 700;
			line-height: 30px;
		}
		.journey .preview {
			height: 172px;
			margin-top: 18px;
		}
		.timeline {
			position: relative;
			display: grid;
			gap: 36px;
			margin-top: 20px;
			padding: 0 0 4px 44px;
			list-style: none;
		}
		.timeline::before {
			content: '';
			position: absolute;
			left: 15px;
			top: 10px;
			bottom: 14px;
			width: 2px;
			background: var(--line);
		}
		.timeline li {
			position: relative;
			display: grid;
			gap: 2px;
		}
		.timeline li::before {
			content: '';
			position: absolute;
			left: -36px;
			top: 4px;
			width: 16px;
			height: 16px;
			border: 1px solid var(--line);
			border-radius: 8px;
			background: #fff;
		}
		.timeline li.board::before {
			background: var(--ink);
		}
		.timeline strong {
			font-size: 18px;
			line-height: 22.5px;
		}
		.timeline span {
			font-size: 14px;
			line-height: 24px;
			color: var(--muted);
		}
		.state {
			margin-top: 24px;
		}
	}
</style>
