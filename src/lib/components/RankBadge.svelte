<script lang="ts">
	import { getSkillTier, SKILL_TIERS } from '$lib/game/rating';

	type BadgeSize = 'sm' | 'md' | 'lg';

	let { skillLevel, size = 'md' }: { skillLevel: number; size?: BadgeSize } = $props();

	const tier = $derived(getSkillTier(skillLevel));
	const tierIdx = $derived(SKILL_TIERS.indexOf(tier));

	const sizeMap: Record<BadgeSize, number> = { sm: 16, md: 22, lg: 30 };
	const px = $derived(sizeMap[size]);

	/** Points for each tier shape */
	const SHAPES: Record<number, string> = {
		0: '12,3 22,21 2,21',                         // triangle
		1: '12,2 22,12 12,22 2,12',                   // diamond
		2: '12,2 22.5,9.6 18.5,21.4 5.5,21.4 1.5,9.6', // pentagon
		3: '12,2 21,7 21,17 12,22 3,17 3,7',          // hexagon
		4: '12,1 14.9,8.2 22.5,9.1 17,14.2 18.5,22 12,18 5.5,22 7,14.2 1.5,9.1 9.1,8.2', // 5-star
		5: '12,1 15,7.5 22,7.5 18,12 22,16.5 15,16.5 12,23 9,16.5 2,16.5 6,12 2,7.5 9,7.5', // 6-star
		6: '12,1 14,8 21,5.5 16,10 23,12 16,14 21,18.5 14,16 12,23 10,16 3,18.5 8,14 1,12 8,10 3,5.5 10,8' // 8-burst
	};

	const pts = $derived(SHAPES[tierIdx] ?? SHAPES[0]);
</script>

<span
	class="inline-flex shrink-0 items-center justify-center"
	style="width: {px}px; height: {px}px;"
	title="{tier.name} — Skill {skillLevel}"
>
	<svg viewBox="0 0 24 24" width={px} height={px} xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient id="b3d{tierIdx}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="white" stop-opacity="0.4" />
				<stop offset="45%" stop-color="white" stop-opacity="0.0" />
				<stop offset="100%" stop-color="black" stop-opacity="0.3" />
			</linearGradient>
		</defs>
		<!-- Base fill -->
		<polygon points={pts} fill={tier.color} stroke-linejoin="round" />
		<!-- 3D gradient overlay: bright top → dark bottom -->
		<polygon points={pts} fill="url(#b3d{tierIdx})" stroke-linejoin="round" />
	</svg>
</span>
