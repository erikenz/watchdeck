import { defaultConfig as defaults } from './defaults';

// HACK: electron-store is ESM, but rolldown has a bug that prevents it from being imported properly in CommonJS context, so we have to use require here
/* oxlint-disable typescript/no-require-imports */
const Store = (
  require('electron-store') as {
    default: typeof import('electron-store').default;
  }
).default;
/* oxlint-enable typescript/no-require-imports */

export type IStore = InstanceType<
  typeof import('conf').default<Record<string, unknown>>
>;

export const store = new Store({
  clearInvalidConfig: false,
  defaults: {
    ...defaults,
    // README: 'plugin' uses deepmerge to populate the default values, so it is not necessary to include it here
  },
});
