# HR/payroll integration contract

Integration status: the generic CRUD protections described below are implemented in `financial-write-guards.ts` and `data.functions.ts`, including transactional employee deletion checks. Journal and asset mutations also use dedicated transaction endpoints. Run `npm test` and `npm run build` before publishing changes.

## চূড়ান্ত মডেল

`PayrollRun` (`src/types/index.ts`) optional fields:

```ts
advanceSettlements?: { advanceId: string; amount: number }[];
advanceRecovered?: number;
cashPaid?: number;
paymentRequestId?: string;
```

`net = basic + bonus + allowance - deduction` অর্জিত নিট বেতন। অগ্রিম সমন্বয় ordinary deduction নয়। Paid payroll-এ `net = advanceRecovered + cashPaid`; `advanceRecovered` allocations-এর যোগফল। পুরোনো paid records-এ settlement অনুপস্থিত হলে recovery শূন্য, cash `net`।

`salaryAdvances` collection (`SalaryAdvance`, `src/lib/payroll.ts`): `id`, `employeeId`, `employeeName`, `date` (ISO timestamp), `amount`, `paymentMethod`। Mongo `_id` request UUID-ভিত্তিক এবং unique। Immutable disbursement; allocation paid payroll-এ থাকে। Outstanding = advance amount minus সব paid payroll-এর matching allocations। Draft কোনো advance reserve করে না।

`employees.payrollRevision` transaction serialization field; employee public type-এ প্রয়োজন নেই। একই কর্মীর সব payroll/advance mutation একই employee document update করে, Mongo transaction write-conflict retry duplicate draft/advance reuse ঠেকায়।

## Accounting agent-এর জন্য

- Advance voucher এবং ledger: `refType: "salaryAdvance"`, `refId: advance.id`, employee party metadata voucher-এ। Ledger `category: "payment"`, direction `out`; advance disbursement একটি asset, salary expense নয়। Shared `Voucher.refType` এবং `LedgerEntry.refType` union-এ `"salaryAdvance"` যোগ প্রয়োজন।
- Salary voucher/ledger: `refType: "payroll"`, `refId: run.id`; `amount` শুধু cashPaid। Earned salary expense পুরো run.net; advance settlement asset কমায়। Recovery দ্বিতীয় cash outflow নয়।
- পূর্ণ advance settlement-এ zero-amount payroll voucher থাকে; zero cash ledger থাকে না। এতে payroll reference/expense recognition হারাবে না।
- Payment voucher date Asia/Dhaka business day; paidAt ISO timestamp। Financial cash report payment date ধরে, monthly HR report salary month ধরে।
- Balance sheet/statement-এ advance asset নির্ণয়ে salaryAdvance vouchers এবং payroll.advanceSettlements/advanceRecovered ব্যবহার করুন। Employee নামের মধ্যে “Salary” থাকলেও advance-কে expense classify করবেন না; explicit refType-কে অগ্রাধিকার দিন।

## Shared server owner-এর জন্য প্রয়োজনীয় guard

`data.functions.ts` generic CRUD-এ `payroll` create/update/remove/claim নিষিদ্ধ করুন; নতুন dedicated `payrollFn` একমাত্র write entry point হবে। শুধু draft অনুমতি দিলেও duplicate/paid mutation bypass থেকে যাবে। `employees` remove-এ বিদ্যমান payroll/advance থাকলে block করাও প্রয়োজন, যাতে transaction serialization ও historical records orphan না হয়।

Generic voucher/ledger update/remove/create-এ `refType: payroll | salaryAdvance` records সুরক্ষিত রাখা প্রয়োজন; linked accounting entries সরাসরি বদলালে immutable payment/settlement-এর সঙ্গে হিসাব অমিল হতে পারে।

পুরোনো `_services.ts` HR payroll write methods সরানো হয়েছে। সব UI `hr.service.ts` ব্যবহার করে। EmployeeRoster profile save আর salary draft বানায় না এবং paid status দিয়ে bank debit করে না। Payment কেবল explicit monthly payroll form থেকে হয়। Inventory service অংশ HR কাজ থেকে অপরিবর্তিত।

## Atomicity ও যাচাই

`payroll.functions.ts`: authentication, schema validation, permissions; pay requires payroll.update। `payroll.server.ts`: employee lock, draft save/delete, advance, pay, voucher, ledger এবং mandatory audit একই session/transaction-এ। Audit failure-এও সম্পূর্ণ rollback; existing logAudit-এর session-বিহীন/in-memory fallback ব্যবহার করা হয়নি।

Request UUID + immutable payload comparison payment/advance retry idempotent রাখে। Confirmed validation failures typed response দেয় এবং UI explicit reset করতে পারে। Driver/network uncertainty-তে একই request ও payload রাখা হয়। Mongo standalone-এ transaction unavailable হলে write fail হবে; non-atomic fallback নেই।

Tests: `npx --no-install tsx --test tests/payroll.test.ts tests/payroll-transaction.test.ts`। Transaction tests session-enforcing in-memory transactional double; কোনো live DB পরীক্ষা করা হয়নি।
