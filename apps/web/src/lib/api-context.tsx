import { createContext, useContext } from "react";

import { type CalendarApi, calendarApi } from "./calendar";
import { type LeadershipApi, leadershipApi } from "./leadership";
import { type LinksApi, linksApi } from "./links";
import { type QrPresetsApi, qrPresetsApi } from "./qr-presets";
import { type UsersApi, usersApi } from "./users";
import { type ProfileApi, profileApi } from "./profile";
import { type FilesApi, filesApi } from "./files";
import { type SportsApi, sportsApi } from "./sports";
import { type SportRulesApi, sportRulesApi } from "./sport-rules";
import { type RegistrationsApi, registrationsApi } from "./registrations";
import { type AthletesApi, athletesApi } from "./athletes";
import { type EventsApi, eventsApi } from "./events";
import { type VenuesApi, venuesApi } from "./venues";
import { type TicketsApi, ticketsApi } from "./tickets";
import { type EmailsApi, emailsApi } from "./emails";
import { type InvitationsApi, invitationsApi } from "./invitations";

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
  sportRules: SportRulesApi;
  registrations: RegistrationsApi;
  athletes: AthletesApi;
  venues: VenuesApi;
  events: EventsApi;
  tickets: TicketsApi;
  emails: EmailsApi;
  invitations: InvitationsApi;
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
  sportRules: sportRulesApi,
  registrations: registrationsApi,
  athletes: athletesApi,
  venues: venuesApi,
  events: eventsApi,
  tickets: ticketsApi,
  emails: emailsApi,
  invitations: invitationsApi,
});

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
