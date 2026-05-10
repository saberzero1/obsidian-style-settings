export const settingRegExp = /\/\*!?\s*@settings[\r\n]+?([\s\S]+?)\*\//g;
export const nameRegExp = /^name:\s*(.+)$/m;

export function isValidDefaultColor(color: string) {
	return /^(#|rgb|hsl)/.test(color);
}
