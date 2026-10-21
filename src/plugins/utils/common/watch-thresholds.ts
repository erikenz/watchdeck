import { defaultConfig } from "@/config/defaults";
import type { WatchThresholds } from "@/types/watch-thresholds";

/**
 * The thresholds as the app should read them: the shipped defaults, with whatever the config holds
 * on top.
 *
 * A config file written before these keys existed has an `options` object without them, and the
 * store hands that object back as it is - defaults are not merged into a stored object - so the
 * defaults have to be applied by the reader. Measured live: `options.watched` came back as `{}` in
 * the page, which made every card "unwatched". The merge also keeps a *partial* object working (a
 * user who set only `percent`).
 */
export const withThresholdDefaults = (
  stored?: Partial<WatchThresholds> | null
): WatchThresholds => ({
  inProgress: {
    max: {
      ...defaultConfig.options.inProgress.max,
      ...stored?.inProgress?.max,
    },
    min: {
      ...defaultConfig.options.inProgress.min,
      ...stored?.inProgress?.min,
    },
  },
  watched: { ...defaultConfig.options.watched, ...stored?.watched },
});

/**
 * The one place the watched / continue-watching thresholds are applied.
 *
 * Both callers feed it what they know: the Watch Later plugin a ratio merged from its own
 * high-water mark and YouTube's resume percentage, the dimming plugin the percentage the site's own
 * progress bar states. `durationSeconds` is only needed by the rules written in minutes - a
 * threshold without a duration cannot be met, which is why the field is optional.
 */
export const classifyProgress = (
  progress: { durationSeconds?: number | null; ratio: number },
  thresholds: WatchThresholds
): "watched" | "in-progress" | "unwatched" => {
  const duration = progress.durationSeconds ?? 0;
  const ratio = progress.ratio;
  const watchedSeconds = ratio * duration;

  const ratioOf = (value?: number) =>
    value === undefined ? undefined : value / 100;
  const minutes = (value?: number) =>
    value === undefined ? undefined : value * 60;

  const watchedPercent = ratioOf(thresholds.watched.percent);
  const watchedMinutes = minutes(thresholds.watched.minutes);
  const maxRemaining = minutes(thresholds.inProgress.max.minutes);
  const remainingSeconds = duration > 0 ? duration - watchedSeconds : undefined;

  if (
    (watchedPercent !== undefined && ratio >= watchedPercent) ||
    (watchedMinutes !== undefined && watchedSeconds >= watchedMinutes) ||
    (maxRemaining !== undefined &&
      remainingSeconds !== undefined &&
      remainingSeconds <= maxRemaining)
  ) {
    return "watched";
  }

  const min = thresholds.inProgress.min;
  const minPercent = ratioOf(min.percent);
  const minMinutes = minutes(min.minutes);
  // "Continue watching" reaches up to the watched threshold, so raising that one cannot leave a
  // band where a video counts as neither.
  const ceiling = Math.max(
    ratioOf(thresholds.inProgress.max.percent) ?? 1,
    watchedPercent ?? 1
  );
  const started =
    (minPercent !== undefined && ratio >= minPercent) ||
    (minMinutes !== undefined && watchedSeconds >= minMinutes);

  return started && ratio < ceiling ? "in-progress" : "unwatched";
};

/** YouTube writes a duration as `10:19` or `1:02:33`; anything else is no duration at all. */
export const secondsFromText = (
  text: string | undefined
): number | undefined => {
  if (!text) {
    return undefined;
  }
  const parts = text.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
};
