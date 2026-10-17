/**
 * Sends the page's audio to the output device the menu picked.
 *
 * The music-era version routed an `AudioContext` - the audio graph P1 removed - so the plugin had
 * nothing to act on any more. The browser API for exactly this is `HTMLMediaElement.setSinkId`:
 * no graph, no capture, and it applies to the `<video>` the site is already playing. Verified in
 * the app's page: the method exists, and `enumerateDevices()` returns the output devices *with*
 * their labels, which in a browser needs a permission dance and here does not.
 */
import type { RendererContext } from "@/types/contexts";
import type { MusicPlayer } from "@/types/music-player";
import { createRenderer } from "@/utils";

import type { CustomOutputPluginConfig } from "./index";

/** The element that actually plays; the site swaps it on navigation, so it is looked up each time. */
const videoElement = () => document.querySelector<HTMLVideoElement>("video");

const applySink = async (sinkId: string | undefined) => {
  const video = videoElement();

  if (!(video && sinkId) || typeof video.setSinkId !== "function") {
    return;
  }

  try {
    await video.setSinkId(sinkId);
  } catch {
    // The device may be gone (unplugged headphones): the site keeps playing on the default one.
  }
};

const refreshDevices = async (
  context: RendererContext<CustomOutputPluginConfig>
) => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const list: Record<string, string> = {};

  for (const device of devices) {
    if (device.kind === "audiooutput") {
      list[device.deviceId] = device.label || device.deviceId;
    }
  }

  await context.setConfig({ devices: list });
};

/** No instance state: the sink is applied to the page's element and the list lives in the config. */
// oxlint-disable-next-line typescript/no-empty-object-type
interface NoProps {}

export const renderer = createRenderer<NoProps, CustomOutputPluginConfig>({
  async onConfigChange(config) {
    await applySink(config.output);
  },

  async onPlayerApiReady(_api: MusicPlayer, context) {
    const config = await context.getConfig();

    await applySink(config.output);
    await refreshDevices(context);
    navigator.mediaDevices.ondevicechange = () => {
      void refreshDevices(context);
    };
  },

  stop() {
    navigator.mediaDevices.ondevicechange = null;
  },
});
