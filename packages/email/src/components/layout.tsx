/** @jsxImportSource react */
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { BRAND, theme } from "../theme";

export type EmailContext = {
  /** Origin of the web app, e.g. https://it3k.creasy.club */
  webOrigin: string;
  /** Origin of the API worker, where uploaded images are served. */
  apiOrigin: string;
};

export const text: CSSProperties = {
  margin: "0 0 16px",
  fontSize: "15px",
  lineHeight: "26px",
  color: theme.foreground,
};

export const mutedText: CSSProperties = {
  ...text,
  fontSize: "13px",
  lineHeight: "22px",
  color: theme.mutedForeground,
};

export function EmailLayout({
  ctx,
  preview,
  title,
  children,
  footer,
}: {
  ctx: EmailContext;
  preview: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Html lang="th">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "24px 12px",
          backgroundColor: theme.muted,
          fontFamily: theme.fontFamily,
          color: theme.foreground,
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto" }}>
          <Section style={{ padding: "0 4px 16px" }}>
            <Row>
              <Column style={{ width: "40px", verticalAlign: "middle" }}>
                <Link href={ctx.webOrigin}>
                  <Img
                    src={`${ctx.webOrigin}/icon-192.png`}
                    width="36"
                    height="36"
                    alt={BRAND}
                    style={{ borderRadius: "8px", display: "block" }}
                  />
                </Link>
              </Column>
              <Column style={{ verticalAlign: "middle", paddingLeft: "10px" }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: "17px",
                    fontWeight: 700,
                    lineHeight: "22px",
                    color: theme.foreground,
                  }}
                >
                  {BRAND}
                </Text>
              </Column>
            </Row>
          </Section>

          <Section
            style={{
              backgroundColor: theme.background,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius,
              borderTop: `4px solid ${theme.primary}`,
              padding: "28px 28px 12px",
            }}
          >
            <Heading
              as="h1"
              style={{
                margin: "0 0 20px",
                fontSize: "22px",
                lineHeight: "32px",
                fontWeight: 700,
                color: theme.foreground,
              }}
            >
              {title}
            </Heading>
            {children}
          </Section>

          <Section style={{ padding: "16px 8px 0", textAlign: "center" }}>
            {footer}
            <Text style={{ ...mutedText, fontSize: "12px", margin: "4px 0 0" }}>
              อีเมลนี้ส่งจากระบบ {BRAND} ·{" "}
              <Link href={ctx.webOrigin} style={{ color: theme.mutedForeground }}>
                {ctx.webOrigin.replace(/^https?:\/\//, "")}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "8px 0 20px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: theme.primary,
          color: theme.primaryForeground,
          borderRadius: "8px",
          fontSize: "15px",
          fontWeight: 600,
          lineHeight: "20px",
          padding: "12px 22px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

export type InfoRow = { label: string; value: ReactNode };

/** Label/value pairs in a muted panel, one per line on every screen width. */
export function InfoTable({ rows }: { rows: InfoRow[] }) {
  return (
    <Section
      style={{
        backgroundColor: theme.muted,
        borderRadius: "8px",
        padding: "6px 16px",
        margin: "0 0 20px",
      }}
    >
      {rows.map((row, index) => (
        <Row
          key={row.label}
          style={{ borderTop: index === 0 ? "none" : `1px solid ${theme.border}` }}
        >
          <Column
            style={{
              width: "38%",
              padding: "10px 12px 10px 0",
              verticalAlign: "top",
              fontSize: "13px",
              lineHeight: "20px",
              color: theme.mutedForeground,
            }}
          >
            {row.label}
          </Column>
          <Column
            style={{
              padding: "10px 0",
              verticalAlign: "top",
              fontSize: "14px",
              lineHeight: "20px",
              fontWeight: 600,
              color: theme.foreground,
              wordBreak: "break-word",
            }}
          >
            {row.value}
          </Column>
        </Row>
      ))}
    </Section>
  );
}

/** A coloured pill for a status, red for the brand's own emphasis. */
export function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "danger" | "neutral";
  children: ReactNode;
}) {
  const colors = {
    success: { background: "#dcfce7", color: "#166534" },
    danger: { background: "#fee2e2", color: theme.primary },
    neutral: { background: theme.border, color: theme.foreground },
  }[tone];
  return (
    <span
      style={{
        ...colors,
        display: "inline-block",
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "20px",
      }}
    >
      {children}
    </span>
  );
}

export function greeting(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? `สวัสดีคุณ${trimmed}` : "สวัสดี";
}
