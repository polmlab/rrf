const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

const VANITY_FILE = path.join(__dirname, "vanity.json");

function loadVanity() {
  try {
    return JSON.parse(fs.readFileSync(VANITY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveVanity(data) {
  fs.writeFileSync(VANITY_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
});

const PREFIX = "$";
const TICKET_CREATOR_ID = "718493970652594217";

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch(() => {});
  }
});

client.on("error", (err) => console.error("Client error:", err.message));

// ─── Presence Update: auto-assign / remove vanity roles ───────────────────────
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    const guild = newPresence?.guild;
    if (!guild) return;

    const member = await guild.members.fetch(newPresence.userId).catch(() => null);
    if (!member || member.user.bot) return;

    const vanity = loadVanity();
    const configs = vanity[guild.id];
    if (!configs || configs.length === 0) return;

    const customActivity = newPresence.activities?.find(a => a.type === 4);
    const statusText = customActivity?.state?.toLowerCase() ?? "";

    for (const cfg of configs) {
      const matched = cfg.texts.some(t => {
        const text = t.toLowerCase();
        return cfg.matchType === "exact"
          ? statusText === text
          : statusText.includes(text);
      });

      for (const roleId of cfg.roles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        if (matched && !member.roles.cache.has(roleId)) {
          await member.roles.add(role).catch(() => {});
        } else if (!matched && member.roles.cache.has(roleId)) {
          await member.roles.remove(role).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("presenceUpdate error:", err.message);
  }
});

// ─── Helper: ask a question and wait for a reply ──────────────────────────────
async function ask(channel, userId, question, timeout = 60000) {
  await channel.send(question);
  const collected = await channel.awaitMessages({
    filter: m => m.author.id === userId,
    max: 1,
    time: timeout,
    errors: ["time"],
  }).catch(() => null);
  return collected?.first() ?? null;
}

// ─── Message handler ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ── $ping ──────────────────────────────────────────────────────────────────
  if (command === "ping") {
    const sent = await message.reply("pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    sent.edit(`pong! 🏓 \`${latency}ms\``);
  }

  // ── $vouch ─────────────────────────────────────────────────────────────────
  if (command === "vouch") {
    const embed = new EmbedBuilder()
      .setTitle("Vouch Us!")
      .setDescription(
        `➡️ Please type: **vouch ${message.author} ${args.join(" ")}** in <#1493626835182027043> to support us and show others that we are legit!`
      )
      .setColor(0x5865f2);

    message.channel.send({ embeds: [embed] });
  }

  // ── $inrole ────────────────────────────────────────────────────────────────
  if (command === "inrole") {
    const query = args.join(" ");
    if (!query) return message.reply("please provide a role name or ID.");

    const mentionMatch = query.match(/^<@&(\d+)>$/);
    let role = mentionMatch
      ? message.guild.roles.cache.get(mentionMatch[1])
      : message.guild.roles.cache.get(query);
    if (!role) {
      const lowerQuery = query.toLowerCase();
      role = message.guild.roles.cache
        .filter(r => r.name.toLowerCase().includes(lowerQuery))
        .sort((a, b) => {
          const ai = a.name.toLowerCase().indexOf(lowerQuery);
          const bi = b.name.toLowerCase().indexOf(lowerQuery);
          return ai - bi;
        })
        .first();
    }

    if (!role) return message.reply(`couldn't find a role matching **${query}**.`);

    const members = role.members.map(m => m.user.username).sort();
    if (members.length === 0) return message.reply(`no members in **${role.name}**.`);

    const pageSize = 20;
    const pages = [];
    for (let i = 0; i < members.length; i += pageSize) {
      pages.push(members.slice(i, i + pageSize));
    }

    let page = 0;
    const buildEmbed = (p) => new EmbedBuilder()
      .setTitle(`Members in ${role.name} — ${members.length} total`)
      .setDescription(pages[p].join("\n"))
      .setColor(role.color || 0x5865f2)
      .setFooter({ text: `Page ${p + 1}/${pages.length}` });

    const msg = await message.channel.send({ embeds: [buildEmbed(0)] });
    if (pages.length === 1) return;

    await msg.react("◀️");
    await msg.react("▶️");

    const collector = msg.createReactionCollector({
      filter: (reaction, user) =>
        ["◀️", "▶️"].includes(reaction.emoji.name) && user.id === message.author.id,
      time: 60000,
    });

    collector.on("collect", (reaction, user) => {
      reaction.users.remove(user.id);
      if (reaction.emoji.name === "▶️" && page < pages.length - 1) page++;
      else if (reaction.emoji.name === "◀️" && page > 0) page--;
      msg.edit({ embeds: [buildEmbed(page)] });
    });

    collector.on("end", () => msg.reactions.removeAll().catch(() => {}));
  }

  // ── $clearinvites ──────────────────────────────────────────────────────────
  if (command === "clearinvites") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("you don't have permission to do that.");
    }

    try {
      const invites = await message.guild.invites.fetch();
      let deleted = 0;

      for (const invite of invites.values()) {
        await invite.delete();
        deleted++;
      }

      message.reply(
        deleted > 0
          ? `done! deleted **${deleted}** invite${deleted !== 1 ? "s" : ""}.`
          : "no invites to delete."
      );
    } catch (err) {
      console.error(err);
      message.reply("something went wrong while deleting invites.");
    }
  }

  if (command === "rn") {
    const isTicketChannel = message.channel.name.startsWith("ticket-") || message.channel.topic?.includes(TICKET_CREATOR_ID);
    if (!isTicketChannel) {
      return message.reply("not a ticket.");
    }

    const newName = args.join(" ").trim();
    if (!newName) {
      return message.reply("please provide a new ticket name.");
    }

    try {
      await message.channel.setName(newName);
      return message.reply(`renamed ticket to **${newName}**.`);
    } catch (err) {
      console.error(err);
      return message.reply("something went wrong while renaming the ticket.");
    }
  }

  // ── $vanitysetup ───────────────────────────────────────────────────────────
  if (command === "vanitysetup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const ch = message.channel;
    const userId = message.author.id;

    await ch.send(new EmbedBuilder()
      .setTitle("🎀 Vanity Role Setup")
      .setDescription(
        "Let's set up a vanity status role reward. I'll ask you a few questions.\n" +
        "Type `cancel` at any time to abort."
      )
      .setColor(0x5865f2)
      .toJSON()
      ? { embeds: [new EmbedBuilder()
          .setTitle("🎀 Vanity Role Setup")
          .setDescription(
            "Let's set up a vanity status role reward. I'll ask you a few questions.\n" +
            "Type `cancel` at any time to abort."
          )
          .setColor(0x5865f2)] }
      : "🎀 **Vanity Role Setup** — type `cancel` at any time to abort."
    );

    // Step 1: texts
    const textMsg = await ask(
      ch, userId,
      "**Step 1/3 — Status text(s)**\nWhat text(s) should be in the member's custom status? " +
      "Separate multiple values with a comma.\n> Example: `discord.gg/myserver, .gg/myserver`"
    );
    if (!textMsg || textMsg.content.toLowerCase() === "cancel")
      return ch.send("❌ Setup cancelled.");

    const texts = textMsg.content.split(",").map(t => t.trim()).filter(Boolean);
    if (texts.length === 0) return ch.send("❌ No valid texts provided. Setup cancelled.");

    // Step 2: match type
    const matchMsg = await ask(
      ch, userId,
      "**Step 2/3 — Match type**\nShould the status **contain** the text, or must it be an **exact** match?\n" +
      "Reply with `contains` or `exact`."
    );
    if (!matchMsg || matchMsg.content.toLowerCase() === "cancel")
      return ch.send("❌ Setup cancelled.");

    const matchType = matchMsg.content.toLowerCase().trim();
    if (!["contains", "exact"].includes(matchType))
      return ch.send("❌ Invalid match type. Please reply with `contains` or `exact`. Setup cancelled.");

    // Step 3: roles
    const roleMsg = await ask(
      ch, userId,
      "**Step 3/3 — Role(s) to give**\nMention the role(s) to assign when the status matches. " +
      "You can mention multiple roles.\n> Example: `@VanityRep @Advertiser`"
    );
    if (!roleMsg || roleMsg.content.toLowerCase() === "cancel")
      return ch.send("❌ Setup cancelled.");

    const roleIds = [...roleMsg.content.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
    if (roleIds.length === 0)
      return ch.send("❌ No valid role mentions found. Please mention roles using @. Setup cancelled.");

    // Validate roles exist and bot can manage them
    const botMember = await message.guild.members.fetchMe();
    const botHighest = botMember.roles.highest.position;
    const validRoles = [];
    const invalidRoles = [];

    for (const id of roleIds) {
      const r = message.guild.roles.cache.get(id);
      if (!r) { invalidRoles.push(id); continue; }
      if (r.position >= botHighest) { invalidRoles.push(r.name + " (too high)"); continue; }
      validRoles.push(id);
    }

    if (validRoles.length === 0)
      return ch.send(`❌ None of the roles could be managed by the bot. Make sure the bot's role is above the target roles.`);

    // Save config
    const vanity = loadVanity();
    if (!vanity[message.guild.id]) vanity[message.guild.id] = [];
    vanity[message.guild.id].push({ texts, matchType, roles: validRoles });
    saveVanity(vanity);

    const roleNames = validRoles.map(id => `<@&${id}>`).join(", ");
    const textList = texts.map(t => `\`${t}\``).join(", ");

    const confirmEmbed = new EmbedBuilder()
      .setTitle("✅ Vanity Role Setup Complete")
      .setColor(0x57f287)
      .addFields(
        { name: "Status Text(s)", value: textList, inline: false },
        { name: "Match Type", value: matchType === "contains" ? "Status **contains** the text" : "Status must **exactly** match", inline: false },
        { name: "Role(s) to Give", value: roleNames, inline: false }
      )
      .setFooter({ text: invalidRoles.length > 0 ? `Skipped (too high or not found): ${invalidRoles.join(", ")}` : "All roles configured successfully." })
      .setTimestamp();

    ch.send({ embeds: [confirmEmbed] });
  }

  // ── $vanitylist ────────────────────────────────────────────────────────────
  if (command === "vanitylist") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const vanity = loadVanity();
    const configs = vanity[message.guild.id];

    if (!configs || configs.length === 0)
      return message.reply("no vanity configs set up for this server. Use `$vanitysetup` to create one.");

    const embed = new EmbedBuilder()
      .setTitle("🎀 Vanity Role Configs")
      .setColor(0x5865f2)
      .setTimestamp();

    configs.forEach((cfg, i) => {
      const textList = cfg.texts.map(t => `\`${t}\``).join(", ");
      const roleList = cfg.roles.map(id => `<@&${id}>`).join(", ");
      embed.addFields({
        name: `#${i + 1} — ${cfg.matchType === "contains" ? "Contains" : "Exact"}`,
        value: `**Text(s):** ${textList}\n**Role(s):** ${roleList}`,
        inline: false,
      });
    });

    embed.setFooter({ text: "Use $vanityremove <number> to remove a config." });
    message.channel.send({ embeds: [embed] });
  }

  // ── $vanityremove ──────────────────────────────────────────────────────────
  if (command === "vanityremove") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("you need the **Manage Roles** permission to use this.");
    }

    const index = parseInt(args[0], 10) - 1;
    const vanity = loadVanity();
    const configs = vanity[message.guild.id];

    if (!configs || configs.length === 0)
      return message.reply("no vanity configs to remove.");

    if (isNaN(index) || index < 0 || index >= configs.length)
      return message.reply(`please provide a valid config number between 1 and ${configs.length}. Use \`$vanitylist\` to see them.`);

    const removed = configs.splice(index, 1)[0];
    vanity[message.guild.id] = configs;
    saveVanity(vanity);

    const textList = removed.texts.map(t => `\`${t}\``).join(", ");
    message.reply(`✅ Removed config #${index + 1} (${textList}).`);
  }
});

client.login(process.env.DISCORD_TOKEN);
