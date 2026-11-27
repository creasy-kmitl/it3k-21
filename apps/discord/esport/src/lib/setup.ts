// Turns layout.ts into the guild. Safe to run again: a piece whose stored id
// still exists is reused (its permissions are set again, its name is left as
// an admin may have changed it); a missing one is made and its id stored.
// Nothing the bot did not make is touched.
import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  OverwriteType,
  PermissionFlagsBits as P,
} from "discord.js";

import {
  type Access,
  type Audience,
  type ChannelSpec,
  buildLayout,
  panelStoreKey,
  roleStoreKey,
} from "./layout";
import { buildPanel } from "./panels";
import type { BotStore } from "./store";

const WRITE = [
  P.ViewChannel,
  P.ReadMessageHistory,
  P.SendMessages,
  P.SendMessagesInThreads,
  P.AddReactions,
  P.Connect,
  P.Speak,
];

export const PERMISSIONS: Record<Access, { allow: bigint[]; deny: bigint[] }> = {
  hidden: { allow: [], deny: [P.ViewChannel] },
  read: {
    allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
    deny: [
      P.SendMessages,
      P.SendMessagesInThreads,
      P.CreatePublicThreads,
      P.CreatePrivateThreads,
      P.Connect,
    ],
  },
  write: { allow: WRITE, deny: [] },
  ticket: {
    allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads],
    deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads],
  },
  manage: { allow: [...WRITE, P.ManageThreads, P.ManageMessages], deny: [] },
};

/** What the bot itself needs in every channel, even ones hidden from everyone. */
const BOT_ALLOW = [
  P.ViewChannel,
  P.ReadMessageHistory,
  P.SendMessages,
  P.SendMessagesInThreads,
  P.EmbedLinks,
  P.CreatePrivateThreads,
  P.ManageThreads,
  P.ManageMessages,
  P.Connect,
];

const CHANNEL_TYPES = {
  category: ChannelType.GuildCategory,
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  forum: ChannelType.GuildForum,
} as const;

export type SetupResult = { created: string[]; reused: string[]; failed: string[] };

export async function applyLayout(guild: Guild, store: BotStore): Promise<SetupResult> {
  const result: SetupResult = { created: [], reused: [], failed: [] };
  const layout = buildLayout();
  const botId = guild.members.me?.id ?? guild.client.user.id;

  for (const spec of layout.roles) {
    const key = roleStoreKey(spec.key);
    try {
      const stored = store.getId(key);
      const existing = stored ? await guild.roles.fetch(stored).catch(() => null) : null;
      if (existing) {
        result.reused.push(key);
        continue;
      }
      const role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        hoist: spec.hoist,
        mentionable: spec.key === "staff",
        permissions: [],
        reason: "/init",
      });
      store.setId(key, role.id);
      result.created.push(key);
    } catch (error) {
      result.failed.push(`${key}: ${reason(error)}`);
    }
  }

  const audienceId = (audience: Audience) =>
    audience === "everyone" ? guild.roles.everyone.id : store.getId(roleStoreKey(audience));

  const overwritesFor = (spec: ChannelSpec): OverwriteResolvable[] => [
    ...Object.entries(spec.access).flatMap(([audience, access]) => {
      const id = audienceId(audience as Audience);
      if (!id || !access) return [];
      const { allow, deny } = PERMISSIONS[access];
      return [{ id, type: OverwriteType.Role, allow, deny }];
    }),
    { id: botId, type: OverwriteType.Member, allow: BOT_ALLOW },
  ];

  for (const spec of layout.channels) {
    try {
      const parent = spec.parent ? store.getId(spec.parent) : undefined;
      const stored = store.getId(spec.key);
      const existing = stored ? await guild.channels.fetch(stored).catch(() => null) : null;
      if (existing && !existing.isThread() && sameKind(existing, spec)) {
        await existing.permissionOverwrites.set(overwritesFor(spec), "/init");
        if (parent && existing.parentId !== parent) {
          await existing.setParent(parent, { lockPermissions: false });
        }
        result.reused.push(spec.key);
      } else {
        const channel = await createChannel(guild, spec, parent, overwritesFor(spec));
        store.setId(spec.key, channel.id);
        // A new channel needs a new panel; the old message went with the old channel.
        store.deleteId(panelStoreKey(spec.key));
        result.created.push(spec.key);
      }
    } catch (error) {
      result.failed.push(`${spec.key}: ${reason(error)}`);
    }
  }

  const mention = (key: string, fallback: string) => {
    const id = store.getId(key);
    return id ? `<#${id}>` : `#${fallback}`;
  };
  for (const spec of layout.channels) {
    if (!spec.panel) continue;
    const key = panelStoreKey(spec.key);
    try {
      const channelId = store.getId(spec.key);
      const channel = channelId ? await guild.channels.fetch(channelId) : null;
      if (!channel?.isSendable() || channel.isThread()) throw new Error("ส่งข้อความในช่องไม่ได้");
      const message = buildPanel(spec.panel, mention);
      const stored = store.getId(key);
      const existing = stored ? await channel.messages.fetch(stored).catch(() => null) : null;
      if (existing) {
        await existing.edit(message);
        result.reused.push(key);
      } else {
        const sent = await channel.send(message);
        store.setId(key, sent.id);
        result.created.push(key);
      }
    } catch (error) {
      result.failed.push(`${key}: ${reason(error)}`);
    }
  }

  return result;
}

function sameKind(channel: GuildBasedChannel, spec: ChannelSpec) {
  // A forum that fell back to text on creation stays acceptable as text.
  if (spec.kind === "forum") {
    return channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildText;
  }
  return channel.type === CHANNEL_TYPES[spec.kind];
}

async function createChannel(
  guild: Guild,
  spec: ChannelSpec,
  parent: string | undefined,
  permissionOverwrites: OverwriteResolvable[],
) {
  const base = {
    name: spec.name,
    parent: parent ?? null,
    permissionOverwrites,
    reason: "/init",
  };
  const topic = spec.topic ? { topic: spec.topic } : {};
  switch (spec.kind) {
    case "category":
      return guild.channels.create({ ...base, type: ChannelType.GuildCategory });
    case "voice":
      return guild.channels.create({ ...base, type: ChannelType.GuildVoice });
    case "text":
      return guild.channels.create({ ...base, ...topic, type: ChannelType.GuildText });
    case "forum":
      // Some guilds cannot have forums; a text channel still does the job.
      return guild.channels
        .create({ ...base, ...topic, type: ChannelType.GuildForum })
        .catch(() => guild.channels.create({ ...base, ...topic, type: ChannelType.GuildText }));
  }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
