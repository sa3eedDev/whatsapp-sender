const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const XLSX = require("xlsx");

const workbook = XLSX.readFile("whatsapp.xlsx");

const sheet = workbook.Sheets["whatsapp"];

const data = XLSX.utils.sheet_to_json(sheet);

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on("qr", qr => {
    qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {

    console.log("WhatsApp Ready!");

    for (const row of data) {

        const phone = String(row["الرقم"]).trim();

        const message = row["الرساله"];

        const chatId = `966${phone.substring(1)}@c.us`;

        try {

            await client.sendMessage(chatId, message);

            console.log(`Sent to ${phone}`);

        } catch (err) {

            console.log(`Failed ${phone}`);

        }

        await new Promise(r => setTimeout(r, 3000));
    }

    console.log("Done");
});

client.initialize();