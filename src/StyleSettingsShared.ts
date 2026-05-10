export const settingRegExp = /\/\*!?\s*@settings[\r\n]+?([\s\S]+?)\*\//g;
export const nameRegExp = /^name:\s*(.+)$/m;

/**
 * Validates color strings that come from theme YAML defaults.
 * Accepts any string starting with #, rgb, or hsl as a syntactically
 * plausible CSS color (detailed validation is deferred to chroma-js).
 */
export function isValidDefaultColor(color: string) {
	return /^(#|rgb|hsl)/.test(color);
}

/**
 * Validates a saved color value before persisting or applying it.
 * Stricter than isValidDefaultColor: rejects obviously corrupt values
 * such as strings containing "NaN" that can result from a broken color picker.
 */
export function isValidSavedColor(color: string): boolean {
	if (!isValidDefaultColor(color)) return false;
	// Reject strings that contain NaN (e.g. "#NANNANNAN" from broken pickr state).
	if (/NaN/i.test(color)) return false;
	return true;
}
