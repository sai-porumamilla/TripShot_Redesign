<script>
	// Screen 7 · On board: the active trip after you've boarded. Follows one bus (by name)
	// to your stop and alerts you one stop before it.
	import { getJSON } from '#lib/api.js';
	import { shortName, textOn } from '#lib/departures.js';
	import { here } from '#lib/here.svelte.js';
	import { tripProgress } from '#lib/route.js';
	import { applyServiceChange, scenarioFrom } from '#lib/serviceChanges.js';
	import { resolve } from '$app/paths';
	import { connection } from '#lib/connection.svelte.js';
	import { recalled, remember } from '#lib/rode.js';
	import { onMount } from 'svelte';

	/** @typedef {{ id: string, name: string, loc: number[] }} Stop */
	let q = $state(/** @type {Record<string, string> | null} */ (null));
	let detail = $state(/** @type {{ name: string, color: string, stops: Stop[] } | null} */ (null));
	let live = $state(/** @type {{ vehicles: import('#lib/route.js').Vehicle[] } | null} */ (null));
	let failed = $state(false);
	let now = $state(Date.now());
	let change = $state(/** @type {import('#lib/serviceChanges.js').ServiceChange | null} */ (null));
	// two shuttles: the second one (see connection.svelte.js)
	let conn = $state(/** @type {ReturnType<typeof connection>} */ (null));

	onMount(() => {
		// read the query in the browser: the page is prerendered without one
		q = Object.fromEntries(new URLSearchParams(location.search));
		change = scenarioFrom(location.search);
		conn = connection(q);
		rode = recalled(q);
		const id = q.id;
		if (!id || !q.stop || !q.to) return void (failed = true);
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
		const tick = setInterval(() => (now = Date.now()), 5000);
		try {
			shareName = localStorage.getItem('shareName') ?? '';
			saved = JSON.parse(localStorage.getItem('savedTrips') ?? '[]');
		} catch {
			// private mode or blocked storage: saving just won't persist
		}
		return () => (clearInterval(poll), clearInterval(tick), conn?.dispose());
	});

	// Same service-change layer as the live route page
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
	// On a loop the bus comes round again: once you've ridden past your boarding stop, seeing it
	// ahead again means it has passed your stop (see tripProgress). Kept across reloads (rode.js).
	let rode = $state(false);
	const board = $derived(q ? stopOf(q.stop) : undefined);
	const dest = $derived(q ? stopOf(q.to) : undefined);
	const prog = $derived(
		bus && board && dest
			? tripProgress(
					bus.next,
					stops.map((s) => s.id),
					board.id,
					dest.id,
					rode
				)
			: null
	);
	// the bus has left your boarding stop (before that, "I'm on the bus" was tapped early)
	const boarded = $derived(!!prog?.rows[0].passed);
	$effect(() => {
		if (boarded && !rode && q) ((rode = true), remember(q, destEta));
	});
	const arrived = $derived(!!prog?.arrived);
	const nextRow = $derived(prog?.rows.find((r, i) => i > 0 && !r.passed));
	const destEta = $derived(prog?.rows.at(-1)?.eta);
	// when the second shuttle next leaves the change stop: after you get there, or from now once you're there
	const connNext = $derived(
		!conn
			? null
			: arrived
				? conn.next(now - 60000)
				: destEta
					? conn.next(Date.parse(destEta))
					: null
	);

	const after = $derived(Number(q?.after) || 0);
	const place = $derived(q?.place || dest?.name || '');
	const name = $derived(detail ? shortName(detail.name) : '');
	const night = $derived(/night ?ride/i.test(name));

	const clock = (/** @type {string} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const headline = $derived(
		!prog
			? 'Your trip'
			: arrived
				? conn?.name
					? `Change here: ${conn.name}`
					: `You’ve arrived at ${dest?.name}`
				: prog.left === 1 && boarded
					? `Next stop: ${dest?.name}`
					: `${prog.left} ${prog.left === 1 ? 'stop' : 'stops'} to ${dest?.name}`
	);
	const done = $derived(arrived ? 1 : prog ? (prog.total - prog.left) / prog.total : 0);

	// "Alert me 1 stop before": goes off when the bus reaches the stop before yours
	let alertOn = $state(true);
	let fired = $state(false);
	const alertName = $derived(prog?.alertAt ? stopOf(prog.alertAt)?.name : null);
	$effect(() => {
		if (!alertOn || fired || !prog || !boarded || arrived || prog.left > 1) return;
		fired = true;
		navigator.vibrate?.([300, 150, 300]);
		if ('Notification' in window && Notification.permission === 'granted')
			new Notification(`Your stop is next: ${dest?.name}`, {
				body: conn?.name
					? `Get off there and change to ${conn.name}.`
					: `Get ready to get off${after ? `, then walk ${after} min to ${place}` : ''}.`
			});
	});
	async function toggleAlert() {
		alertOn = !alertOn;
		if (alertOn && 'Notification' in window && Notification.permission === 'default')
			await Notification.requestPermission();
	}

	// Heads up for later: NightRide is the way back after day routes stop (design hours, campus time)
	const hour = $derived(
		Number(
			new Date(now).toLocaleString('en-US', {
				timeZone: 'America/New_York',
				hour: 'numeric',
				hourCycle: 'h23'
			})
		)
	);
	const nightRide = $derived(
		/^southwest/i.test(name)
			? 'Southwest NightRide'
			: /^north/i.test(name)
				? 'North NightRide'
				: 'NightRide North or Southwest'
	);
	const headsUp = $derived(
		night
			? 'NightRide runs until 2 AM. Plan your trip back before then.'
			: hour >= 7 && hour < 22
				? `Day routes end at 10 PM. For a late trip back to campus, take ${nightRide} (10 PM–2 AM).`
				: null
	);

	// Save this trip so it's one tap next time (kept in this browser only)
	let saved = $state(/** @type {{ to: string }[]} */ ([]));
	const isSaved = $derived(saved.some((t) => t.to === place));
	const tripName = $derived(`${here.real ? 'Here' : here.name.split(' ')[0]} → ${place}`);
	function save() {
		saved = isSaved ? saved.filter((t) => t.to !== place) : [...saved, { to: place }];
		try {
			localStorage.setItem('savedTrips', JSON.stringify(saved));
		} catch {
			// storage blocked: kept for this visit only
		}
	}

	// Share my ride (Figma frames 12 / 012): a link a friend opens to follow this bus — the bus,
	// never this phone's location — until you get off. No server: everything is in the link.
	let sharing = $state(false);
	let shareName = $state('');
	let shared = $state('');
	const sharer = $derived(shareName.trim());
	const shareText = $derived(
		`${sharer ? `${sharer} is` : 'I’m'} riding ${name} to ${dest?.name}. Follow along until ${sharer ? 'they get' : 'I get'} off:`
	);
	const shareUrl = $derived.by(() => {
		if (!q || !destEta) return '';
		const params = new URLSearchParams({
			id: q.id,
			bus: q.bus,
			stop: q.stop,
			to: q.to,
			place,
			after: String(after),
			// the link stops an hour after the expected arrival (room for a delay)
			until: String(Date.parse(destEta) + 60 * 60000),
			...(sharer && { name: sharer }),
			...(q.scenario && { scenario: q.scenario })
		});
		return `${location.origin}${resolve('/ride')}/?${params}`;
	});
	function rememberName() {
		try {
			localStorage.setItem('shareName', sharer);
		} catch {
			// storage blocked: the name is just not remembered
		}
	}
	async function copy() {
		rememberName();
		try {
			await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
			shared = 'Link copied. Paste it into a message.';
		} catch {
			shared = 'Couldn’t copy automatically. Select the link above and copy it.';
		}
	}
	async function share() {
		rememberName();
		if (!navigator.share) return copy();
		try {
			await navigator.share({ title: 'Follow my ride', text: shareText, url: shareUrl });
			shared = 'Shared.';
		} catch {
			// the share sheet was closed: nothing to do
		}
	}
