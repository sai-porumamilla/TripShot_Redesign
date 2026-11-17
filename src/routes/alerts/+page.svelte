<script>
	import Icon from '#lib/Icon.svelte';
	import { SCENARIOS } from '#lib/serviceChanges.js';
	import { resolve } from '$app/paths';

	const mlk = SCENARIOS['mlk-closure'];
</script>

<svelte:head>
	<title>Alerts · TripShot</title>
</svelte:head>

<h1>Alerts</h1>
<p class="sub">Stop closures, detours and your leave-now reminders, in one place.</p>

<section aria-labelledby="changes">
	<h2 id="changes">Service changes</h2>
	<!-- ponytail: TripShot's free-text alerts aren't proxied yet; add an allow-listed /alerts endpoint to show live ones -->
	<p class="state">No stop closures or detours right now.</p>

	<div class="card past">
		<p class="label"><Icon name="notice-clock" />Past alert · Oct 7</p>
		<p class="text">{mlk.notice}</p>
		<a class="action" href="{resolve('/')}?scenario={mlk.id}">Replay it on live buses</a>
	</div>
</section>

<section aria-labelledby="yours">
	<h2 id="yours">Your alerts</h2>
	<div class="card">
		<p class="label"><Icon name="bell" />Leave-now reminders</p>
		<p class="text">
			Open a departure and tap <strong>Tell me when to leave</strong>. We’ll notify you when it’s
			time to walk to your stop, based on the live bus and your walk.
		</p>
		<a class="action" href={resolve('/')}>See departures near you</a>
	</div>
</section>

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
	section {
		max-width: 720px;
	}
	h2 {
		margin-top: 24px;
		font-size: 13px;
		line-height: 18px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
	}
	.state,
	.card {
		margin-top: 10px;
		padding: 16px;
		border-radius: 14px;
		font-size: 14px;
		line-height: 20px;
	}
	.state {
		border: 1px dashed var(--line);
		color: var(--muted);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.past {
		background: var(--notice-bg);
		border-color: transparent;
		color: var(--notice-ink);
	}
	.label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		--icon-size: 14px;
	}
	.text {
		margin-top: 8px;
	}
	.action {
		display: inline-block;
		margin-top: 12px;
		padding: 10px 16px;
		border-radius: 10px;
		background: var(--action);
		color: var(--on-action);
		font-weight: 700;
		text-decoration: none;
	}

	@media (min-width: 900px) {
		h1 {
			font-size: 32px;
			line-height: 40px;
		}
		.sub {
			font-size: 16px;
		}
		h2 {
			margin-top: 32px;
			font-size: 12px;
			letter-spacing: 0.8px;
		}
		.state,
		.card {
			padding: 20px 24px;
			border-radius: 16px;
			font-size: 16px;
			line-height: 24px;
		}
	}
</style>
