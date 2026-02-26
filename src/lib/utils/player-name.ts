/**
 * Convert a full display name into a short leaderboard-style name.
 * "Neo Mohsenvand" → "Neo M."
 * "Alice" → "Alice"
 */
export function resolvePlayerName(fullName: string): string {
	const nameParts = fullName.trim().split(/\s+/);
	return nameParts.length > 1
		? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
		: nameParts[0];
}
