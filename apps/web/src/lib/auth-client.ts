import { ac, roles } from "@it3k/auth/permissions";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
  plugins: [
    adminClient({ ac, roles }),
    inferAdditionalFields({
      user: {
        departmentId: { type: "string", required: false, input: false },
      },
    }),
  ],
});
