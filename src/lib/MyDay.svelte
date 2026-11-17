<script>
	// "My day" (Figma frames 10 / 11): today's classes with when to leave for each, adding a
	// class by hand or from an .ics file, and saved trips. Shown on My trips before you search.
	import { textOn } from '#lib/departures.js';
	import { here } from '#lib/here.svelte.js';
	import { day, saveDay } from '#lib/myDay.svelte.js';
	import {
		classesOn,
		DAYS,
		matchPlace,
		parseIcs,
		planFor,
		sampleSchedule,
		upcoming
	} from '#lib/schedule.js';
	import { searchPlaces } from '#lib/trips.js';

	/**
	 * @type {{
	 *   routes: any[] | null,
	 *   stops: { id: string, name: string, loc: number[] }[],
	 *   now: number,
	 *   places: { name: string, loc: number[], kind: string }[],
	 *   saved: { to: string }[],
	 *   pick: (name: string) => void
	 * }}
	 */
	let { routes, stops, now, places, saved, pick } = $props();

	const next = $derived(upcoming(day.classes, now)[0]);
	const shown = $derived(next?.day ?? 0); // today, or the next day that has classes
	const rows = $derived(classesOn(day.classes, now, shown));
	const dayLabel = $derived(
		shown === 0
			? 'Today’s classes'
			: shown === 1
				? 'Tomorrow'
				: new Date(next?.at ?? now).toLocaleDateString([], { weekday: 'long' })
	);
	const clock = (/** @type {number} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const time = (/** @type {number} */ t) => clock(t).replace(/\s?[AP]M$/i, '');
	const ampm = (/** @type {number} */ t) => clock(t).match(/[AP]M$/i)?.[0] ?? '';
	const locOf = (/** @type {string} */ name) => places.find((p) => p.name === name)?.loc;
	const planOf = (/** @type {{ cls: import('#lib/schedule.js').Class, at: number }} */ r) => {
		const loc = locOf(r.cls.place);
		return loc && routes && stops.length && r.at > now
			? planFor(routes, stops, here.loc, loc, r.at, now)
			: null;
	};
	function remove(/** @type {import('#lib/schedule.js').Class} */ cls) {
		day.classes = day.classes.filter((c) => c !== cls);
		saveDay();
	}

	// ---- Add a class (bottom sheet on phones, side panel on desktop) ----
	const WEEK = /** @type {const} */ ([
		['MO', 'M', 'Monday'],
		['TU', 'T', 'Tuesday'],
		['WE', 'W', 'Wednesday'],
		['TH', 'R', 'Thursday'],
		['FR', 'F', 'Friday']
	]);
	let adding = $state(false);
	let name = $state('');
	let building = $state('');
	let placeName = $state('');
	let days = $state(/** @type {string[]} */ ([]));
	let start = $state('09:05');
	let error = $state('');
	const hits = $derived(
		building && building !== placeName ? searchPlaces(places, building, 5) : []
	);
	function open() {
		[adding, name, building, placeName, days, start, error] = [true, '', '', '', [], '09:05', ''];
	}
	function save() {
		error = !name.trim()
			? 'Add the class name.'
			: !placeName
				? 'Pick the building from the list.'
				: !days.length
					? 'Pick at least one day.'
					: !start
						? 'Add a start time.'
						: '';
		if (error) return;
		day.classes = [
			...day.classes,
			{
				id: String(Date.now()),
				name: name.trim(),
				place: placeName,
				days: DAYS.filter((d) => days.includes(d)),
				start
			}
		];
		saveDay();
		adding = false;
	}

	// ---- Import an .ics file ----
	let note = $state('');
	async function importIcs(/** @type {Event & { currentTarget: HTMLInputElement }} */ e) {
		const input = e.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		const found = parseIcs(await file.text());
		const added = found.map((c, i) => ({
			id: `${Date.now()}-${i}`,
			name: c.name,
			place: matchPlace(places, c.location)?.name ?? '',
			days: c.days,
			start: c.start
		}));
		day.classes = [...day.classes, ...added];
		saveDay();
		const missing = added.filter((c) => !c.place).length;
		note = !found.length
			? 'No classes found in that file.'
			: `Added ${found.length} ${found.length === 1 ? 'class' : 'classes'}.` +
				(missing
					? ` ${missing} ${missing === 1 ? 'needs' : 'need'} a building: remove and add ${missing === 1 ? 'it' : 'them'} by hand.`
					: '');
		input.value = '';
	}
	function sample() {
		day.classes = sampleSchedule(now);
		saveDay();
		note = '';
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (adding = false)} />

