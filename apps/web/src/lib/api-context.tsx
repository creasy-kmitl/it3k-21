import { createContext, useContext } from "react";

import { type LeadershipApi, leadershipApi } from "./leadership";
import { type UsersApi, usersApi } from "./users";

/** The API clients route pages call; tests swap in fakes with ApiProvider. */
export type Apis = { leadership: LeadershipApi; users: UsersApi };

const ApiContext = createContext<Apis>({ leadership: leadershipApi, users: usersApi });

export const ApiProvider = ApiContext.Provider;

export function useApis() {
  return useContext(ApiContext);
}