</script>

<svelte:head>
	<title>{prog ? headline : 'Active trip'} · TripShot</title>
</svelte:head>

{#if failed && !detail}
	<div class="empty">
		<h1>Trip unavailable</h1>
		<p>We couldn’t load this trip right now.</p>
		<a href={resolve('/')}>Back to running now</a>
	</div>
{:else}
	<div
		class="page"
		style:--route={detail?.color ?? '#16181c'}
		style:--on-route={textOn(detail?.color ?? '#16181c')}
	>
		<div class="desktop heading">
			<h1>
				{arrived ? (conn?.name ? 'Change here' : 'You’re here') : 'On board, heading home'}
			</h1>
			<p>Active trip · {name}</p>
		</div>

		<header class="trip-head">
			<p class="bar">
				<span class="tag">● Active trip · {name}</span>
				{#if destEta && !arrived}<span class="arrive phone">Arrive ~{clock(destEta)}</span>{/if}
			</p>
			<div class="head-main">
				<h1 class="headline" aria-live="polite">{headline}</h1>
				<p class="desktop lede">
					{arrived
						? conn?.name
							? `Catch ${conn.name} here${connNext ? ` · next one ~${clock(new Date(connNext).toISOString())}` : ''}.`
							: after
								? `Walk ${after} min to ${place}.`
								: 'Enjoy the rest of your night.'
						: conn?.name
							? `Then change to ${conn.name} at ${dest?.name}.`
							: 'You’re on board. Your destination stays in view.'}
				</p>
			</div>
			{#if destEta && !arrived}<span class="arrive desktop">Arrive ~{clock(destEta)}</span>{/if}
		</header>

		{#if fired && !arrived}
			<p class="stop-next appear" role="alert">
				Your stop is next. Get ready to get off at {dest?.name}{conn?.name
					? ` and change to ${conn.name}`
					: ''}.
			</p>
		{/if}

		{#if !prog}
			<p class="state">
				{failed
					? 'Live bus data is unavailable right now.'
					: live && detail && !bus
						? 'We lost this bus’s live signal. Watch for your stop: ' + (dest?.name ?? '')
						: 'Finding your bus…'}
			</p>
		{:else}
			<div class="grid">
				<section class="card progress" aria-labelledby="progress-title">
					<h2 id="progress-title" class="desktop label">Your trip progress</h2>
					<p class="desktop leg">{board?.name} → {dest?.name}</p>
					<div
						class="track"
						role="progressbar"
						aria-label="Trip progress"
						aria-valuemin="0"
						aria-valuemax={prog.total}
						aria-valuenow={prog.total - prog.left}
						aria-valuetext="{prog.left} of {prog.total} stops left"
					>
						<span style:width="{done * 100}%"></span>
					</div>
					<p class="ends"><span>{board?.name}</span><span>{dest?.name}</span></p>

					<ol class="rows desktop">
						{#each prog.rows as r, i (r.stopId)}
							{@const last = i === prog.rows.length - 1}
							<li class:passed={r.passed && i > 0} class:now={r === nextRow} class:first={i === 0}>
								<div>
									<p class="name">{stopOf(r.stopId)?.name}</p>
									<p class="sub">
										{i === 0
											? boarded
												? 'Boarded with your Bearcat Card'
												: 'Board here with your Bearcat Card'
											: last
												? conn?.name
													? `Get off here · change to ${conn.name}`
													: `Get off here${after ? ` · then walk ${after} min` : ''}`
												: r.stopId === prog.alertAt && alertOn
													? 'Your one-stop-before alert vibrates here'
													: r.passed
														? 'Passed'
														: 'On the way'}
									</p>
								</div>
								<p class="time">
									{i === 0
										? r.passed
											? 'Boarded'
											: 'Boarding'
										: last && r.eta
											? `~${clock(r.eta)}`
											: r === nextRow
												? 'Next stop'
												: ''}
								</p>
							</li>
						{/each}
					</ol>
				</section>

				<aside>
					<div class="card alert">
						<p class="desktop label">Stop alert</p>
						<label class="toggle">
							<span>
								<strong>Alert me 1 stop before</strong>
								<span class="muted">
									{alertName ? `Vibrates at ${alertName}` : 'Vibrates when your stop is next'}
								</span>
							</span>
							<input type="checkbox" checked={alertOn} onchange={toggleAlert} />
						</label>
						<p class="desktop status">{alertOn ? 'Enabled' : 'Off'}</p>
					</div>

					{#if sharing}
						<button
							class="backdrop backdrop-in phone"
							aria-label="Close"
							onclick={() => (sharing = false)}
						></button>
						<div class="card share sheet-in" role="dialog" aria-labelledby="share-title">
							<p class="desktop label">Share my ride</p>
							<h2 id="share-title" class="share-title">
								<span class="phone">Share my ride</span><span class="desktop"
									>Let a friend follow this bus</span
								>
							</h2>
							<p class="phone muted">A friend can follow your bus until you get off.</p>
							<label class="field">
								<span>Your name (optional)</span>
								<input bind:value={shareName} autocomplete="given-name" />
							</label>
							<div class="preview">
								<p>{shareText}</p>
								<p class="url">{shareUrl}</p>
							</div>
							<div class="share-actions">
								<button class="primary" onclick={share}>Share…</button>
								<button class="secondary" onclick={copy}>Copy link</button>
							</div>
							{#if shared}<p class="shared" role="status">{shared}</p>{/if}
							<p class="fine">Shows the bus, not your location. The link stops after your trip.</p>
							<button class="link" onclick={() => (sharing = false)}>Close</button>
						</div>
					{:else}
						{#if conn?.name}
							<div class="card change" style:--then={conn.color}>
								<p class="label">Change here</p>
								<p class="change-title">Change to {conn.name} at {dest?.name}</p>
								<p class="heads-text">
									{connNext
										? `Next ${conn.name} leaves ~${clock(new Date(connNext).toISOString())}${
												arrived
													? `, in ${Math.max(0, Math.round((connNext - now) / 60000))} min`
													: destEta
														? `, ${Math.max(1, Math.round((connNext - Date.parse(destEta)) / 60000))} min after you get there`
														: ''
											}.`
										: conn.checked
											? `No ${conn.name} is reporting right now. Check its live route before you get off.`
											: `Checking the next ${conn.name}…`}
								</p>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- connection() builds on resolve('/route') -->
								<a class="go" href={conn.href}>See {conn.name} live</a>
							</div>
						{:else if headsUp}
							<div class="card heads-up">
								<p class="label">Heads up for later</p>
								<p class="desktop heads-title">Heading back later?</p>
								<p class="heads-text">{headsUp}</p>
							</div>
						{/if}

						<button class="card save" onclick={save} aria-pressed={isSaved}>
							<span class="star" aria-hidden="true">{isSaved ? '★' : '☆'}</span>
							{isSaved ? `Saved “${tripName}”` : `Save “${tripName}” trip`}
						</button>

						{#if !arrived}
							<button class="share-open" onclick={() => ((sharing = true), (shared = ''))}
								>Share my ride</button
							>
						{/if}
					{/if}

					<a class="end" href={resolve('/')}>{arrived ? 'Done' : 'End trip'}</a>
				</aside>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ---------- Phone (default): Figma frame 7, at 1× ---------- */
	.desktop {
		display: none;
	}
	.trip-head {
		color: var(--on-route);
	}
	.bar {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: var(--route);
		font-size: 14px;
		font-weight: 700;
		line-height: 18px;
	}
	.arrive {
		flex: none;
		white-space: nowrap;
	}
	.headline {
		margin-top: 18px;
		font-size: 28px;
		line-height: 34px;
		color: var(--ink);
	}
	.stop-next {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--ink);
		color: var(--surface);
		font-weight: 700;
	}
	.track {
		height: 8px;
		margin-top: 18px;
		border-radius: 4px;
		background: var(--line);
		overflow: hidden;
	}
	.track span {
		display: block;
		height: 100%;
		background: var(--route);
		transition: width 300ms var(--ease-in-out);
	}
	.ends {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		font-size: 13px;
		color: var(--muted);
	}
	aside {
		display: grid;
		gap: 12px;
		margin-top: 18px;
	}
	.card {
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
	}
	.progress {
		padding: 0;
		background: none;
		border: 0;
	}
	.toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		cursor: pointer;
	}
	.toggle > span {
		display: grid;
		gap: 2px;
	}
	.toggle strong {
		font-size: 16px;
	}
	.toggle input {
		width: 24px;
		height: 24px;
		accent-color: var(--action);
	}
	.muted {
		font-size: 14px;
		color: var(--muted);
	}
	.label {
		font-size: 12px;
		font-weight: 700;
		line-height: 18px;
		letter-spacing: 0.8px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.heads-text {
		margin-top: 4px;
		font-size: 15px;
		line-height: 21px;
	}
	.save {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.star {
		font-size: 22px;
		line-height: 1;
	}
	.change {
		display: grid;
		gap: 6px;
		border-left: 6px solid var(--then);
	}
	.change-title {
		font-size: 17px;
		font-weight: 700;
	}
	.go {
		display: grid;
		place-items: center;
		height: 46px;
		margin-top: 6px;
		border-radius: 12px;
		background: var(--action);
		color: var(--on-action);
		font-weight: 700;
		text-decoration: none;
	}
	.share-open {
		height: 48px;
		border: 2px solid var(--ink);
		border-radius: 12px;
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
	}
	/* the share panel: a bottom sheet on phones */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
		border: 0;
		background: rgb(0 0 0 / 0.45);
	}
	.share {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 901;
		display: grid;
		gap: 12px;
		padding: 20px 20px calc(24px + var(--safe-bottom));
		border: 0;
		border-radius: 20px 20px 0 0;
	}
	.share-title {
		font-family: 'Inter', sans-serif;
		font-size: 22px;
	}
	.field {
		display: grid;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.field input {
		height: 44px;
		padding: 0 12px;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--surface);
		font-size: 16px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--ink);
	}
	.preview {
		display: grid;
		gap: 4px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--chip);
		font-size: 15px;
		line-height: 21px;
	}
	.url {
		overflow: hidden;
		font-size: 13px;
		font-weight: 700;
		color: var(--live);
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: all;
	}
	.share-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.primary,
	.secondary {
		height: 46px;
		border-radius: 12px;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
	}
	.primary {
		border: 0;
		background: var(--action);
		color: var(--on-action);
	}
	.secondary {
		border: 2px solid var(--ink);
		background: var(--surface);
		color: var(--ink);
	}
	.shared {
		font-size: 14px;
		color: var(--live);
	}
	.fine {
		font-size: 13px;
		color: var(--muted);
		text-align: center;
	}
	.link {
		justify-self: center;
		padding: 4px;
		border: 0;
		background: none;
		font: inherit;
		font-size: 14px;
		font-weight: 700;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.end {
		justify-self: center;
		padding: 8px;
		font-size: 14px;
		font-weight: 700;
		color: var(--muted);
	}
	.state {
		margin-top: 18px;
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
	/* night: a dark header with the amber accent, like the live route page */
	:global(:root[data-theme='night']) .bar {
		background: var(--surface);
		border: 1px solid var(--line);
		color: var(--accent);
	}

	/* ---------- Desktop: Figma frame 07 ---------- */
	@media (min-width: 900px) {
		.desktop {
			display: revert;
		}
		.phone {
			display: none;
		}
		.page {
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
		.trip-head {
			display: grid;
			grid-template-columns: 1fr auto;
			align-items: center;
			gap: 0 24px;
			margin-top: 31px;
			padding: 22px 28px 26px;
			border-radius: 16px;
			background: var(--route);
		}
		.bar {
			grid-column: 1 / -1;
			padding: 0;
			background: none;
			font-size: 18px;
		}
		.headline {
			margin-top: 14px;
			font-size: 36px;
			line-height: 44px;
			color: inherit;
		}
		.lede {
			margin-top: 12px;
			font-size: 16px;
		}
		.arrive.desktop {
			padding: 12px 42px;
			border-radius: 10px;
			background: var(--surface);
			color: var(--ink);
			font-size: 20px;
			font-weight: 700;
		}
		:global(:root[data-theme='night']) .trip-head {
			background: var(--surface);
			border: 1px solid var(--line);
			color: var(--ink);
		}
		:global(:root[data-theme='night']) .bar {
			border: 0;
		}
		:global(:root[data-theme='night']) .arrive.desktop {
			background: var(--pill);
		}
		.stop-next {
			margin-top: 16px;
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
			border-radius: 16px;
		}
		.progress {
			padding: 23px;
			background: var(--surface);
			border: 1px solid var(--line);
		}
		.leg {
			margin-top: 26px;
			font-size: 24px;
			font-weight: 700;
		}
		.track {
			height: 10px;
			margin-top: 26px;
			border-radius: 5px;
		}
		.ends {
			font-size: 14px;
		}
		.rows {
			margin-top: 40px;
		}
		.rows li {
			position: relative;
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 16px;
			padding: 0 0 48px 56px;
		}
		.rows li:last-child {
			padding-bottom: 8px;
		}
		/* the line between stops, and a dot on each */
		.rows li::before {
			content: '';
			position: absolute;
			left: 20px;
			top: 8px;
			bottom: -8px;
			border-left: 2px solid var(--line-strong);
		}
		.rows li:last-child::before {
			display: none;
		}
		.rows li::after {
			content: '';
			position: absolute;
			left: 11px;
			top: 2px;
			width: 20px;
			height: 20px;
			border: 1px solid var(--line);
			border-radius: 50%;
			background: var(--surface);
		}
		.rows li.first::after,
		.rows li.passed::after {
			background: var(--ink);
			border-color: var(--ink);
		}
		.name {
			font-size: 20px;
			font-weight: 700;
			line-height: 25px;
		}
		.passed .name {
			color: var(--muted);
			font-weight: 400;
		}
		.sub {
			margin-top: 8px;
			font-size: 16px;
			color: var(--muted);
		}
		.time {
			font-size: 14px;
			color: var(--muted);
		}
		.now .time {
			font-weight: 700;
			color: var(--ink);
		}
		aside {
			gap: 24px;
			margin: 0;
		}
		.alert .toggle {
			margin-top: 20px;
			align-items: start;
		}
		.alert .label {
			margin-bottom: -8px;
		}
		.toggle strong {
			font-size: 22px;
			line-height: 28px;
		}
		.toggle .muted {
			margin-top: 12px;
			font-size: 16px;
		}
		.status {
			margin-top: 14px;
			font-size: 14px;
			font-weight: 700;
			color: var(--live);
		}
		.heads-up {
			background: var(--notice-bg);
			border-color: transparent;
			color: var(--notice-ink);
		}
		.heads-title {
			margin-top: 20px;
			font-size: 22px;
			font-weight: 700;
			color: var(--ink);
		}
		.heads-text {
			margin-top: 14px;
			font-size: 16px;
			line-height: 24px;
		}
		.save {
			font-size: 18px;
		}
		.share {
			position: static;
			gap: 14px;
			padding: 23px;
			border: 2px solid var(--ink);
			border-radius: 16px;
		}
		.share-title {
			font-size: 20px;
		}
		.fine {
			text-align: left;
		}
	}
</style>
