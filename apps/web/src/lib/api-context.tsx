import { createContext, useContext } from "react";

import { type CalendarApi, calendarApi } from "./calendar";
import { type LeadershipApi, leadershipApi } from "./leadership";
import { type LinksApi, linksApi } from "./links";
import { type UsersApi, usersApi } from "./users";

/** The API clients route pages call; tests swap in fakes with ApiProvider. */
export type Apis = {
  leadership: LeadershipApi;
  users: UsersApi;
  calendar: CalendarApi;
  links: LinksApi;
};

const ApiContext = createContext<Apis>({
  leadership: leadershipApi,
  users: usersApi,
  calendar: calendarApi,
  links: linksApi,
});

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
