import { describe, expect, test } from "bun:test";
import { ChannelType, type Guild, OverwriteType, PermissionFlagsBits as P } from "discord.js";

import { CHANNELS, buildLayout, panelStoreKey, roleStoreKey } from "./layout";
import { applyLayout } from "./setup";
import { createBotStore } from "./store";

type FakeChannel = {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  overwrites: { id: string; type: OverwriteType; allow?: bigint[]; deny?: bigint[] }[];
  messages: Map<string, { id: string; edits: number }>;
};

/** Just enough of a discord.js Guild for applyLayout, kept in memory. */
function fakeGuild(options: { forums?: boolean } = {}) {
  let next = 1;
  const id = () => String(next++);
  const roles = new Map<string, { id: string; name: string }>();
  const channels = new Map<string, FakeChannel>();
  const sent: string[] = [];

  const wrap = (channel: FakeChannel) => ({
    ...channel,
    get parentId() {
      return channel.parentId;
    },
    isThread: () => false,
    isSendable: () => channel.type === ChannelType.GuildText,
    permissionOverwrites: {
      set: async (overwrites: FakeChannel["overwrites"]) => {
        channel.overwrites = overwrites;
      },
    },
    setParent: async (parent: string) => {
      channel.parentId = parent;
    },
    messages: {
      fetch: async (messageId: string) => {
        const message = channel.messages.get(messageId);
        if (!message) throw new Error("Unknown Message");
        return {
          edit: async () => {
            message.edits += 1;
          },
        };
      },
    },
    send: async () => {
      const message = { id: id(), edits: 0 };
      channel.messages.set(message.id, message);
      sent.push(channel.name);
      return message;
    },
  });

  const guild = {
    client: { user: { id: "bot" } },
    members: { me: { id: "bot" } },
    roles: {
      everyone: { id: "everyone" },
      fetch: async (roleId: string) => roles.get(roleId) ?? null,
      create: async ({ name }: { name: string }) => {
        const role = { id: id(), name };
        roles.set(role.id, role);
        return role;
      },
    },
    channels: {
      fetch: async (channelId: string) => {
        const channel = channels.get(channelId);
        if (!channel) throw new Error("Unknown Channel");
        return wrap(channel);
      },
      create: async (input: {
        name: string;
        type: ChannelType;
        parent: string | null;
        permissionOverwrites: FakeChannel["overwrites"];
      }) => {
        if (input.type === ChannelType.GuildForum && !options.forums) {
          throw new Error("forums need a community server");
        }
        const channel: FakeChannel = {
          id: id(),
          name: input.name,
          type: input.type,
          parentId: input.parent,
          overwrites: input.permissionOverwrites,
          messages: new Map(),
        };
        channels.set(channel.id, channel);
        return wrap(channel);
      },
    },
  };
  return { guild: guild as unknown as Guild, roles, channels, sent };
}

const layout = buildLayout();

describe("applyLayout", () => {
  test("builds every role, channel and panel once, and a rerun builds nothing", async () => {
    const fake = fakeGuild();
    const store = createBotStore(":memory:", "dev");
    const panels = layout.channels.filter((c) => c.panel).length;

    const first = await applyLayout(fake.guild, store);
    expect(first.failed).toEqual([]);
    expect(first.created).toHaveLength(layout.roles.length + layout.channels.length + panels);
    expect(fake.roles.size).toBe(layout.roles.length);
    expect(fake.channels.size).toBe(layout.channels.length);
    expect(fake.sent).toHaveLength(panels);

    const second = await applyLayout(fake.guild, store);
    expect(second.failed).toEqual([]);
    expect(second.created).toEqual([]);
    expect(fake.roles.size).toBe(layout.roles.length);
    expect(fake.channels.size).toBe(layout.channels.length);
    expect(fake.sent).toHaveLength(panels);
  });

  test("puts channels in their categories with the layout's permissions", async () => {
    const fake = fakeGuild();
    const store = createBotStore(":memory:", "dev");
    await applyLayout(fake.guild, store);

    const team = fake.channels.get(String(store.getId("channel:rov:team:kmitl")));
    expect(team?.parentId).toBe(String(store.getId("category:rov")));
    const everyone = team?.overwrites.find((o) => o.id === "everyone");
    expect(everyone?.deny).toContain(P.ViewChannel);
    const teamRole = team?.overwrites.find(
      (o) => o.id === store.getId(roleStoreKey("team:rov:kmitl")),
    );
    expect(teamRole?.allow).toContain(P.SendMessages);
    // The bot sees even the hidden rooms.
    expect(team?.overwrites.find((o) => o.id === "bot")?.type).toBe(OverwriteType.Member);
  });

  test("a deleted channel comes back with a fresh panel; the rest is reused", async () => {
    const fake = fakeGuild();
    const store = createBotStore(":memory:", "dev");
    await applyLayout(fake.guild, store);
    const oldVerify = String(store.getId(CHANNELS.verify));
    fake.channels.delete(oldVerify);

    const rerun = await applyLayout(fake.guild, store);
    expect(rerun.failed).toEqual([]);
    expect(rerun.created.sort()).toEqual([CHANNELS.verify, panelStoreKey(CHANNELS.verify)].sort());
    expect(store.getId(CHANNELS.verify)).not.toBe(oldVerify);
  });

  test("a guild without forums gets a text channel for questions", async () => {
    const fake = fakeGuild({ forums: false });
    const store = createBotStore(":memory:", "dev");
    await applyLayout(fake.guild, store);
    expect(fake.channels.get(String(store.getId(CHANNELS.questions)))?.type).toBe(
      ChannelType.GuildText,
    );
  });
});
