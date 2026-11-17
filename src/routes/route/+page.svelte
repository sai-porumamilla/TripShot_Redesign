<script>
	import RouteMap from '#lib/RouteMap.svelte';
	import { getJSON } from '#lib/api.js';
	import { distanceM, nearbyStops, shortName, textOn, walkMinutes } from '#lib/departures.js';
	import { here, locate } from '#lib/here.svelte.js';
	import { nearestIndex, pathBetween, pickVehicle, progressRows } from '#lib/route.js';
	import { applyDelay, applyServiceChange, delayFrom, scenarioFrom } from '#lib/serviceChanges.js';
	import { planTrips } from '#lib/trips.js';
	import { connection } from '#lib/connection.svelte.js';
	import places from '#lib/places.json';
	import backWhite from '#lib/assets/icons/back-white.svg';
	import busWhite from '#lib/assets/icons/bus-white.svg';
	import busInk from '#lib/assets/icons/bus-ink.svg';
	import alertBell from '#lib/assets/icons/alert-bell.svg';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	/** @typedef {{ id: string, name: string, loc: number[] }} Stop */
	let params = $state(
		/** @type {{ id: string, stop: string | null, to: string | null, place: string | null, after: number } | null} */ (
			null
		)
	);
	let detail = $state(
		/** @type {{ name: string, color: string, stops: Stop[], path: number[][] } | null} */ (null)
	);
	let live = $state(/** @type {{ vehicles: import('#lib/route.js').Vehicle[] } | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	let change = $state(/** @type {import('#lib/serviceChanges.js').ServiceChange | null} */ (null));
	let query = $state(''); // carried on to the on-board screen (destination, scenario, final walk)
	let delayReplay = $state(
		/** @type {{ minutes: number, reason: string, note: string } | null} */ (null)
	);
	let delayOn = $state(false);
	let noReplay = $state(''); // this page's query without the delay replay
	let conn = $state(/** @type {ReturnType<typeof connection>} */ (null)); // second shuttle, if any

	onMount(() => {
		// read the query in the browser: the page is prerendered without one
		const q = new URLSearchParams(location.search);
		query = location.search;
		change = scenarioFrom(location.search);
		delayReplay = delayFrom(location.search);
		noReplay = `?${new URLSearchParams([...q].filter(([k]) => k !== 'delay'))}`;
		// the replayed delay hits a few seconds in, so you see the ETA change like it would live
		const hit = delayReplay && setTimeout(() => (delayOn = true), 8000);
		conn = connection(Object.fromEntries(q));
		const id = q.get('id');
		if (!id) return void (failed = true);
		params = {
			id,
			stop: q.get('stop'),
			to: q.get('to'),
			place: q.get('place'),
			after: Number(q.get('after')) || 0
		};
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
		return () => (
			clearInterval(poll),
			clearInterval(tick),
			hit && clearTimeout(hit),
			conn?.dispose()
		);
	});

	// Apply an active service change: the closed stop is replaced by the temporary one
	const view = $derived(
		detail && change
			? applyServiceChange(change, detail.stops, [{ vehicles: live?.vehicles ?? [] }])
			: null
	);
	const routeStops = $derived(view?.closed ? view.stops : (detail?.stops ?? []));
	const vehicles = $derived.by(() => {
		const v = view?.closed ? view.routes[0].vehicles : (live?.vehicles ?? []);
		return delayOn && delayReplay ? applyDelay(v, delayReplay.minutes) : v;
	});
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
	// two shuttles: when this bus reaches the change stop, and the next one you can catch there
	const changeAt = $derived.by(() => {
		const d = dest;
		const n =
			conn && d
				? pick?.vehicle.next.find((s) => s.stopId.toLowerCase() === d.id.toLowerCase())
				: null;
		return n ? Date.parse(n.eta) : null;
	});
	const connNext = $derived(conn && changeAt !== null ? conn.next(changeAt) : null);
	const walk = $derived(your ? walkMinutes(distanceM(here.loc, your.loc)) : 0);
	// "Snooze 1 bus" skips the bus you were going to catch
	let skipped = $state(/** @type {string[]} */ ([]));
	const pick = $derived(
		live && your
			? pickVehicle(
					vehicles.filter((v) => !skipped.includes(v.name)),
					your.id,
					now
				)
			: null
	);
	const eta = $derived(pick ? Date.parse(pick.at.eta) : null);
	const minutes = $derived(eta === null ? null : Math.max(0, Math.round((eta - now) / 60000)));
	const rows = $derived(
		pick && your ? progressRows(pick.vehicle.next, your.id, dest?.id ?? null) : []
	);
	const seenAgo = $derived(
		pick ? Math.max(0, Math.round((now - Date.parse(pick.vehicle.seen)) / 1000)) : null
	);
	const stale = $derived(seenAgo !== null && seenAgo > 90);

	// Delay: the ETA has slipped 3+ min past the first one we saw for this bus at your stop.
	// (TripShot's own "Delayed" flag is set on nearly every bus, so it isn't used.)
	const firstEta = $state(/** @type {Record<string, number>} */ ({}));
	const etaKey = $derived(pick && your ? `${pick.vehicle.name}@${your.id}` : '');
	$effect(() => {
		if (etaKey && eta !== null && !(etaKey in firstEta)) firstEta[etaKey] = eta;
	});
	const slip = $derived(
		eta !== null && etaKey in firstEta ? Math.round((eta - firstEta[etaKey]) / 60000) : 0
	);
	const late = $derived(slip >= 3);
	let keptAlert = $state(false);

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

	// "Still faster?" when late: keep waiting, another route, or walk (needs a destination)
	let all = $state(/** @type {{ routes: any[], stops: Stop[] } | null} */ (null));
	$effect(() => {
		if (!late || !dest || all) return;
		Promise.all([getJSON('/live'), getJSON('/stops')]).then(
			([l, st]) => (all = { routes: l.routes, stops: st }),
			() => {}
		);
	});
	const options = $derived.by(() => {
		const arrive = rows.at(-1)?.kind === 'dest' ? Date.parse(rows[rows.length - 1].eta) : null;
		if (!all || !dest || arrive === null || !params) return [];
		const goal =
			/** @type {{ name: string, loc: number[] }[]} */ (places).find(
				(p) => p.name === params?.place
			)?.loc ?? dest.loc;
		// ponytail: the comparison uses /live as fetched once when the delay is noticed
		const plan = planTrips(all.routes, all.stops, here.loc, goal, now);
		const other = plan.shuttles.find((t) => t.route.id.toLowerCase() !== params?.id.toLowerCase());
		return [
			{
				label: `Wait for ${name}`,
				sub: 'Keep your current trip',
				at: arrive + params.after * 60000
			},
			...(other
				? [
						{
							label: `${shortName(other.route.name)} from ${other.board.name}`,
							sub: 'Alternative shuttle',
							at: other.arriveAt
						}
					]
				: []),
			{ label: 'Walk', sub: 'No shuttle needed', at: plan.walk.arriveAt }
		];
	});

	// "Tell me when to leave": bus arrival − your walk − 1 min buffer, recomputed as the ETA moves
	let alertOn = $state(false);
	let fired = $state(false);
	let gone = $state(false); // "On my way": the leave-now card is dismissed
	let base = $state(/** @type {number | null} */ (null)); // minutes away when the alert was set
	const leaveAt = $derived(eta === null ? null : eta - (walk + 1) * 60000);
	$effect(() => {
		if (!alertOn || fired || leaveAt === null || now < leaveAt) return;
		fired = true;
		if ('Notification' in window && Notification.permission === 'granted')
			new Notification(`Leave now for ${your?.name}`, {
				body: `${name} is ${minutes} min away. Your walk is ${walk} min.`
			});
	});
	// the bus slipped after "Leave now" went off: re-arm the alert for the new time ("Alert moved")
	$effect(() => {
		if (alertOn && fired && leaveAt !== null && leaveAt - now > 60000) fired = false;
	});
	async function toggleAlert() {
		if (late && alertOn && !keptAlert) return void (keptAlert = true); // "Keep my alert"
		if (!alertOn && 'Notification' in window && Notification.permission === 'default')
			await Notification.requestPermission();
		alertOn = !alertOn;
		fired = gone = false;
		base = minutes;
	}
	// the bus after this one, for "Snooze 1 bus"
	const later = $derived(
		pick && your
			? pickVehicle(
					vehicles.filter((v) => v !== pick.vehicle && !skipped.includes(v.name)),
					your.id,
					now
				)
			: null
	);
	function snooze() {
		if (!pick || !later) return;
		skipped = [...skipped, pick.vehicle.name];
		fired = gone = false;
		base = Math.max(1, Math.round((Date.parse(later.at.eta) - now) / 60000));
	}
	const approach = $derived(
		base && minutes !== null ? Math.min(1, Math.max(0, 1 - minutes / base)) : 0
	);

	// Back returns to wherever you came from in the app (Now, My trips, Routes);
	// opened from a shared link, it falls through to the href (Running now).
	let inApp = false;
	afterNavigate(({ from }) => (inApp = !!from));
	const back = (/** @type {MouseEvent} */ e) => {
		if (!inApp) return;
		e.preventDefault();
		history.back();
	};
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
			<a class="back" href={resolve('/')} onclick={back} aria-label="Back"
				><img src={backWhite} alt="" width="16" height="28" /></a
			>
			<div class="arrival-main">
				<p class="title">{title}</p>
				<p class="headline" aria-live="polite">{headline}</p>
			</div>
			{#if fresh}
				<div class="pills">
					<span class="pill" class:stale>{fresh}</span>
					<span class="pill" class:late>{late ? `Delayed ${slip} min` : 'On time'}</span>
				</div>
			{/if}
		</header>

		{#if conn?.name}
			<p class="then" style:--then={conn.color}>
				<span>
					Then change to <strong>{conn.name}</strong> at {dest?.name ?? 'your stop'}{connNext
						? ` · next one ~${clock(connNext)}`
						: ''}
				</span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- connection() builds on resolve('/route') -->
				<a href={conn.href}>See {conn.name} live</a>
			</p>
		{/if}

		{#if delayReplay}
			<p class="replay">
				{delayReplay.note} <a href="{resolve('/route')}/{noReplay}">Exit replay</a>
			</p>
		{/if}

		{#if fired && !gone}
			<section class="leave" role="alert" aria-labelledby="leave-title">
				<p class="leave-label">TripShot · now</p>
				<h2 id="leave-title">Leave now for {your?.name}</h2>
				<p class="leave-text">{name} is {minutes} min away. Your walk is {walk} min.</p>
				<div class="track" aria-hidden="true"><span style:width="{approach * 100}%"></span></div>
				<p class="ends"><span>{busNext ?? 'Bus'}</span><span>Your stop</span></p>
				<div class="leave-actions">
					<button class="go" onclick={() => ((gone = true), (alertOn = false))}>On my way</button>
					<button class="snooze" onclick={snooze} disabled={!later}>
						{later ? 'Snooze 1 bus' : 'No later bus yet'}
					</button>
				</div>
				<p class="leave-note">Your {walk} min walk from {here.name} is already counted.</p>
			</section>
		{/if}

		<div class="grid">
			{#if late}
				<div class="delay">
					<div class="changed">
						<p class="label desktop">What changed</p>
						<p class="changed-title">
							ETA changed: {Math.max(0, (minutes ?? 0) - slip)} min → {minutes} min
						</p>
						<p class="changed-text">
							{delayReplay?.reason ??
								(stale
									? 'The bus hasn’t reported its location recently.'
									: 'The bus is moving and still reporting its location. This isn’t a cancellation.')}
						</p>
					</div>
					<p class="moved phone">
						<img src={alertBell} alt="" width="18" height="23" />
						<span>
							<strong
								>{alertOn && leaveAt !== null
									? `Alert moved to ${clock(leaveAt)}`
									: 'Wait inside'}</strong
							>
							{alertOn
								? 'Stay inside. We’ll tell you when to leave.'
								: 'Turn on a leave-now alert and we’ll tell you when to go.'}
						</span>
					</p>
					{#if options.length}
						<div class="compare">
							<p class="label">Still faster?</p>
							<p class="desktop compare-title">Your options, side by side</p>
							<ul>
								{#each options as o, i (o.label)}
									<li class:current={i === 0}>
										<span><strong>{o.label}</strong><span class="desktop">{o.sub}</span></span>
										<strong class="when">~{clock(o.at)}</strong>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}

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
						<img src={alertBell} alt="" width="18" height="23" />{late
							? 'Alert updated'
							: 'Make the wait yours'}
					</p>
					{#if late && alertOn && leaveAt !== null}
						<p class="desktop alert-title">Alert moved to {clock(leaveAt)}</p>
						<p class="desktop alert-text">Stay inside. We’ll tell you when to leave.</p>
					{:else}
						<p class="desktop alert-title">No need to watch the route.</p>
						<p class="desktop alert-text">
							Get alerted based on your {walk} min walk to {your?.name ?? 'your stop'}.
						</p>
					{/if}
					<button
						class="action"
						class:on={alertOn}
						onclick={toggleAlert}
						disabled={leaveAt === null}
					>
						{alertOn
							? late && !keptAlert
								? 'Keep my alert'
								: 'Cancel alert'
							: 'Tell me when to leave'}
					</button>
					{#if dest && pick}
						<a
							class="onboard"
							href="{resolve('/trip')}/{query}&bus={encodeURIComponent(pick.vehicle.name)}"
							onclick={() =>
								// ask now, while there's a tap: the on-board alert needs it later
								'Notification' in window &&
								Notification.permission === 'default' &&
								Notification.requestPermission()}>I’m on the bus</a
						>
					{/if}
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
	:global(:root[data-theme='night']) .arrival {
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line);
	}
	:global(:root[data-theme='night']) .title {
		color: var(--accent);
	}
	:global(:root[data-theme='night']) .back img {
		filter: none;
	}
	/* bus icons are drawn white / gray: flip them to stay visible on dark */
	:global(:root[data-theme='night']) .bus-chip img,
	:global(:root[data-theme='night']) .busrow > img {
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
		background: var(--pill);
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
	/* two shuttles: where to change, under the header */
	.then {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		margin: 12px 18px 0;
		padding: 12px 14px;
		border-left: 6px solid var(--then);
		border-radius: 12px;
		background: var(--surface);
		font-size: 15px;
		line-height: 20px;
	}
	.then a {
		font-weight: 700;
		color: var(--ink);
	}
	.replay {
		margin: 8px 18px 0;
		font-size: 12px;
		line-height: 16px;
		color: var(--muted);
	}
	.replay a {
		color: inherit;
		font-weight: 700;
	}
	/* Leave-now alert (Figma frames 6 / 06): styled like the lock-screen notification */
	.leave {
		margin: 12px 18px 0;
		padding: 16px;
		border-radius: 16px;
		background: #222838;
		color: #fff;
	}
	:global(:root[data-theme='night']) .leave {
		border: 1px solid var(--accent);
	}
	.leave-label {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.8px;
		text-transform: uppercase;
		color: #c9cdd6;
	}
	.leave h2 {
		margin-top: 8px;
		font-size: 20px;
		line-height: 26px;
	}
	.leave-text {
		margin-top: 8px;
		font-size: 15px;
		line-height: 21px;
	}
	.leave .track {
		height: 8px;
		margin-top: 14px;
		border-radius: 4px;
		background: rgb(255 255 255 / 0.2);
		overflow: hidden;
	}
	.leave .track span {
		display: block;
		height: 100%;
		background: #fff;
		transition: width 0.6s ease;
	}
	.leave .ends {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		font-size: 13px;
		color: #c9cdd6;
	}
	.leave-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 14px;
	}
	.leave-actions button {
		height: 44px;
		border: 0;
		border-radius: 10px;
		font-weight: 700;
		cursor: pointer;
	}
	.go {
		background: var(--action);
		color: var(--on-action);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.4);
	}
	.snooze {
		background: #edf0f5;
		color: #16181c;
	}
	.snooze:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.leave-note {
		margin-top: 10px;
		font-size: 13px;
		color: #c9cdd6;
	}
	/* Delay explained (Figma frames 5 / 05) */
	.delay {
		display: grid;
		gap: 12px;
		margin: 12px 18px 0;
	}
	.changed {
		padding: 14px 16px;
		border: 1px solid #f3c47a;
		border-radius: 12px;
		background: var(--notice-bg);
		color: var(--notice-ink);
	}
	.changed-title {
		font-size: 17px;
		font-weight: 700;
		line-height: 22px;
	}
	.changed-text {
		margin-top: 4px;
		font-size: 14px;
		line-height: 19px;
	}
	.moved {
		display: flex;
		gap: 12px;
		align-items: start;
		padding: 14px 16px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
		font-size: 14px;
		line-height: 19px;
		color: var(--muted);
	}
	.moved span {
		display: grid;
		gap: 2px;
	}
	.moved strong {
		font-size: 16px;
		color: var(--ink);
	}
	.compare > .label {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.compare ul {
		margin-top: 8px;
		padding: 6px 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface);
	}
	.compare li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 14px;
		font-size: 15px;
		color: var(--muted);
	}
	.compare li strong {
		font-weight: 400;
	}
	.compare li.current {
		color: var(--ink);
	}
	.compare li.current strong {
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
		background: var(--line-strong);
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
		border-left: 4px dashed var(--line-strong);
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
	.yours .sub {
		color: var(--accent);
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
		color: var(--on-action);
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
	.onboard {
		display: grid;
		place-items: center;
		height: 44px;
		margin-top: 8px;
		border: 2px solid var(--ink);
		border-radius: 12px;
		color: var(--ink);
		font-weight: 700;
		text-decoration: none;
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
		.replay {
			margin: 10px 0 0;
		}
		.then {
			margin: 16px 0 0;
			padding: 16px 20px;
			border: 1px solid var(--line);
			border-left: 6px solid var(--then);
			border-radius: 16px;
			font-size: 17px;
		}
		.leave {
			margin: 16px 0 0;
			padding: 24px 28px;
		}
		.leave h2 {
			font-size: 32px;
			line-height: 40px;
		}
		.leave-text {
			font-size: 17px;
		}
		.leave-actions {
			max-width: 520px;
		}
		.leave-actions button {
			height: 48px;
		}
		.delay {
			grid-column: 1;
			gap: 24px;
			margin: 0;
		}
		.progress {
			grid-column: 1;
		}
		/* the alert column runs alongside the delay cards and the route progress */
		.grid > aside {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
		.changed {
			padding: 23px;
			border-radius: 16px;
		}
		.changed .label {
			color: var(--muted);
		}
		.changed-title {
			margin-top: 18px;
			font-size: 28px;
			line-height: 35px;
		}
		.changed-text {
			margin-top: 12px;
			font-size: 17px;
			line-height: 26px;
		}
		.compare {
			padding: 23px;
			border: 1px solid var(--line);
			border-radius: 16px;
			background: var(--surface);
		}
		.compare-title {
			margin-top: 8px;
			font-size: 22px;
			font-weight: 700;
		}
		.compare ul {
			margin-top: 16px;
			padding: 0;
			border: 0;
		}
		.compare li {
			align-items: center;
			padding: 12px 16px;
			border-radius: 10px;
			font-size: 18px;
			color: var(--ink);
		}
		.compare li > span {
			display: grid;
			gap: 4px;
		}
		.compare li > span span {
			font-size: 14px;
			color: var(--muted);
		}
		.compare li.current {
			background: var(--nav-active);
		}
		.compare .when {
			font-size: 22px;
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
			background: var(--surface);
		}
		.yours .dot {
			background: var(--accent);
			border-color: var(--accent);
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
			color: var(--accent);
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
