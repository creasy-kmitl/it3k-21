import { createContext, useContext } from "react";

import { type CalendarApi, calendarApi } from "./calendar";
import { type LeadershipApi, leadershipApi } from "./leadership";
import { type LinksApi, linksApi } from "./links";
import { type QrPresetsApi, qrPresetsApi } from "./qr-presets";
import { type UsersApi, usersApi } from "./users";
import { type ProfileApi, profileApi } from "./profile";
import { type FilesApi, filesApi } from "./files";

/** The API clients route pages call; tests swap in fakes with ApiProvider. */
export type Apis = {
  leadership: LeadershipApi;
  users: UsersApi;
  calendar: CalendarApi;
  links: LinksApi;
  qrPresets: QrPresetsApi;
  profile: ProfileApi;
  files: FilesApi;
};

const ApiContext = createContext<Apis>({
  leadership: leadershipApi,
  users: usersApi,
  calendar: calendarApi,
  links: linksApi,
  qrPresets: qrPresetsApi,
  profile: profileApi,
  files: filesApi,
});

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
