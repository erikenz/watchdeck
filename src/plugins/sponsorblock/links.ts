/**
 * Where SponsorBlock lives, for every place this app credits it: the consent dialog, the plugin's
 * own menu and the about dialog.
 *
 * Deliberately import-free. The about dialog belongs to the app rather than to the plugin, and it
 * must be able to read the link without dragging `./extension.ts` - and the extension loader's
 * `node:*` imports - behind it.
 */
export const SPONSOR_BLOCK_REPOSITORY =
  "https://github.com/ajayyy/SponsorBlock";

/**
 * The release page a human reads, for the exact release this app installs - or the releases list,
 * for a spec that does not pin one.
 */
export const sponsorBlockReleasePage = (tag?: string) =>
  tag
    ? `${SPONSOR_BLOCK_REPOSITORY}/releases/tag/${tag}`
    : `${SPONSOR_BLOCK_REPOSITORY}/releases`;
