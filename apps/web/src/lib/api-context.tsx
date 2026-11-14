import { createContext, useContext } from "react";

import { type CalendarApi, calendarApi } from "./calendar";
import { type LeadershipApi, leadershipApi } from "./leadership";
import { type LinksApi, linksApi } from "./links";
import { type QrPresetsApi, qrPresetsApi } from "./qr-presets";
import { type UsersApi, usersApi } from "./users";
import { type ProfileApi, profileApi } from "./profile";
import { type FilesApi, filesApi } from "./files";
import { type SportsApi, sportsApi } from "./sports";
import { type RegistrationsApi, registrationsApi } from "./registrations";
import { type AthletesApi, athletesApi } from "./athletes";
import { type EventsApi, eventsApi } from "./events";
import { type VenuesApi, venuesApi } from "./venues";

/** The API clients route pages call; tests swap in fakes with ApiProvider. */
export type Apis = {
  leadership: LeadershipApi;
  users: UsersApi;
  calendar: CalendarApi;
  links: LinksApi;
  qrPresets: QrPresetsApi;
  profile: ProfileApi;
  files: FilesApi;
  sports: SportsApi;
  registrations: RegistrationsApi;
  athletes: AthletesApi;
  venues: VenuesApi;
  events: EventsApi;
};

const ApiContext = createContext<Apis>({
  leadership: leadershipApi,
  users: usersApi,
  calendar: calendarApi,
  links: linksApi,
  qrPresets: qrPresetsApi,
  profile: profileApi,
  files: filesApi,
  sports: sportsApi,
  registrations: registrationsApi,
  athletes: athletesApi,
  venues: venuesApi,
  events: eventsApi,
});

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
