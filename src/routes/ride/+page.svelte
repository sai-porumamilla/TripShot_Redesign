<script>
	// Screen 13 · What your friend sees: a read-only view of a shared ride. It follows the bus
	// the rider is on (by name), never the rider's phone, and stops after the trip.
	import RouteMap from '#lib/RouteMap.svelte';
	import places from '#lib/places.json';
	import { getJSON } from '#lib/api.js';
	import { shortName, textOn } from '#lib/departures.js';
	import { nearestIndex, pathBetween, rideStatus, tripProgress } from '#lib/route.js';
	import { recalled, remember } from '#lib/rode.js';
	import { applyServiceChange, scenarioFrom } from '#lib/serviceChanges.js';
	import { onMount } from 'svelte';

	/** @typedef {{ id: string, name: string, loc: number[] }} Stop */
	let q = $state(/** @type {Record<string, string> | null} */ (null));
	let detail = $state(
		/** @type {{ name: string, color: string, stops: Stop[], path: number[][] } | null} */ (null)
	);
	let live = $state(/** @type {{ vehicles: import('#lib/route.js').Vehicle[] } | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	let change = $state(/** @type {import('#lib/serviceChanges.js').ServiceChange | null} */ (null));

	onMount(() => {
		// read the query in the browser: the page is prerendered without one
		q = Object.fromEntries(new URLSearchParams(location.search));
		change = scenarioFrom(location.search);
		if (!q.id || !q.bus || !q.stop || !q.to) return void (failed = true);
		rode = recalled(q);
		getJSON(`/routes/${q.id}`).then(
			(d) => (detail = d),
			() => (failed = true)
		);
		const load = () =>
			getJSON(`/routes/${q?.id}/live`).then(
				(d) => ((live = d), (failed = false)),
				() => (failed = !live)
			);
		load();
		const poll = setInterval(load, 10000);
		const tick = setInterval(() => (now = Date.now()), 5000);
		return () => (clearInterval(poll), clearInterval(tick));
	});

	const view = $derived(
		detail && change
			? applyServiceChange(change, detail.stops, [{ vehicles: live?.vehicles ?? [] }])
			: null
	);
	const stops = $derived(view?.closed ? view.stops : (detail?.stops ?? []));
	const vehicles = $derived(view?.closed ? view.routes[0].vehicles : (live?.vehicles ?? []));
	const stopOf = (/** @type {string} */ id) =>
		stops.find((s) => s.id.toLowerCase() === id.toLowerCase());

	const bus = $derived(vehicles.find((v) => v.name === q?.bus));
	const board = $derived(q ? stopOf(q.stop) : undefined);
	const dest = $derived(q ? stopOf(q.to) : undefined);
	const prog = $derived(
		bus && board && dest
			? tripProgress(
					bus.next,
					stops.map((s) => s.id),
					board.id,
					dest.id
				)
			: null
	);
	const until = $derived(Number(q?.until) || Infinity);
	let rode = $state(false); // seen past the boarding stop (see rideStatus)
	$effect(() => {
		if (prog?.rows[0].passed && !rode && q) ((rode = true), remember(q, destEta));
	});
	const status = $derived(live && detail ? rideStatus(prog, now, until, rode) : null);
	const nextRow = $derived(prog?.rows.find((r, i) => i > 0 && !r.passed));
	const destEta = $derived(prog?.rows.at(-1)?.eta);
	const after = $derived(Number(q?.after) || 0);
	const placeName = $derived(q?.place || dest?.name || '');
	const goal = $derived(
		after
			? /** @type {{ name: string, loc: number[] }[]} */ (places).find((p) => p.name === placeName)
					?.loc
			: null
	);

	const who = $derived(q?.name || 'Your friend');
	// the final walk, naming the place only when it isn't the stop itself
	const walkHome = $derived(
		after ? `about ${after} min${placeName !== dest?.name ? ` to ${placeName}` : ''}` : ''
	);
	const whose = $derived(q?.name ? `${q.name}’s` : 'their');
	const name = $derived(detail ? shortName(detail.name) : '');
	const color = $derived(detail?.color ?? '#16181c');
	const clock = (/** @type {string} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const mins = (/** @type {string} */ t) => Math.max(0, Math.round((Date.parse(t) - now) / 60000));

	const headline = $derived(
		status === 'ended'
			? 'This ride has ended'
			: status === 'arrived'
				? `Got off at ${dest?.name}`
				: status === 'lost'
					? 'Lost the bus’s live signal'
					: status === 'boarding'
						? `Boarding at ${board?.name}`
						: prog?.left === 1
							? `Next stop: ${dest?.name}`
							: prog
								? `${prog.left} stops to go`
								: 'Finding the bus…'
	);
	const seenAgo = $derived(bus ? Math.round((now - Date.parse(bus.seen)) / 1000) : null);
	const trip = $derived.by(() => {
		if (!detail?.path.length || !bus?.loc || !dest || status !== 'riding') return [];
		return pathBetween(
			detail.path,
			nearestIndex(detail.path, bus.loc),
			nearestIndex(detail.path, dest.loc)
		);
	});
