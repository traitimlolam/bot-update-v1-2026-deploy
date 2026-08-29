import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { withLock } from '../state/firestore';
import { withRetry } from '../util/retry';

export interface LeadInput {
  date?: Date;
  phone: string;
  customerName: string | null;
}

function formatDateDDMM(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

const TEMPLATE_SHEET_NAME = 'Tháng 9';

export function resolveTargetSheetName(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month === 8 || month === 9) {
    return TEMPLATE_SHEET_NAME;
  }
  return `Tháng ${month}`;
}

export function pickNextStaff(dropdownList: string[], lastAssigned: string | null): string {
  if (dropdownList.length === 0) {
    throw new Error('pickNextStaff: dropdown cột F đang rỗng, không có ai để gán');
  }
  if (lastAssigned === null) {
    return dropdownList[0];
  }
  const lastIndex = dropdownList.indexOf(lastAssigned);
  if (lastIndex === -1) {
    return dropdownList[0];
  }
  return dropdownList[(lastIndex + 1) % dropdownList.length];
}

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const credsPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!credsPath || !fs.existsSync(credsPath)) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_PATH is not set or file not found');
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: credsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function findSheetIdByTitle(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string
): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const match = meta.data.sheets?.find((s) => s.properties?.title === title);
  return match?.properties?.sheetId ?? null;
}

async function ensureSheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  targetTitle: string
): Promise<void> {
  const existingId = await findSheetIdByTitle(sheets, spreadsheetId, targetTitle);
  if (existingId !== null) return;

  const templateId = await findSheetIdByTitle(sheets, spreadsheetId, TEMPLATE_SHEET_NAME);
  if (templateId === null) {
    throw new Error(`ensureSheetExists: không tìm thấy tab mẫu "${TEMPLATE_SHEET_NAME}"`);
  }

  const duplicateResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: templateId,
            newSheetName: targetTitle,
          },
        },
      ],
    },
  });

  const newSheetId =
    duplicateResponse.data.replies?.[0]?.duplicateSheet?.properties?.sheetId ?? null;
  if (newSheetId === null) {
    throw new Error(`ensureSheetExists: nhân bản tab mẫu thất bại cho "${targetTitle}"`);
  }

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [`'${targetTitle}'!A2:E1000`, `'${targetTitle}'!G2:G1000`],
    },
  });
}

const MAX_TRACKED_ROWS = 1000;

async function findNextEmptyRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetTitle: string
): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A2:A${MAX_TRACKED_ROWS}`,
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]?.[0]) return i + 2;
  }
  return rows.length + 2;
}

async function getColumnFDropdownList(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetTitle: string,
  rowNumber: number
): Promise<string[]> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${sheetTitle}'!F${rowNumber}:F${rowNumber}`],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(dataValidation))))',
  });
  const dv = res.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
  const values = dv?.condition?.values ?? [];
  return values.map((v) => v.userEnteredValue ?? '').filter((v) => v !== '');
}

export function findLastValidAssignment(
  fColumnValuesTopToBottom: (string | null | undefined)[],
  currentDropdownList: string[]
): string | null {
  for (let i = fColumnValuesTopToBottom.length - 1; i >= 0; i--) {
    const value = fColumnValuesTopToBottom[i];
    if (value && currentDropdownList.includes(value)) return value;
  }
  return null;
}

async function findLastAssignedStaff(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetTitle: string,
  beforeRow: number,
  currentDropdownList: string[]
): Promise<string | null> {
  if (beforeRow <= 2) return null;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!F2:F${beforeRow - 1}`,
  });
  const rows = res.data.values ?? [];
  const values = rows.map((row) => row?.[0]);
  return findLastValidAssignment(values, currentDropdownList);
}

export async function appendLead(lead: LeadInput): Promise<string> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set');
  }

  const date = lead.date ?? new Date();
  const targetSheetName = resolveTargetSheetName(date);

  return withLock(`sheet:${spreadsheetId}:${targetSheetName}`, async () => {
    const sheets = await getSheetsClient();
    await withRetry(() => ensureSheetExists(sheets, spreadsheetId, targetSheetName));

    const rowNumber = await withRetry(() => findNextEmptyRow(sheets, spreadsheetId, targetSheetName));

    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${targetSheetName}'!A${rowNumber}:C${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[formatDateDDMM(date), lead.phone, lead.customerName ?? '']] },
      })
    );

    const existingValue = await withRetry(async () => {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${targetSheetName}'!F${rowNumber}`,
      });
      return res.data.values?.[0]?.[0] as string | undefined;
    });
    if (existingValue) {
      return existingValue;
    }

    const dropdownList = await withRetry(() =>
      getColumnFDropdownList(sheets, spreadsheetId, targetSheetName, rowNumber)
    );
    const lastAssigned = await withRetry(() =>
      findLastAssignedStaff(sheets, spreadsheetId, targetSheetName, rowNumber, dropdownList)
    );
    const assignedStaff = pickNextStaff(dropdownList, lastAssigned);

    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${targetSheetName}'!F${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[assignedStaff]] },
      })
    );

    return assignedStaff;
  });
}
