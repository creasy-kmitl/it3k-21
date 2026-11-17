/** @jsxImportSource react */
import { Text } from "@react-email/components";
import { EmailLayout, type EmailContext, mutedText } from "../components/layout";
import type { CustomEmail } from "../jobs";
import { RichText } from "../rich-text-render";

export function CustomEmailTemplate({ email, ctx }: { email: CustomEmail; ctx: EmailContext }) {
  return (
    <EmailLayout
      ctx={ctx}
      preview={email.subject}
      title={email.subject}
      footer={
        email.sender ? (
          <Text style={{ ...mutedText, margin: 0 }}>ส่งโดย {email.sender} ทีมงาน IT3Kings</Text>
        ) : undefined
      }
    >
      <RichText doc={email.content} apiOrigin={ctx.apiOrigin} />
    </EmailLayout>
  );
}
