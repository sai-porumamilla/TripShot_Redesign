<script>
	// Figma icons, placed exactly as in the design: each SVG keeps its proportions and
	// sits at the offset Figma gives it inside a square slot (positions in % of the slot).
	// Size: the `size` prop, or a parent's `--icon-size`, default 24px.
	import bell from '#lib/assets/icons/bell.svg';
	import bus from '#lib/assets/icons/bus.svg';
	import chevron from '#lib/assets/icons/chevron.svg';
	import clock from '#lib/assets/icons/clock.svg';
	import location from '#lib/assets/icons/location.svg';
	import noticeClock from '#lib/assets/icons/notice-clock.svg';
	import routes from '#lib/assets/icons/routes.svg';
	import search from '#lib/assets/icons/search.svg';

	/** name → [src, left, top, width, height] in a 24-unit slot (from Figma) */
	const ICONS = /** @type {Record<string, [string, number, number, number, number]>} */ ({
		bell: [bell, 3.1, 1.1, 17.8, 21.8],
		bus: [bus, 3.1, 2.1, 17.8, 20.8],
		chevron: [chevron, 8.1, 4.1, 8.8, 15.8],
		clock: [clock, 2.1, 2.1, 19.8, 19.8],
		location: [location, 3.1, 1.1, 17.8, 21.8],
		'notice-clock': [noticeClock, 2.1, 2.1, 19.8, 19.8],
		routes: [routes, 2.1, 1.1, 19.8, 21.8],
		search: [search, 2.6, 2.6, 19.3, 19.3]
	});

	/** @type {{ name: keyof typeof ICONS, size?: number }} */
	let { name, size } = $props();
	const [src, l, t, w, h] = $derived(ICONS[name]);
	const pct = (/** @type {number} */ v) => `${(v / 24) * 100}%`;
</script>

<span class="icon" style:--icon-size={size ? `${size}px` : undefined} aria-hidden="true">
	<img
		{src}
		alt=""
		style:left={pct(l)}
		style:top={pct(t)}
		style:width={pct(w)}
		style:height={pct(h)}
	/>
</span>

<style>
	.icon {
		position: relative;
		display: inline-block;
		flex: none;
		width: var(--icon-size, 24px);
		height: var(--icon-size, 24px);
	}
	img {
		position: absolute;
		display: block;
		max-width: none;
	}
</style>
