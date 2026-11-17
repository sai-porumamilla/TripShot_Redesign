<script>
	// "Next class" card on Running now (Figma frames 9 / 09): when to leave for your next class,
	// how to get there, and a one-tap reminder. Plans on the same live data as the page.
	import places from '#lib/places.json';
	import { textOn } from '#lib/departures.js';
	import { here } from '#lib/here.svelte.js';
	import { day } from '#lib/myDay.svelte.js';
	import { ARRIVE_EARLY_MIN, planFor, upcoming } from '#lib/schedule.js';
	import { resolve } from '$app/paths';

	/** @type {{ routes: any[] | null, stops: { id: string, name: string, loc: number[] }[] | null, now: number }} */
	let { routes, stops, now } = $props();

	const next = $derived(upcoming(day.classes, now)[0]);
	// a class's place is a shuttle stop or a campus building (stops first, like the search)
	const where = $derived(
		next
			? (stops?.find((s) => s.name === next.cls.place) ??
					/** @type {{ name: string, loc: number[] }[]} */ (places).find(
						(p) => p.name === next.cls.place
					))
			: undefined
	);
	const plan = $derived(
		next && where && routes && stops
			? planFor(routes, stops, here.loc, where.loc, next.at, now)
			: null
	);
	// for a class too far ahead to plan on live buses: a rough leave time from today's trip
	const leaveAt = $derived(
		!plan || !next
			? null
			: plan.kind === 'later'
				? next.at - (ARRIVE_EARLY_MIN + plan.typical + 1) * 60000
				: plan.leaveAt
	);

	const clock = (/** @type {number} */ t) =>
		new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const when = $derived(
		!next
			? ''
			: next.day === 0
				? 'Next class'
				: next.day === 1
					? 'Tomorrow'
					: new Date(next.at).toLocaleDateString([], { weekday: 'long' })
	);
	const key = $derived(next ? `${next.cls.id}@${next.at}` : '');
	const reminded = $derived(day.reminder?.key === key);
	// keep a reminder in step as the plan firms up on live buses
	$effect(() => {
		if (reminded && day.reminder && leaveAt !== null && day.reminder.at !== leaveAt)
			day.reminder.at = leaveAt;
	});
	async function remind() {
		if (reminded) return void (day.reminder = null);
		if (!next || leaveAt === null) return;
		if ('Notification' in window && Notification.permission === 'default')
			await Notification.requestPermission();
		day.reminder = {
			key,
			at: leaveAt,
			title: `Leave now for ${next.cls.name}`,
			body:
				plan?.kind === 'shuttle'
					? `Walk ${plan.trip.walkTo} min to ${plan.trip.board.name} for ${plan.trip.route.name}.`
					: `Head to ${next.cls.place}. Class starts at ${clock(next.at)}.`
		};
	}
</script>