{#snippet form()}
	<form
		class="sheet"
		aria-labelledby="add-title"
		oninput={() => (error = '')}
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<h2 id="add-title">Add a class</h2>
		<label class="field">
			<span>Class</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={name} placeholder="INFO 3020" autocomplete="off" autofocus />
		</label>
		<div class="field">
			<label for="building">Building</label>
			<input
				id="building"
				bind:value={building}
				placeholder="Search campus buildings"
				autocomplete="off"
				oninput={() => (placeName = '')}
			/>
			{#if hits.length}
				<ul class="hits" aria-label="Matching buildings">
					{#each hits as p (p.name)}
						<li>
							<button type="button" onclick={() => (building = placeName = p.name)}
								><strong>{p.name}</strong><span>{p.kind}</span></button
							>
						</li>
					{/each}
				</ul>
			{:else if placeName}
				<p class="matched">✓ Matched: {placeName}</p>
			{/if}
		</div>
		<fieldset class="field">
			<legend>Days</legend>
			<div class="days">
				{#each WEEK as [code, letter, full] (code)}
					<button
						type="button"
						aria-pressed={days.includes(code)}
						aria-label={full}
						onclick={() => {
							days = days.includes(code) ? days.filter((d) => d !== code) : [...days, code];
							error = '';
						}}>{letter}</button
					>
				{/each}
			</div>
		</fieldset>
		<label class="field">
			<span>Starts at</span>
			<input type="time" bind:value={start} />
		</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button class="primary">Save class</button>
		<p class="foot">
			<button type="button" class="link" onclick={() => (adding = false)}>Cancel</button> · Saved in this
			browser only
		</p>
	</form>
{/snippet}

<div class="myday">
	<section aria-labelledby="day-title">
		<h2 id="day-title" class="label">{dayLabel}</h2>
		{#if rows.length}
			<ol class="timeline">
				{#each rows as r (r.cls.id)}
					{@const p = planOf(r)}
					<li class:next={r.at === next?.at} class:done={r.at <= now}>
						<p class="when">
							<strong>{time(r.at)}</strong><span
								>{ampm(r.at)}{r.at === next?.at ? ' · next' : ''}</span
							>
						</p>
						<div class="what">
							<p class="name">{r.cls.name}</p>
							<p class="place">{r.cls.place || 'Building not found'}</p>
							{#if r.at <= now}
								<p class="sub">Started</p>
							{:else if p?.kind === 'shuttle'}
								<p class="plan">
									<span class="chip dark">Leave by {clock(p.leaveAt)}</span><span
										class="chip"
										style:background={p.trip.route.color}
										style:color={textOn(p.trip.route.color)}>{p.trip.route.name}</span
									>{#if p.trip.change}<span
											class="chip"
											style:background={p.trip.change.route.color}
											style:color={textOn(p.trip.change.route.color)}
											>then {p.trip.change.route.name}</span
										>{/if}
								</p>
							{:else if p?.kind === 'walk'}
								<p class="plan">
									<span class="chip dark">Leave by {clock(p.leaveAt)}</span><span class="chip"
										>Walk {p.walk} min</span
									>
								</p>
							{:else if p}
								<p class="sub">
									We’ll plan it at {clock(p.planAt)} · usually {p.typical} min
								</p>
							{/if}
						</div>
						<button class="remove" aria-label="Remove {r.cls.name}" onclick={() => remove(r.cls)}
							>×</button
						>
					</li>
				{/each}
				{#if saved.length}
					<li class="home">
						<p class="when"><strong>Then</strong></p>
						<div class="what">
							<p class="name">Head home</p>
							<p class="place">{saved[0].to} · saved trip</p>
							<button class="link" onclick={() => pick(saved[0].to)}>★ Plan my way home</button>
						</div>
					</li>
				{/if}
			</ol>
		{:else}
			<p class="state">
				No classes yet. Add your schedule and the app tells you when to leave for each one.
			</p>
		{/if}
	</section>

	<aside>
		{#if adding}
			<button class="backdrop phone" aria-label="Close" onclick={() => (adding = false)}></button>
			{@render form()}
		{:else}
			<div class="card">
				<p class="desktop label">Your schedule</p>
				<p class="desktop count">
					{day.classes.length}
					{day.classes.length === 1 ? 'class' : 'classes'} saved
				</p>
				<p class="desktop muted">
					Each class gets a leave-by time that counts your walk. Your schedule stays in this
					browser.
				</p>
				<div class="actions">
					<button class="primary" onclick={open}>+ Add a class</button>
					<label class="secondary">
						Import calendar file (.ics)
						<input
							class="visually-hidden"
							type="file"
							accept=".ics,text/calendar"
							onchange={importIcs}
						/>
					</label>
				</div>
				{#if note}<p class="note" role="status">{note}</p>{/if}
				{#if !day.classes.length}
					<button class="link" onclick={sample}>Try a sample schedule</button>
				{/if}
				<p class="phone muted center">Your schedule stays in this browser.</p>
			</div>
		{/if}
		{#if saved.length}
			<div class="card">
				<p class="label">Saved trips</p>
				<ul class="saved">
					{#each saved as t (t.to)}
						<li><button onclick={() => pick(t.to)}>★ {t.to}</button></li>
					{/each}
				</ul>
			</div>
		{/if}
	</aside>
</div>

<style>
	.desktop {
		display: none;
	}
	.myday {
		display: grid;
		gap: 18px;
		margin-top: 18px;
	}
	.label {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.timeline {
		margin-top: 8px;
		padding: 0;
		list-style: none;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--surface);
	}
	.timeline li {
		display: grid;
		grid-template-columns: 56px 1fr auto;
		gap: 12px;
		padding: 12px 8px 12px 14px;
	}
	.timeline li + li {
		border-top: 1px solid var(--line);
	}
	.timeline li.next {
		background: var(--nav-active);
	}
	.timeline li.done {
		opacity: 0.6;
	}
	.when strong {
		display: block;
		font-size: 17px;
	}
	.when span {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--muted);
	}
	.what {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: 16px;
		font-weight: 700;
	}
	.place,
	.sub {
		font-size: 14px;
		color: var(--muted);
	}
	.sub {
		font-size: 13px;
	}
	.plan {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
	.chip {
		padding: 3px 8px;
		border-radius: 8px;
		background: var(--chip);
		font-size: 12px;
		font-weight: 700;
	}
	.next .chip {
		background: var(--surface);
	}
	.chip.dark {
		background: var(--action);
		color: var(--on-action);
	}
	.remove {
		align-self: start;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 14px;
		background: none;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
	}
	.remove:hover {
		background: var(--chip);
	}
	.link {
		justify-self: start;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 14px;
		font-weight: 700;
		color: var(--ink);
		text-decoration: underline;
		cursor: pointer;
	}
	.state {
		margin-top: 8px;
		padding: 20px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
		font-size: 14px;
	}
	aside {
		display: grid;
		gap: 16px;
	}
	.card {
		display: grid;
		gap: 12px;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.primary,
	.secondary {
		display: grid;
		place-items: center;
		min-height: 44px;
		padding: 6px 10px;
		border-radius: 12px;
		font: inherit;
		font-size: 15px;
		font-weight: 700;
		text-align: center;
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
	.secondary:focus-within {
		outline: 3px solid var(--live);
		outline-offset: 2px;
	}
	.note {
		font-size: 14px;
		color: var(--live);
	}
	.muted {
		font-size: 14px;
		line-height: 20px;
		color: var(--muted);
	}
	.center {
		text-align: center;
	}
	.saved {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.saved button {
		padding: 8px 14px;
		border: 1px solid var(--line);
		border-radius: 20px;
		background: var(--surface);
		font-weight: 700;
		cursor: pointer;
	}

	/* the form: a bottom sheet on phones */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 900;
		border: 0;
		background: rgb(0 0 0 / 0.45);
	}
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 901;
		display: grid;
		gap: 14px;
		max-height: 90vh;
		overflow-y: auto;
		padding: 20px 20px 28px;
		border-radius: 20px 20px 0 0;
		background: var(--surface);
	}
	.sheet h2 {
		font-family: 'Inter', sans-serif;
		font-size: 22px;
	}
	.field {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		border: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.field legend {
		padding: 0;
		margin-bottom: 6px;
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
	.hits {
		border: 1px solid var(--line);
		border-radius: 10px;
		text-transform: none;
		letter-spacing: 0;
	}
	.hits button {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		border: 0;
		background: none;
		font-size: 15px;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.hits button:hover,
	.hits button:focus-visible {
		background: var(--nav-active);
	}
	.hits span {
		font-weight: 400;
		color: var(--muted);
	}
	.matched {
		font-size: 13px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--live);
	}
	.days {
		display: flex;
		gap: 8px;
	}
	.days button {
		width: 44px;
		height: 44px;
		border: 2px solid var(--ink);
		border-radius: 22px;
		background: var(--surface);
		color: var(--ink);
		font-size: 15px;
		font-weight: 700;
		cursor: pointer;
	}
	.days button[aria-pressed='true'] {
		background: var(--action);
		border-color: var(--action);
		color: var(--on-action);
	}
	.error {
		font-size: 14px;
		color: var(--alert);
	}
	.foot {
		font-size: 13px;
		color: var(--muted);
		text-align: center;
	}
	.foot .link {
		font-size: 13px;
	}

	/* ---------- Desktop: Figma frames 010 / 011 ---------- */
	@media (min-width: 900px) {
		.desktop {
			display: revert;
		}
		.phone {
			display: none;
		}
		.myday {
			grid-template-columns: minmax(0, 720px) 392px;
			gap: 24px;
			align-items: start;
			margin-top: 32px;
		}
		.label {
			font-size: 12px;
			letter-spacing: 0.8px;
		}
		.timeline {
			margin-top: 12px;
			border-radius: 16px;
		}
		.timeline li {
			grid-template-columns: 84px 1fr auto;
			gap: 24px;
			align-items: center;
			padding: 20px 16px 20px 24px;
		}
		.when strong {
			font-size: 24px;
		}
		.name {
			font-size: 20px;
		}
		.place {
			font-size: 16px;
		}
		.chip {
			font-size: 14px;
		}
		aside {
			gap: 24px;
		}
		.card,
		.sheet {
			padding: 24px;
			border: 1px solid var(--line);
			border-radius: 16px;
			background: var(--surface);
		}
		.count {
			font-size: 26px;
			font-weight: 700;
		}
		.actions {
			grid-template-columns: 1fr;
		}
		.primary,
		.secondary {
			min-height: 48px;
			border-radius: 10px;
			font-size: 16px;
		}
		/* the form sits in the right column instead of a sheet */
		.sheet {
			position: static;
			max-height: none;
			border: 2px solid var(--ink);
		}
	}
</style>
