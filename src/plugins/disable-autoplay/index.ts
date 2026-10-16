import { t } from '@/i18n';
import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChanged } from '@/types/video-data-changed';
import { createPlugin } from '@/utils';

export interface DisableAutoPlayPluginConfig {
  enabled: boolean;
  applyOnce: boolean;
}

export default createPlugin<
  unknown,
  unknown,
  {
    config: DisableAutoPlayPluginConfig | null;
    api: MusicPlayer | null;
    eventListener: (event: CustomEvent<VideoDataChanged>) => void;
    timeUpdateListener: (e: Event) => void;
  },
  DisableAutoPlayPluginConfig
>({
  config: {
    applyOnce: false,
    enabled: false,
  },
  description: () => t('plugins.disable-autoplay.description'),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.disable-autoplay.menu.apply-once'),
        type: 'checkbox',
        checked: config.applyOnce,
        async click() {
          const nowConfig = await getConfig();
          setConfig({
            applyOnce: !nowConfig.applyOnce,
          });
        },
      },
    ];
  },
  name: () => t('plugins.disable-autoplay.name'),
  renderer: {
    api: null,
    config: null,
    eventListener(event: CustomEvent<VideoDataChanged>) {
      if (this.config?.applyOnce) {
        document.removeEventListener('videodatachange', this.eventListener);
      }

      if (event.detail.name === 'dataloaded') {
        this.api?.pauseVideo();
        document
          .querySelector<HTMLVideoElement>('video')
          ?.addEventListener('timeupdate', this.timeUpdateListener, {
            once: true,
          });
      }
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    onPlayerApiReady(api) {
      this.api = api;

      document.addEventListener('videodatachange', this.eventListener);
    },
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    stop() {
      document.removeEventListener('videodatachange', this.eventListener);
    },
    timeUpdateListener(e: Event) {
      if (e.target instanceof HTMLVideoElement) {
        e.target.pause();
      }
    },
  },
  restartNeeded: false,
});
