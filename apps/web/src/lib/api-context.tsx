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
import { type CompetitionDivisionsApi, competitionDivisionsApi } from "./competition-divisions";
import { type CompetitionTeamsApi, competitionTeamsApi } from "./competition-teams";
import { type CompetitionMatchesApi, competitionMatchesApi } from "./competition-matches";
import { type CompetitionScoresApi, competitionScoresApi } from "./competition-scores";
import { type CompetitionCheckinsApi, competitionCheckinsApi } from "./competition-checkins";
import { type PublicCompetitionApi, publicCompetitionApi } from "./public-competition";
import { type BotTokensApi, botTokensApi } from "./bot-tokens";

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
  competitionDivisions: CompetitionDivisionsApi;
  competitionTeams: CompetitionTeamsApi;
  competitionMatches: CompetitionMatchesApi;
  competitionScores: CompetitionScoresApi;
  competitionCheckins: CompetitionCheckinsApi;
  publicCompetition: PublicCompetitionApi;
  botTokens: BotTokensApi;
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
  competitionDivisions: competitionDivisionsApi,
  competitionTeams: competitionTeamsApi,
  competitionMatches: competitionMatchesApi,
  competitionScores: competitionScoresApi,
  competitionCheckins: competitionCheckinsApi,
  publicCompetition: publicCompetitionApi,
  botTokens: botTokensApi,
});

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
