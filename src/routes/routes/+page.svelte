<script>
	import Icon from '#lib/Icon.svelte';
	import { getJSON } from '#lib/api.js';
	import { routeAbbrev, shortName, textOn } from '#lib/departures.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	/** @typedef {{ id: string, name: string, color: string, headwaySec: number | number[] | null, vehicles: unknown[] }} LiveRoute */
	let live = $state(/** @type {{ routes: LiveRoute[] } | null} */ (null));
	let failed = $state(false);

	onMount(() => {
		const load = () =>
			getJSON('/live').then(
				(d) => ((live = d), (failed = false)),
				() => (failed = !live)
			);
		load();
		const poll = setInterval(load, 30000);
		return () => clearInterval(poll);
	});

	// running routes first, then by name
	const routes = $derived(
		live?.routes.toSorted(
			(a, b) =>
				Number(b.vehicles.length > 0) - Number(a.vehicles.length > 0) ||
				a.name.localeCompare(b.name)
		) ?? null
	);
	const every = (/** @type {LiveRoute} */ r) => {
		const s = [r.headwaySec ?? []].flat()[0];
		return s ? ` · every ${Math.round(s / 60)} min` : '';
	};
	const status = (/** @type {LiveRoute} */ r) =>
		r.vehicles.length
			? `${r.vehicles.length} ${r.vehicles.length === 1 ? 'bus' : 'buses'} running${every(r)}`
			: 'Not running right now';
</script>

<svelte:head>
	<title>Routes · TripShot</title>
</svelte:head>

<h1>Routes</h1>
<p class="sub">Every UC shuttle route today. Open one to see its buses live on the map.</p>

{#if routes === null}
	<p class="state">
		{failed
			? 'Live shuttle data is unavailable right now. Try again in a moment.'
			: 'Loading routes…'}
	</p>
{:else if routes.length === 0}
	<p class="state">No routes are scheduled today.</p>
{:else}
	<ul class="routes">
		{#each routes as r (r.id)}
			<li>
				<a class="route" class:off={!r.vehicles.length} href="{resolve('/route')}/?id={r.id}">
					<span
						class="badge"
						class:long={routeAbbrev(r.name).length > 2}
						style:background={r.color}
						style:color={textOn(r.color)}>{routeAbbrev(r.name)}</span
					>
					<span class="info">
						<strong>{shortName(r.name)}</strong>
						<span>{status(r)}</span>
					</span>
					<Icon name="chevron" />
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 {
		font-family: 'Inter', sans-serif;
		font-size: 24px;
		line-height: 29px;
	}
	.sub {
		margin-top: 6px;
		color: var(--muted);
		font-size: 14px;
	}
	.routes {
		display: grid;
		gap: 11px;
		margin-top: 18px;
	}
	.route {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
		min-height: 72px;
		padding: 0 16px 0 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
		color: inherit;
		text-decoration: none;
	}
	.route > :global(.icon) {
		color: var(--muted);
	}
	.route:hover {
		border-color: var(--muted);
	}
	.route.off .info span {
		color: var(--muted);
		font-style: italic;
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
	.info {
		display: grid;
		gap: 2px;
	}
	.info strong {
		font-size: 16px;
		line-height: 20px;
	}
	.info span {
		font-size: 14px;
		line-height: 18px;
		color: var(--live);
	}
	.state {
		margin-top: 18px;
		padding: 20px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
		font-size: 14px;
	}

	@media (min-width: 900px) {
		h1 {
			font-size: 32px;
			line-height: 40px;
		}
		.sub {
			font-size: 16px;
		}
		.routes {
			grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
			gap: 16px;
			margin-top: 32px;
			max-width: 1128px;
		}
		.route {
			min-height: 96px;
			gap: 20px;
			padding: 0 20px;
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
		.info strong {
			font-size: 20px;
			line-height: 26px;
		}
	}
</style>
