import { formatCurrency } from "@/utils/formatters";
import type { PartyStatementModel, StatementLine } from "@/lib/party-statement";

export type LedgerExportPayload = {
  company: string;
  title: string;
  partyName: string;
  phone: string;
  period: string;
  openingLabel: string;
  opening: string;
  totalDebitLabel: string;
  totalDebit: string;
  totalCreditLabel: string;
  totalCredit: string;
  closingLabel: string;
  closing: string;
  columns: {
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: string;
    credit: string;
    balance: string;
  };
  rows: {
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    balanceLabel: string;
  }[];
  fileBase: string;
};

function fileBase(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*]+/g, "").trim() || "ledger";
  return cleaned.slice(0, 80);
}

export function buildLedgerExportPayload(opts: {
  company: string;
  title: string;
  statement: PartyStatementModel;
  period: string;
  openingLabel: string;
  totalDebitLabel: string;
  totalCreditLabel: string;
  closingLabel: string;
  columns: LedgerExportPayload["columns"];
  typeLabel: (line: StatementLine) => string;
  formatDate: (iso: string) => string;
  balanceSuffix: (line: StatementLine) => string;
}): LedgerExportPayload {
  const { statement } = opts;
  return {
    company: opts.company,
    title: opts.title,
    partyName: statement.partyName,
    phone: statement.phone,
    period: opts.period,
    openingLabel: opts.openingLabel,
    opening: formatCurrency(Math.abs(statement.openingBalance)),
    totalDebitLabel: opts.totalDebitLabel,
    totalDebit: formatCurrency(statement.totalDebit),
    totalCreditLabel: opts.totalCreditLabel,
    totalCredit: formatCurrency(statement.totalCredit),
    closingLabel: opts.closingLabel,
    closing: formatCurrency(Math.abs(statement.closingBalance)),
    columns: opts.columns,
    rows: statement.lines.map((line) => ({
      date: opts.formatDate(line.date),
      type: opts.typeLabel(line),
      reference: line.reference || "",
      description: line.description || line.particulars || "",
      debit: line.debit || 0,
      credit: line.credit || 0,
      balance: line.balance,
      balanceLabel: `${formatCurrency(Math.abs(line.balance))} ${opts.balanceSuffix(line)}`.trim(),
    })),
    fileBase: fileBase(`${statement.partyName}-ledger`),
  };
}

export async function exportLedgerExcel(payload: LedgerExportPayload) {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [
    [payload.company],
    [payload.title],
    [],
    ["Name", payload.partyName],
    ["Phone", payload.phone],
    ["Period", payload.period],
    [payload.openingLabel, payload.opening],
    [payload.totalDebitLabel, payload.totalDebit],
    [payload.totalCreditLabel, payload.totalCredit],
    [payload.closingLabel, payload.closing],
    [],
    [
      payload.columns.date,
      payload.columns.type,
      payload.columns.reference,
      payload.columns.description,
      payload.columns.debit,
      payload.columns.credit,
      payload.columns.balance,
    ],
    ...payload.rows.map((row) => [
      row.date,
      row.type,
      row.reference,
      row.description,
      row.debit || "",
      row.credit || "",
      row.balanceLabel,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 36 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ledger");
  XLSX.writeFile(wb, `${payload.fileBase}.xlsx`);
}

export async function exportLedgerPdf(payload: LedgerExportPayload) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  let y = 16;
  doc.setFontSize(14);
  doc.text(payload.company, margin, y);
  y += 7;
  doc.setFontSize(11);
  doc.text(payload.title, margin, y);
  y += 8;
  doc.setFontSize(9);
  const meta = [
    `Name: ${payload.partyName}`,
    `Phone: ${payload.phone}`,
    `Period: ${payload.period}`,
    `${payload.openingLabel}: ${payload.opening}`,
    `${payload.totalDebitLabel}: ${payload.totalDebit}`,
    `${payload.totalCreditLabel}: ${payload.totalCredit}`,
    `${payload.closingLabel}: ${payload.closing}`,
  ];
  for (const line of meta) {
    doc.text(line, margin, y);
    y += 5;
  }
  autoTable(doc, {
    startY: y + 2,
    head: [
      [
        payload.columns.date,
        payload.columns.type,
        payload.columns.reference,
        payload.columns.description,
        payload.columns.debit,
        payload.columns.credit,
        payload.columns.balance,
      ],
    ],
    body: payload.rows.map((row) => [
      row.date,
      row.type,
      row.reference,
      row.description,
      row.debit ? formatCurrency(row.debit) : "—",
      row.credit ? formatCurrency(row.credit) : "—",
      row.balanceLabel,
    ]),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
    margin: { left: margin, right: margin },
    tableWidth: "auto",
  });
  doc.save(`${payload.fileBase}.pdf`);
}