</script>

<svelte:head>
	<title>{q?.name ? `${q.name}’s ride` : 'Shared ride'} · TripShot</title>
</svelte:head>

{#if failed && !detail}
	<div class="empty">
		<h1>This ride link doesn’t work</h1>
		<p>It may be incomplete, or the shuttle data is unavailable right now.</p>
	</div>
{:else}
	<div class="page" style:--route={color} style:--on-route={textOn(color)}>
		<div class="desktop heading">
			<h1>{q?.name ? `${q.name}’s ride` : 'A shared ride'}</h1>
			<p>Shared with you · follows the bus, not the phone</p>
		</div>

		<header class="arrival">
			<div>
				<p class="title">{who} is on {name} → {dest?.name ?? '…'}</p>
				<p class="headline" aria-live="polite">{headline}</p>
				{#if status === 'arrived' && after}
					<p class="then">Then walking {walkHome}.</p>
				{/if}
			</div>
			{#if status === 'riding' || status === 'boarding'}
				<div class="pills">
					{#if seenAgo !== null}<span class="pill"
							>{seenAgo > 90
								? `Last seen ${Math.round(seenAgo / 60)} min ago`
								: `• Live · updated ${seenAgo}s ago`}</span
						>{/if}
					{#if destEta}<span class="pill">Gets off ~{clock(destEta)}</span>{/if}
				</div>
			{/if}
		</header>

		{#if status !== 'ended'}
			<div class="grid">
				<section class="progress card" aria-labelledby="progress-title">
					<h2 id="progress-title" class="label desktop">Route progress</h2>
					<div class="mapbox">
						{#if detail && board && dest}
							<RouteMap
								{color}
								path={detail.path}
								{trip}
								{stops}
								yourStopId={board.id}
								yourLabel="Boarded here"
								destId={dest.id}
								destLabel="Gets off · {dest.name}"
								goal={goal ?? null}
								bus={bus?.loc && status !== 'arrived'
									? { loc: bus.loc, stale: (seenAgo ?? 0) > 90 }
									: null}
								here={null}
								label="Map of {name}: the bus {who} is on, where they boarded, and where they get off. The same information is in the list."
							/>
						{/if}
					</div>
					{#if prog}
						<ol class="rows">
							{#each prog.rows as r, i (r.stopId)}
								{@const last = i === prog.rows.length - 1}
								<li class:passed={r.passed} class:now={r === nextRow} class:last>
									<div>
										<p class="name">{stopOf(r.stopId)?.name}</p>
										<p class="sub">
											{i === 0
												? r.passed
													? 'Boarded'
													: 'Boards here'
												: last
													? `${q?.name ? `${q.name} gets` : 'They get'} off here`
													: r === nextRow
														? 'Next stop'
														: r.passed
															? 'Passed'
															: 'On the way'}
										</p>
									</div>
									<p class="time">
										{r.eta ? (last ? `~${clock(r.eta)}` : `${mins(r.eta)} min`) : ''}
									</p>
								</li>
							{/each}
						</ol>
					{:else if live}
						<p class="state">
							The bus isn’t reporting right now. {who} is heading to {dest?.name ?? 'their stop'}.
						</p>
					{:else}
						<p class="state">Finding the bus…</p>
					{/if}
				</section>

				<aside>
					<div class="card">
						<p class="label">About this link</p>
						<p class="about-title">Following the bus, not {whose} phone.</p>
						<p class="muted">
							This page can’t see where {q?.name ? `${q.name} is` : 'they are'}. It shows the bus
							they boarded and says “Got off” once it passes {dest?.name ?? 'their stop'}. The link
							ends after the trip.
						</p>
					</div>
					{#if dest}
						<div class="card desktop">
							<p class="label">Gets off at</p>
							<p class="about-title">{dest.name}</p>
							<p class="muted">
								{destEta ? `~${clock(destEta)}` : ''}{after ? ` · then walks ${walkHome}` : ''}
							</p>
						</div>
					{/if}
				</aside>
			</div>
		{:else}
			<p class="state">The link stopped after the trip. Ask {q?.name || 'them'} for a new one.</p>
		{/if}
	</div>
{/if}

<style>
	/* ---------- Phone (default): Figma frame 13, at 1× ---------- */
	.desktop {
		display: none;
	}
	.page {
		margin: -28px -18px 0;
	}
	.arrival {
		padding: 28px 18px 16px;
		background: var(--route);
		color: var(--on-route);
	}
	:global(:root[data-theme='night']) .arrival {
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line);
	}
	:global(:root[data-theme='night']) .title {
		color: var(--accent);
	}
	.title {
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
	.then {
		margin-top: 4px;
		font-size: 15px;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
	.pill {
		padding: 3px 8px;
		border-radius: 12px;
		background: var(--pill);
		color: var(--ink);
		font-size: 13px;
		font-weight: 700;
		line-height: 16px;
	}
	.mapbox {
		height: 220px;
	}
	.rows {
		margin: 0;
		padding: 14px 18px 4px;
		list-style: none;
	}
	.rows li {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		min-height: 52px;
		padding-left: 32px;
	}
	/* the route line down the left: solid where the bus has been, dashed ahead */
	.rows li::before {
		content: '';
		position: absolute;
		left: 10px;
		top: 0;
		bottom: 0;
		border-left: 4px dashed var(--line-strong);
	}
	.rows li.passed::before {
		border-left-style: solid;
		border-color: var(--route);
	}
	.name {
		font-size: 15px;
		line-height: 20px;
		color: var(--muted);
	}
	.now .name,
	.last .name {
		font-weight: 700;
		color: var(--ink);
	}
	.sub {
		font-size: 13px;
		color: var(--muted);
	}
	.now .sub {
		font-weight: 700;
		color: var(--accent);
	}
	.time {
		font-size: 14px;
		color: var(--muted);
	}
	.now .time {
		font-size: 18px;
		font-weight: 700;
		color: var(--ink);
	}
	aside {
		display: grid;
		gap: 12px;
		padding: 8px 18px 0;
	}
	.card {
		background: var(--surface);
	}
	aside .card {
		padding: 14px 16px;
		border: 1px solid var(--line);
		border-radius: 12px;
	}
	.label {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.8px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.about-title {
		margin-top: 6px;
		font-size: 17px;
		font-weight: 700;
	}
	.muted {
		margin-top: 4px;
		font-size: 14px;
		line-height: 20px;
		color: var(--muted);
	}
	.state {
		margin: 18px;
		padding: 20px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
		font-size: 14px;
	}
	.empty {
		display: grid;
		gap: 8px;
		padding-top: 40px;
	}

	/* ---------- Desktop: Figma frame 013 ---------- */
	@media (min-width: 900px) {
		.desktop {
			display: revert;
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
		.title {
			font-size: 18px;
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
		.grid {
			display: grid;
			grid-template-columns: minmax(0, 720px) 392px;
			gap: 24px;
			align-items: start;
			margin-top: 24px;
		}
		.progress {
			display: grid;
			grid-template-columns: 1fr 300px;
			grid-template-areas: 'label map' 'rows map';
			grid-template-rows: auto 1fr;
			column-gap: 24px;
			min-height: 552px;
			padding: 23px;
			border: 1px solid var(--line);
			border-radius: 16px;
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
		.rows,
		.progress > .state {
			grid-area: rows;
			margin: 0;
			padding: 24px 0 0;
		}
		.rows li {
			min-height: 88px;
			padding-left: 44px;
		}
		.name {
			font-size: 18px;
			color: var(--ink);
		}
		.passed .name {
			color: var(--muted);
		}
		.sub {
			margin-top: 6px;
			font-size: 14px;
		}
		aside {
			gap: 24px;
			padding: 0;
		}
		aside .card {
			padding: 23px;
			border-radius: 16px;
		}
		.about-title {
			margin-top: 20px;
			font-size: 24px;
			line-height: 30px;
		}
		.muted {
			margin-top: 14px;
			font-size: 16px;
			line-height: 24px;
		}
	}
</style>
