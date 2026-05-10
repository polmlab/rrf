const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const PREFIX = "$";

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch(() => {});
  }
});

client.on("error", (err) => console.error("Client error:", err.message));

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "ping") {
    const sent = await message.reply("pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    sent.edit(`pong! 🏓 \`${latency}ms\``);
  }

  if (command === "vouch") {
    const embed = new EmbedBuilder()
      .setTitle("Vouch Us!")
      .setDescription(
        `➡️ Please type: **vouch ${message.author} ${args.join(" ")}** in <#1493626835182027043> to support us and show others that we are legit!`
      )
      .setColor(0x5865f2);

    message.channel.send({ embeds: [embed] });
  }

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
});

client.login(process.env.DISCORD_TOKEN);
