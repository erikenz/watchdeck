/**
 * The site this plugin mirrors, in one place: the backend builds InnerTube requests for it
 * and the in-page panel links back to it. Kept escaped like the rest of the code base (see
 * the PRD's note on the de-trademarking pass).
 */
export const SITE_ORIGIN =
  "https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

export const WATCH_LATER_PATH = "/playlist?list=WL";

export const watchUrl = (videoId: string) =>
  `${SITE_ORIGIN}/watch?v=${videoId}`;

/** True on the site's own Watch Later page, which is where the panel mounts. */
export const isWatchLaterPage = (url: string = window.location.href) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname === "/playlist" &&
      parsed.searchParams.get("list") === "WL"
    );
  } catch {
    return false;
  }
};
