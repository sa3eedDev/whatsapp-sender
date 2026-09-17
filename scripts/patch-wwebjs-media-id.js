#!/usr/bin/env node
/**
 * WhatsApp Web MediaData models expose an enumerable private `__x_id`.
 * whatsapp-web.js spreads that model into the outgoing Msg, which overwrites
 * the real MsgKey and crashes getSender() with:
 *   "Data passed to getter must include an id property"
 * Text messages never hit this path. Re-apply after every npm install.
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "whatsapp-web.js",
  "src",
  "util",
  "Injected",
  "Utils.js"
);

if (!fs.existsSync(target)) process.exit(0);

const marker = "delete message.__x_id;";
let source = fs.readFileSync(target, "utf8");
if (source.includes(marker)) process.exit(0);

// Prefer restoring a previously broken/commented patch.
const broken = [
  "//delete message.__x_id;",
  "//delete message;",
];
for (const bad of broken) {
  if (source.includes(bad)) {
    fs.writeFileSync(target, source.replace(bad, marker));
    console.log("Patched whatsapp-web.js media __x_id collision");
    process.exit(0);
  }
}

const needle = `            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)`;

const insert = `            ...extraOptions,
        };

        // MediaData is a model whose private ID field collides with Msg's
        // private ID field when its enumerable properties are spread above.
        delete message.__x_id;

        // Bot's won't reply if canonicalUrl is set (linking)`;

if (!source.includes(needle)) {
  console.warn(
    "whatsapp-web.js Utils.js layout changed; media __x_id patch not applied"
  );
  process.exit(0);
}

fs.writeFileSync(target, source.replace(needle, insert));
console.log("Patched whatsapp-web.js media __x_id collision");
