<script>
	import '../app.css';
	import favicon from '#lib/assets/favicon.png';
	import logoArrow from '#lib/assets/icons/logo-arrow.svg';
	import Icon from '#lib/Icon.svelte';
	import { here } from '#lib/here.svelte.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	/** @type {{children: import('svelte').Snippet}} */
	let { children } = $props();

	// ponytail: only "Now" exists so far; the other tabs get links as their screens are built
	const NAV = /** @type {const} */ ([
		{ label: 'Now', icon: 'clock', href: resolve('/') },
		{ label: 'My trips', icon: 'bus', href: null },
		{ label: 'Alerts', icon: 'bell', href: null },
		{ label: 'Routes', icon: 'routes', href: null }
	]);
	const isActive = (/** @type {string | null} */ href) => href === page.url.pathname;

	let now = $state(new Date());
	onMount(() => {
		const t = setInterval(() => (now = new Date()), 15000);
		return () => clearInterval(t);
	});
	const time = $derived(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	<link rel="apple-touch-icon" href={favicon} />
</svelte:head>

<div class="app">
	<header class="topnav">
		<a class="brand" href={resolve('/')}>
			<span class="logo"><img src={logoArrow} alt="" width="36" height="36" /></span>
			<span class="wordmark">TripShot</span>
		</a>
		<span class="campus">University of Cincinnati</span>
		<span class="where"><Icon name="location" />{here.real ? 'Your location' : here.name}</span>
		<span class="time">{time}</span>
	</header>

	<div class="body">
		<nav class="sidebar" aria-label="Main">
			<p class="section">Your campus</p>
			<ul>
				{#each NAV as item (item.label)}
					<li>
						{#if item.href}
							<a
								class="item"
								class:active={isActive(item.href)}
								href={item.href}
								aria-current={isActive(item.href) ? 'page' : undefined}
							>
								<Icon name={item.icon} />{item.label}
							</a>
						{:else}
							<span class="item"><Icon name={item.icon} />{item.label}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="hours">
				<p class="section">Late night, sorted</p>
				<p class="hours-title">NightRide</p>
				<p class="hours-text">10 PM–2 AM<br />North &amp; Southwest</p>
			</div>
		</nav>

		<main>{@render children()}</main>
	</div>

	<nav class="bottomnav" aria-label="Main">
		{#each NAV as item (item.label)}
			{#if item.href}
				<a
					class:active={isActive(item.href)}
					href={item.href}
					aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a
				>
			{:else}
				<span>{item.label}</span>
			{/if}
		{/each}
	</nav>
</div>

<style>
	/* ---------- Phone (default): bottom nav only ---------- */
	.topnav,
	.sidebar {
		display: none;
	}
	main {
		padding: 28px 18px 72px;
		max-width: 560px;
		margin: 0 auto;
	}
	.bottomnav {
		position: fixed;
		inset: auto 0 0 0;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		height: 48px;
		background: var(--surface);
		border-top: 1px solid var(--line);
		font-size: 12px;
		font-weight: 700;
		line-height: 16px;
		text-align: center;
	}
	.bottomnav > * {
		display: grid;
		place-items: center;
		color: var(--muted);
		text-decoration: none;
	}
	.bottomnav .active {
		color: var(--ink);
	}

	/* ---------- Desktop ---------- */
	@media (min-width: 900px) {
		.app {
			min-height: 100vh;
			display: flex;
			flex-direction: column;
		}
		.bottomnav {
			display: none;
		}
		.topnav {
			display: grid;
			grid-template-columns: 224px 1fr auto auto;
			align-items: center;
			height: 72px;
			background: var(--surface);
			padding-right: 22px;
		}
		.brand {
			display: flex;
			align-items: center;
			gap: 12px;
			padding-left: 28px;
			color: var(--ink);
			text-decoration: none;
		}
		.logo {
			display: block;
			width: 36px;
			height: 36px;
			border-radius: 10px;
			overflow: hidden;
			background: var(--brand);
		}
		.logo img {
			display: block;
		}
		.wordmark {
			font-family: 'Inter', sans-serif;
			font-weight: 700;
			font-size: 24px;
			line-height: 30px;
		}
		.campus {
			padding-left: 40px;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: 1px;
			text-transform: uppercase;
			color: var(--muted);
		}
		.where {
			display: flex;
			align-items: center;
			gap: 10px;
			font-size: 14px;
			color: var(--muted);
			margin-right: 34px;
		}
		.time {
			min-width: 100px;
			font-size: 14px;
			font-weight: 700;
		}
		.body {
			flex: 1;
			display: grid;
			grid-template-columns: 224px 1fr;
		}
		.sidebar {
			position: sticky;
			top: 0;
			height: calc(100vh - 72px);
			align-self: start;
			display: flex;
			flex-direction: column;
			background: var(--surface);
			padding: 32px 16px 64px;
		}
		.section {
			font-size: 11px;
			font-weight: 700;
			line-height: 24px;
			letter-spacing: 1px;
			text-transform: uppercase;
			color: var(--muted);
		}
		.sidebar > .section {
			padding-left: 12px;
			margin-bottom: 20px;
		}
		.sidebar ul {
			display: grid;
			gap: 12px;
		}
		.item {
			display: flex;
			align-items: center;
			gap: 14px;
			height: 48px;
			padding-left: 14px;
			border-radius: 10px;
			font-size: 16px;
			color: var(--muted);
			text-decoration: none;
		}
		.item.active {
			background: var(--nav-active);
			color: var(--ink);
			font-weight: 700;
		}
		.hours {
			margin-top: auto;
			padding: 14px 16px 20px;
			border-radius: 12px;
			background: var(--bg);
		}
		.hours-title {
			margin-top: 5px;
			font-size: 18px;
			font-weight: 700;
			line-height: 22.5px;
		}
		.hours-text {
			margin-top: 8px;
			font-size: 14px;
			line-height: 24px;
			color: var(--muted);
		}
		main {
			max-width: 1216px;
			margin: 0;
			padding: 40px;
		}
	}
</style>
