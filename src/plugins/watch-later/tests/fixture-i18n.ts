/**
 * The fixture's stand-in for the app's i18n singleton: the renderer fixtures assert structure and
 * behaviour, never copy, so a `t` that hands the key back keeps them readable.
 */
export const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
