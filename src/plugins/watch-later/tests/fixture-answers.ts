/**
 * The two answers `browse/edit_playlist` gives for one write, trimmed to what this code reads.
 *
 * A session YouTube no longer accepts is not told so with an error status or an `error` object: the
 * answer is a 200 whose `status` is `STATUS_FAILED`, and the only trace inside it is a "Sign in to
 * add this video to a playlist." popup that nothing machine-readable depends on. Reading `error`
 * alone is how a refused save was read as saved.
 */
export const refusedEditAnswer = () => ({
  responseContext: trackingFlags("0"),
  status: "STATUS_FAILED",
});

/** The same answer for a write that was applied - the site's own word for it. */
export const appliedEditAnswer = () => ({
  responseContext: trackingFlags("1"),
  status: "STATUS_SUCCEEDED",
});

/**
 * Trimmed from a real signed-out `browse` answer: no `contents` at all, only the same flag. This is
 * the shape a walk reads as an empty list, which is what "empty page" in the toolbar is.
 */
export const signedOutBrowseAnswer = () => ({
  responseContext: trackingFlags("0"),
  topbar: {},
});

/** One item, in the shape the page walk reads it out of. */
export const pageWithOneItemAnswer = (videoId: string) => ({
  contents: {
    playlistVideoListRenderer: {
      contents: [
        {
          playlistVideoRenderer: {
            setVideoId: "SETVIDEOID01",
            title: { simpleText: "One video" },
            videoId,
          },
        },
      ],
    },
  },
  responseContext: trackingFlags("1"),
});

/** Trimmed from a real answer's `responseContext.serviceTrackingParams`. */
const trackingFlags = (loggedIn: "0" | "1") => ({
  serviceTrackingParams: [
    {
      params: [
        { key: "c", value: "WEB" },
        { key: "yt_li", value: loggedIn },
      ],
      service: "CSI",
    },
    { params: [{ key: "logged_in", value: loggedIn }], service: "GFEEDBACK" },
  ],
});
