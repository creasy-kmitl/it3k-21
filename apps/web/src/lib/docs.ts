/** The user guide (apps/docs) of the same stage; the local docs dev server otherwise. */
const docsUrl = import.meta.env.VITE_DOCS_URL ?? "http://localhost:3004";

/** The staff section of the guide, where the staff sidebar's link goes. */
export const staffGuideUrl = `${docsUrl.replace(/\/$/, "")}/docs/staff/overview`;