{#if !day.classes.length}
	<a class="empty" href="{resolve('/search')}/">
		<strong>Plan around your classes</strong>
		<span>Add your schedule and we’ll tell you when to leave.</span>
	</a>
{:else if next}
	<section
		class="card"
		style:--stripe={plan?.kind === 'shuttle' ? plan.trip.route.color : 'var(--line-strong)'}
		aria-labelledby="next-class"
	>
		<p class="label">{when} · {clock(next.at)}</p>
		<h2 id="next-class" class="title">{next.cls.name} · {next.cls.place}</h2>
		{#if !where}
			<p class="line">We couldn’t find this building on the campus map.</p>
		{:else if !plan}
			<p class="line">Checking live shuttles…</p>
		{:else}
			<p class="hero">
				{plan.kind === 'later'
					? `Leave around ${clock(leaveAt ?? 0)}`
					: (leaveAt ?? 0) <= now
						? 'Leave now'
						: `Leave by ${clock(leaveAt ?? 0)}`}
			</p>
			{#if plan.kind === 'shuttle'}
				<p class="chips">
					<span class="chip">Walk {plan.trip.walkTo} min</span><span aria-hidden="true">→</span
					><span
						class="chip"
						style:background={plan.trip.route.color}
						style:color={textOn(plan.trip.route.color)}>{plan.trip.route.name}</span
					>{#if plan.trip.change}<span aria-hidden="true">→</span><span
							class="chip"
							style:background={plan.trip.change.route.color}
							style:color={textOn(plan.trip.change.route.color)}>{plan.trip.change.route.name}</span
						>{/if}
				</p>
				<p class="line">
					Board at {plan.trip.board.name} at {clock(plan.trip.departAt)}.{plan.trip.change
						? ` Change to ${plan.trip.change.route.name} at ${plan.trip.change.at.name}.`
						: ''} Arrive {clock(plan.trip.arriveAt)}, {Math.round(
						(next.at - plan.trip.arriveAt) / 60000
					)} min before class.
				</p>
			{:else if plan.kind === 'walk'}
				<p class="chips"><span class="chip">Walk {plan.walk} min</span></p>
				<p class="line">Walking is quickest. You’ll be there {ARRIVE_EARLY_MIN} min early.</p>
			{:else}
				<p class="line">
					Usually {plan.typical} min {plan.by === 'walking' ? 'on foot' : `by ${plan.by}`}. We’ll
					pick the bus at {clock(plan.planAt)}, once live buses are in range.
				</p>
			{/if}
			{#if leaveAt !== null && leaveAt > now}
				<button class="action" class:on={reminded} onclick={remind}>
					{reminded
						? `Reminder set for ${clock(day.reminder?.at ?? leaveAt)} · Cancel`
						: `Remind me at ${clock(leaveAt)}`}
				</button>
			{/if}
			{#if plan.kind === 'shuttle'}
				{@const t = plan.trip}
				<a
					class="more"
					href="{resolve('/route')}/?id={t.route.id}&stop={t.board.id}&to={(
						t.change?.at ?? t.alight
					).id}&place={encodeURIComponent(next.cls.place)}&after={t.walkFrom}{t.change
						? `&then=${t.change.route.id}&thenStop=${t.change.board.id}&thenTo=${t.alight.id}`
						: ''}">See the live route</a
				>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.empty {
		display: grid;
		gap: 2px;
		margin-top: 12px;
		padding: 12px 14px;
		border: 1px dashed var(--line-strong);
		border-radius: 14px;
		color: var(--ink);
		text-decoration: none;
		font-size: 14px;
	}
	.empty span {
		color: var(--muted);
	}
	.card {
		display: grid;
		gap: 8px;
		margin-top: 12px;
		padding: 16px 16px 16px 18px;
		border-left: 6px solid var(--stripe);
		border-radius: 14px;
		background: var(--surface);
	}
	.label {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.title {
		font-size: 17px;
		line-height: 22px;
	}
	.hero {
		font-family: 'Inter', sans-serif;
		font-size: 28px;
		font-weight: 700;
		line-height: 34px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		color: var(--muted);
	}
	.chip {
		padding: 3px 8px;
		border-radius: 8px;
		background: var(--chip);
		color: var(--ink);
		font-size: 13px;
	}
	.line {
		font-size: 14px;
		line-height: 20px;
		color: var(--ink-2);
	}
	.action {
		height: 44px;
		margin-top: 4px;
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
	.more {
		justify-self: start;
		font-size: 14px;
		font-weight: 700;
		color: var(--ink);
	}

	@media (min-width: 900px) {
		.empty,
		.card {
			margin-top: 0;
		}
		.card {
			gap: 10px;
			padding: 24px 24px 24px 28px;
			border: 1px solid var(--line);
			border-left: 6px solid var(--stripe);
			border-radius: 16px;
		}
		.hero {
			font-size: 36px;
			line-height: 44px;
		}
		.action {
			height: 48px;
			border-radius: 10px;
		}
	}
</style>
