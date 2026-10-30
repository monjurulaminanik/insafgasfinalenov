import { MongoClient } from 'mongodb';
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI environment variable is required");
const client = new MongoClient(uri);
await client.connect();
const db = client.db('InsafCorporation');

const allVouchers = await db.collection('vouchers').find({}).toArray();
console.log('=== All Vouchers in DB count:', allVouchers.length);
const salaryVouchers = allVouchers.filter(v =>
  v.refType === 'payroll' ||
  v.partyType === 'employee' ||
  v.type === 'journal' ||
  /salary|payroll/i.test(v.notes || '')
);
console.log('=== Salary / Payroll related Vouchers count:', salaryVouchers.length);
salaryVouchers.forEach(v => {
  console.log(v.voucherNo, '| Type:', v.type, '| RefType:', v.refType, '| Party:', v.partyName, '| Amount:', v.amount, '| Date:', v.date, '| Notes:', v.notes);
});

const allExpenses = await db.collection('expenses').find({}).toArray();
console.log('\n=== All Expenses count:', allExpenses.length);
allExpenses.forEach(e => {
  console.log(e.category, '| Amount:', e.amount, '| Desc:', e.description, '| Date:', e.date);
});

const allPayroll = await db.collection('payroll').find({}).toArray();
console.log('\n=== All Payroll runs count:', allPayroll.length);
allPayroll.forEach(p => {
  console.log(p.id, '| Employee:', p.employeeName, '| Month:', p.month, '| Net:', p.net, '| Status:', p.status, '| PaidAt:', p.paidAt, '| CreatedAt:', p.createdAt);
});

await client.close();
