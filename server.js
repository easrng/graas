// @ts-check
import betterSqlite3 from "better-sqlite3";
import dotenv from "dotenv";
import { DOMParser } from "xmldom";
dotenv.config();

const { INSTANCE, TOKEN, SECRET, INTRO_POST, INTRO_POST_URL, WEB, ACCOUNT_URL, PORT, HOSTNAME } = process.env;

/**
 * @param {string} name 
 * @param {unknown} param 
 * @returns {asserts param is string}
 */
function isString(name, param) {
  if(typeof param !== "string") {
      throw new Error(name + "is not a string")
  }
}
isString('INSTANCE', INSTANCE);
isString('TOKEN', TOKEN);
isString('SECRET', SECRET);
isString('INTRO_POST', INTRO_POST);
isString('INTRO_POST_URL', INTRO_POST_URL);
isString('WEB', WEB);
isString('ACCOUNT_URL', ACCOUNT_URL);
isString('PORT', PORT);
isString('HOSTNAME', HOSTNAME);

const kv = (() => {
  const db = betterSqlite3("./.data/kv.db");
  db.exec(`
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);
  const _setItem = db.prepare(`INSERT INTO kv (key, value)
  VALUES(?, ?)
  ON CONFLICT(key)
  DO UPDATE SET value=excluded.value;`);
  const _getItem = db.prepare(`SELECT value FROM kv WHERE key=?`);
  const _removeItem = db.prepare(`DELETE FROM kv WHERE key=?`);
  return {
    getItem: (k, _) => (
      (_ = _getItem.get(k)), _ ? JSON.parse(_.value) : undefined
    ),
    setItem: (k, v) => _setItem.run(k, JSON.stringify(v)),
    removeItem: (k) => _removeItem.run(k),
  };
})();
import express from "express";
import bodyParser from "body-parser";
import megalodon_ from "megalodon";
/** @type {typeof megalodon_} */
const megalodon = /** @type {any}*/(megalodon_).default;
const client = megalodon("mastodon", "https://" + INSTANCE, TOKEN);
const stream = await client.userStreaming();
stream.on("connect", () => {
  console.log("connect");
});
stream.on("error", (err) => {
  console.error(err);
});
stream.on("close", () => {
  console.log("close");
});
import { webcrypto as crypto } from "crypto";
stream.on("parser-error", (err) => {
  console.error(err);
});
const getCode = async (handle) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(handle + SECRET)
      )
    ).slice(0, 4)
  )
    .reduce((a, b) => (a << 8) + b, 0)
    .toString()
    .slice(1);
async function startProcess(acct) {
  console.log("start process for @" + acct);
  const user = kv.getItem("user-@" + acct) || {};
  user.code = user.code || (await getCode("@" + acct));
  kv.setItem("user-@" + acct, user);
  const s = await client.postStatus(
    `
Alright @${acct}, let's get you verified!
There are a few steps:
 • Get some paper
 • Legibly write ${user.code}
 • Crumple the paper
 • Unfold the paper so it is readable
 • Go outside
 • Take a picture with the paper visible of your hand touching a plant¹ growing out of the ground
 • Reply to this message with your picture
 
 ¹ Grass is preferred but not required`.trim(),
    {
      in_reply_to_id: INTRO_POST,
      visibility: "direct",
      language: "en",
    }
  );
}
async function alreadyVerified(user, replyTo) {
  await client.postStatus(
    `${user} You're already verified! You can share your verified status at https://${WEB}/user/${user}
If you put that link in your profile metadata it'll show a checkmark, proving to the world that you have touched grass.`,
    {
      in_reply_to_id: replyTo,
      visibility: "direct",
      language: "en",
    }
  );
}
const handleNotification = async (notification) => {
  try {
    if (
      notification.type === "favourite" &&
      notification.status.id === INTRO_POST
    ) {
      const user = kv.getItem("user-@" + notification.account.acct) || {};
      if (user.verified) {
        alreadyVerified("@" + notification.account.acct, INTRO_POST);
      } else {
        await startProcess(notification.account.acct);
      }
    } else if (
      notification.type === "mention" &&
      notification.status.visibility === "direct"
    ) {
      const user =
        kv.getItem("user-@" + notification.status.account.acct) || {};
      if (user && user.verified) {
        return await alreadyVerified(
          "@" + notification.status.account.acct,
          notification.status.id
        );
      }
      if (user && user.code) {
        if (notification.status.media_attachments.length > 0) {
          (user.imgs = user.imgs || []).push(
            ...notification.status.media_attachments.map((e) => e.url)
          );
          user.lastReply = notification.status.id;
          kv.setItem("user-@" + notification.status.account.acct, user);
          kv.setItem("pending-verification", [
            ...(kv.getItem("pending-verification") || []),
            "@" + notification.status.account.acct,
          ]);
          await client.postStatus(
            `@easrng@crimew.gay it's graas verification time! https://${WEB}/admin/dash.html`,
            {
              visibility: "direct",
              language: "en",
            }
          );
          const s = await client.postStatus(
            `@${notification.status.account.acct} Great! We'll get back to you when your account is verified.`,
            {
              in_reply_to_id: notification.status.id,
              visibility: "direct",
              language: "en",
            }
          );
          user.lastReply = s.data.id;
          kv.setItem("user-@" + notification.status.account.acct, user);
        } else {
          await client.postStatus(
            `@${notification.status.account.acct} Please attatch an image to your reply.`,
            {
              in_reply_to_id: notification.status.id,
              visibility: "direct",
              language: "en",
            }
          );
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
};
stream.on("notification", getNewNotifications);
const app = express();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.get('/', (req, res) => {
  res.render("index", {
    account: ACCOUNT_URL
  });
})
app.get("/verify", async (req, res) => {
  const user = typeof req.query.handle === "string" && req.query.handle.replace(/^@/, "").split("@");
  if (!user || user.length !== 2) {
    return res.status(400).contentType("txt").send("invalid handle");
  }
  const url = new URL("https://domain/.well-known/webfinger");
  url.hostname = user[1];
  const acct = "acct:" + user[0] + "@" + user[1]
  url.searchParams.set("resource", acct);
  let links;
  try {
    try {
      ({ links } = await (await fetch(url)).json());
    } catch (e) {
      const url = new URL("https://domain/.well-known/host-meta");
      url.hostname = user[1];
      const res = await fetch(url);
      if (res.ok) {
        const xml = await res.text();
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const template = doc.getElementsByTagNameNS("http://docs.oasis-open.org/ns/xri/xrd-1.0", "Link")[0].getAttribute("template");
        if (!template) {
          throw new Error("no webfinger template url")
        }
        const url = template.replace("{uri}", encodeURIComponent(acct));
        ({ links } = await (await fetch(url)).json());
      } else {
        throw e;
      }
    }
  } catch (e) {
    console.warn(e);
    return res
      .status(500)
      .contentType("txt")
      .send("failed to look up @" + user[0] + "@" + url.hostname);
  }
  try {
    const interact = new URL(
      links
        .find((e) => e.rel === "http://ostatus.org/schema/1.0/subscribe")
        .template.replace(
          "{uri}",
          encodeURIComponent(INTRO_POST_URL)
        )
    );
    interact.protocol = "https:";
    res.redirect(interact.href);
  } catch (e) {
    console.warn(e);
    res
      .status(500)
      .contentType("txt")
      .send(
        "the instance you're on (" +
          url.hostname +
          ") doesn't support remote interactions"
      );
  }
});
app.get("/user/:handle", async (req, res) => {
  const match = req.params.handle.match(/^(@[^@\/]+@([^@\/]+))$/);
  if (!match) {
    return res.status(400).contentType("txt").send("invalid handle");
  }
  let data;
  try {
    data = await (
      await fetch(
        `https://${INSTANCE}/api/v1/accounts/search?q=${encodeURIComponent(
          match[1]
        )}&resolve=true&limit=1`,
        {
          headers: { Authorization: "Bearer " + TOKEN },
        }
      )
    ).json();
  } catch (e) {
    return res.status(500).contentType("txt").send("failed to look up handle");
  }
  const [account] = data;
  if (!account) {
    return res.status(404).contentType("txt").send("account not found");
  }
  const handle = "@" + account.acct;
  const username = account.display_name || account.username;
  const verified = kv.getItem("user-" + handle)?.verified;
  res.render("user", {
    json: JSON.stringify(account),
    pfp: account.avatar,
    username,
    handle,
    profile: account.url,
    relme: verified ? " me" : "",
    status: verified
      ? "✅ " + username + " is a verified grass-toucher."
      : "⚠️ " + username + " may need to touch grass.",
    image: verified
      ? "/verified.png"
      : "/unverified.png",
  });
});
app.get("/admin", (req, res) => res.redirect("/admin/dash.html"));
app.get("/admin/pending", (req, res) => {
  const pending = kv.getItem("pending-verification") || [];
  res.json(pending.map((e) => ({ name: e, data: kv.getItem("user-" + e) })));
});
app.post("/admin/setVerified", async (req, res) => {
  try {
    const user = kv.getItem("user-" + req.body.user);
    if (!user) throw new Error("no user");
    if (req.body.verified === "true") {
      user.verified = true;
    } else {
      delete user.verified;
    }
    kv.setItem("user-" + req.body.user, user);
    kv.setItem(
      "pending-verification",
      (kv.getItem("pending-verification") || []).filter(
        (e) => e !== req.body.user
      )
    );
    await client.postStatus(
      `${req.body.user} ${
        user.verified
          ? `You're verified! You can share your verified status at https://${WEB}/user/${req.body.user}
If you put that link in your profile metadata it'll show a checkmark, proving to the world that you have touched grass.`
          : "Hmm, that image didn't look quite right, try again?"
      }`,
      {
        in_reply_to_id: user.lastReply,
        visibility: "direct",
        language: "en",
      }
    );
    res
      .contentType("txt")
      .send(
        "set verified=" +
          user.verified +
          ", notified user, and removed from pending"
      );
  } catch (e) {
    res.contentType("txt").send(e.stack);
  }
});
const listener = app.listen(Number.parseInt(PORT, 10), HOSTNAME, () => {
  console.log(`Your app is listening on port ${/** @type {any} */(listener.address()).port}`);
});

async function getNewNotifications() {
  const notifs = await client.getNotifications({
    min_id: kv.getItem("min-notif-id") || 0,
  });
  if (notifs.data.length === 0) {
    return [];
  }
  await Promise.all(notifs.data.map((e) => handleNotification(e)));
  kv.setItem("min-notif-id", notifs.data[0].id);
  return [...notifs.data, await getNewNotifications()];
}

getNewNotifications();
setInterval(getNewNotifications, 1000 * 60 * 1);
