import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const sales = await db.collection("sales").find({}).toArray();
  console.log(`Total Sales Orders: ${sales.length}`);
  
  const deliveries = await db.collection("deliveries").find({}).toArray();
  console.log(`Total Deliveries: ${deliveries.length}`);

  const stockMoves = await db.collection("stockMovements").find({}).toArray();
  console.log(`Total Stock Movements: ${stockMoves.length}`);

  const salesMoves = stockMoves.filter(m => m.refType === "sales");
  console.log(`Stock movements with refType: 'sales': ${salesMoves.length}`);
  console.log("Sales movements summary:", salesMoves.map(m => ({
    id: m.id,
    type: m.type,
    dir: m.direction,
    mType: m.movementType,
    qty: m.quantity,
    productId: m.productId,
    productName: m.productName,
    refId: m.refId,
    notes: m.notes
  })));

  const deliveryMoves = stockMoves.filter(m => m.refType === "delivery");
  console.log(`\nStock movements with refType: 'delivery': ${deliveryMoves.length}`);
  console.log("Delivery movements summary:", deliveryMoves.map(m => ({
    id: m.id,
    type: m.type,
    dir: m.direction,
    mType: m.movementType,
    qty: m.quantity,
    productId: m.productId,
    productName: m.productName,
    refId: m.refId,
    notes: m.notes
  })));

  await client.close();
}

run().catch(console.error);
