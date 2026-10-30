const dns = require("node:dns");
const { MongoClient } = require("mongodb");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const uri = (process.env.MONGODB_URI || "");
const client = new MongoClient(uri);

async function checkConnection() {
  try {
    await client.connect();
    console.log("✅ MongoDB Atlas Connected Successfully!");
  } catch (error) {
    console.error("❌ Connection failed:", error.message);
  } finally {
    await client.close();
  }
}

checkConnection();