/**
 * Pages the app can open on launch, as `options.startingPage`.
 *
 * The paths are the ones the site's own sidebar links to (read from a signed-in
 * page), so they keep working when YouTube moves things around; the labels are the
 * site's own English names for them, because they name site features rather than app
 * concepts.
 */
export const START_PAGES: Record<string, string> = {
  Home: "/",
  Shorts: "/shorts",
  Subscriptions: "/feed/subscriptions",
  Trending: "/feed/trending",
  You: "/feed/you",
  History: "/feed/history",
  Playlists: "/feed/playlists",
  Downloads: "/feed/downloads",
  "Watch later": "/playlist?list=WL",
  "Liked videos": "/playlist?list=LL",
};
