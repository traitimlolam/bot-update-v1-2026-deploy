import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { withLock } from '../state/firestore';
import { withRetry } from '../util/retry';

/**
 * Cột E (Nguồn khách, mục 8): 1 trong 2 giá trị cố định khớp đúng chính tả với nhãn dropdown đã
 * có sẵn trên Sheet — không phải danh sách đọc live như dropdown cột F (mục 9), vì đây chỉ là phân
 * loại kênh do chính bot xác định, không phải danh sách nhân sự có thể đổi.
 */
export type LeadSource = 'Tin nhắn' | 'Cmt';

export interface LeadInput {
  /** Cột A: ngày ghi nhận dd/mm — mặc định thời điểm hiện tại, truyền tay được để test. */
  date?: Date;
  /** Cột B: số điện thoại đã qua phoneValidator, đúng 10 số. */
  phone: string;
  /** Cột C: tên khách, đã ghép đúng thứ tự họ tên Việt Nam (last_name + first_name) hoặc tên hiển thị comment; để trống nếu không lấy được. */
  customerName: string | null;
  /** Cột E: kênh phát sinh lead — "Tin nhắn" (Messenger trực tiếp) hoặc "Cmt" (comment trên Page). */
  source: LeadSource;
}

function formatDateDDMM(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Sheet mẫu ("form") dùng làm khuôn cho mọi tab tháng mới: header, data validation cột A/E/F
 * đều nhân bản từ đây — theo quyết định chủ dự án dùng chung 1 form duy nhất (Tháng 9).
 */
const TEMPLATE_SHEET_NAME = 'Tháng 9';

/**
 * Chọn tên tab theo tháng nhận lead (mục 8 mở rộng — quyết định chủ dự án):
 * lead của tháng 8 và tháng 9 gộp chung vào tab "Tháng 9" (giai đoạn chuyển đổi khi bot mới chạy);
 * từ tháng 10 trở đi, mỗi tháng có 1 tab riêng tên "Tháng {N}", tự tạo nếu chưa có.
 */
export function resolveTargetSheetName(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month === 8 || month === 9) {
    return TEMPLATE_SHEET_NAME;
  }
  return `Tháng ${month}`;
}

/**
 * Round-robin (mục 9, phiên bản mới): người kế tiếp = người ngay sau `lastAssigned` trong
 * danh sách dropdown **hiện tại** của cột F. Không dựa vào số thứ tự dòng cố định nên tự thích
 * ứng khi danh sách thêm/bớt người — chỉ cần biết ai được ghi gần nhất là suy ra được người tiếp theo.
 * Hàm thuần, không gọi API, dùng để unit test độc lập với `lastAssigned` là null (chưa có ai được
 * ghi trước đó) hoặc một cái tên không còn trong danh sách (đã bị xoá khỏi dropdown).
 */
export function pickNextStaff(dropdownList: string[], lastAssigned: string | null): string {
  if (dropdownList.length === 0) {
    throw new Error('pickNextStaff: dropdown cột F đang rỗng, không có ai để gán');
  }
  if (lastAssigned === null) {
    return dropdownList[0];
  }
  const lastIndex = dropdownList.indexOf(lastAssigned);
  if (lastIndex === -1) {
    // Người trước đó không còn trong danh sách (đã bị xoá khỏi dropdown) -> quay lại từ đầu.
    return dropdownList[0];
  }
  return dropdownList[(lastIndex + 1) % dropdownList.length];
}

const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Nếu `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` trỏ tới 1 file key JSON có thật (chạy local/dev) thì dùng
 * file đó; nếu không (triển khai trên Cloud Run/GCP với service account gắn sẵn cho service) thì để
 * `GoogleAuth` tự lấy Application Default Credentials — không cần bake key JSON vào image, đúng
 * khuyến nghị bảo mật của GCP cho compute identity. Đồng bộ với cách `state/firestore.ts` đã làm.
 */
async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const credsPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  const auth =
    credsPath && fs.existsSync(credsPath)
      ? new google.auth.GoogleAuth({ keyFile: credsPath, scopes: SHEETS_SCOPES })
      : new google.auth.GoogleAuth({ scopes: SHEETS_SCOPES });
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

/**
 * Đảm bảo tab `targetTitle` tồn tại — nếu chưa có, nhân bản tab mẫu (Tháng 9), rồi xoá text mẫu
 * từ dòng 2 trở đi ở cột A-G, **kể cả cột F** (mục 8b/9 phiên bản mới): tab mới bắt đầu trống hoàn
 * toàn ở cột F thay vì giữ lại bản copy từ tab mẫu như trước — round-robin giờ tự nối tiếp sang
 * tab tháng liền trước (`findLastValidAssignmentAcrossTabs`) thay vì dựa vào giá trị F chép sẵn.
 * **Tuyệt đối không đụng cột H** (mục 8/14 — ngoài phạm vi dự án), kể cả khi xoá dữ liệu mẫu ở tab
 * mới tạo. Không đụng định dạng/dropdown ở bất kỳ cột nào.
 */
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

  // Xoá text mẫu từ dòng 2 trở đi ở cột A-G (kể cả F — không còn giữ bản copy từ tab mẫu, mục 9)
  // VÀ tuyệt đối không đụng cột H (ngoài phạm vi dự án — mục 8/14). Header dòng 1 và toàn bộ data
  // validation/format (kể cả dropdown cột F) không bị ảnh hưởng vì chỉ xoá nội dung ô.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [`'${targetTitle}'!A2:G1000`],
    },
  });
}

const MAX_TRACKED_ROWS = 1000;

/**
 * Tìm dòng trống thật sự tiếp theo, dựa trên cột A (dòng chưa có Ngày = chưa từng ghi lead).
 * KHÔNG dùng `values.append` để tự tìm dòng: Sheets API xác định "hết bảng" dựa trên toàn bộ
 * hàng có dữ liệu ở BẤT KỲ cột nào (kể cả cột F đã pre-fill sẵn theo mục 9), không giới hạn theo
 * phạm vi cột truyền vào — nên nếu dùng append, lead thật sẽ luôn bị đẩy xuống sau các dòng demo
 * có sẵn giá trị F, không bao giờ dùng lại được các ô F đã pre-fill từ dòng 2. Tự dò dòng trống
 * theo cột A rồi ghi trực tiếp (`values.update`) mới tận dụng đúng các dòng đã pre-fill sẵn cột F.
 */
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

/** Đọc danh sách dropdown hiện tại của cột F tại 1 dòng cụ thể (data validation ONE_OF_LIST). */
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

/**
 * Quét ngược 1 danh sách giá trị cột F (thứ tự từ dòng 2 xuống dưới), trả về giá trị gần cuối
 * nhất **vẫn còn tồn tại trong `currentDropdownList`**. Bỏ qua ô trống VÀ bỏ qua luôn giá trị của
 * người đã bị xoá khỏi dropdown (không dừng lại ngay ở người đó) — nhờ vậy khi đúng người vừa được
 * gán gần nhất bị xoá khỏi danh sách, thuật toán vẫn tiếp nối đúng vị trí luân phiên từ người hợp lệ
 * gần nhất trước đó, thay vì nhảy thẳng về đầu danh sách một cách không công bằng.
 * Hàm thuần, không gọi API, để unit test độc lập các kịch bản thêm/bớt người.
 */
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

/**
 * Tên tab tháng liền trước `tabName` (mục 8b/9): "Tháng 10" -> "Tháng 9", "Tháng 11" -> "Tháng 10".
 * "Tháng 9" là tab gốc (không có tab nào trước đó) nên trả về `null`, cũng như bất kỳ tên tab nào
 * không theo đúng định dạng "Tháng {N}" (mục 14 — chuỗi lùi tab chỉ hiểu đúng quy ước đặt tên này).
 */
function previousMonthTabName(tabName: string): string | null {
  const match = tabName.match(/^Tháng (\d+)$/);
  if (!match) return null;
  const month = Number(match[1]);
  if (month <= 9) return null;
  return `Tháng ${month - 1}`;
}

/**
 * Đọc cột F của 1 tab rồi suy ra người được gán hợp lệ gần nhất (mục 9). Nếu tab hiện tại chưa có
 * lịch sử hợp lệ nào (kể cả khi tab chưa từng được tạo — tháng đó không có lead nào), tự lùi đệ quy
 * sang tab tháng liền trước để tiếp tục tìm, đảm bảo round-robin nối tiếp xuyên tháng thay vì
 * "reset" mỗi khi sang tab mới (mục 8b/9/14). Dừng lại khi tìm thấy người hợp lệ, hoặc khi đã lùi
 * tới trước cả tab gốc "Tháng 9" mà vẫn không thấy ai.
 *
 * `beforeRow` chỉ áp dụng cho LẦN GỌI ĐẦU (tab đang chuẩn bị ghi lead — chỉ quét các dòng phía trên
 * dòng vừa ghi); các lần lùi tab tiếp theo quét toàn bộ tab tháng trước vì không có ràng buộc dòng.
 */
async function findLastValidAssignmentAcrossTabs(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  currentDropdownList: string[],
  beforeRow?: number
): Promise<string | null> {
  const sheetId = await findSheetIdByTitle(sheets, spreadsheetId, tabName);
  if (sheetId !== null && !(beforeRow !== undefined && beforeRow <= 2)) {
    const lastRow = beforeRow !== undefined ? beforeRow - 1 : MAX_TRACKED_ROWS;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!F2:F${lastRow}`,
    });
    const rows = res.data.values ?? [];
    const values = rows.map((row) => row?.[0]);
    const found = findLastValidAssignment(values, currentDropdownList);
    if (found !== null) return found;
  }

  const previousTab = previousMonthTabName(tabName);
  if (previousTab === null) return null;
  return findLastValidAssignmentAcrossTabs(sheets, spreadsheetId, previousTab, currentDropdownList);
}

/**
 * Ghi 1 lead vào dòng trống tiếp theo của đúng tab tháng tương ứng (mục 8, 8b, R5).
 * Tự dò dòng trống theo cột A (`findNextEmptyRow`) rồi ghi trực tiếp cột A-C (Ngày, SĐT, Tên khách)
 * bằng `values.update` — KHÔNG dùng `values.append` (xem lý do ở `findNextEmptyRow`). Ghi thêm cột E
 * (Nguồn khách — "Tin nhắn"/"Cmt" theo `lead.source`, mục 8) bằng 1 lệnh `values.update` TÁCH RIÊNG
 * khỏi cột A-C để không đụng cột D xen giữa. Tuyệt đối KHÔNG đụng cột D, G, H của dòng mới. Sau đó
 * kiểm tra cột F của đúng dòng vừa ghi: nếu đã có sẵn giá trị (chỉ xảy
 * ra trên tab "Tháng 9" — dữ liệu pre-fill thật từ trước khi có bot, mục 8b) thì giữ nguyên và dùng
 * luôn giá trị đó; nếu còn trống thì tự tính người kế tiếp theo `pickNextStaff` + tìm lịch sử xuyên
 * tab qua `findLastValidAssignmentAcrossTabs` (mục 9) rồi ghi vào đúng ô đó. Tự tạo tab mới (nhân
 * bản form Tháng 9, cột F cũng được xoá trống — mục 8b) nếu tháng đó chưa có tab. Trả về tên nhân
 * viên phụ trách để lưu vào Firestore `conversations.assignedStaff` (mục 6).
 *
 * An toàn khi nhiều lead đến cùng lúc (R7 — "không để lệnh chồng chéo gây lỗi"): toàn bộ thao tác
 * đọc-tính-ghi cho CÙNG 1 tab tháng được serialize bằng `withLock` (khoá Firestore) — nếu không,
 * hai lead gần như đồng thời có thể cùng đọc được "dòng trống kế tiếp" hoặc "người được gán gần
 * nhất" giống nhau, dẫn tới ghi đè lên nhau hoặc gán trùng 1 nhân viên cho 2 lead. Lead ở tab tháng
 * khác không bị chặn lẫn nhau vì khoá theo tên tab.
 *
 * Mỗi lệnh gọi Sheets API được retry riêng lẻ (tối đa 3 lần, backoff tăng dần — mục 10) thay vì
 * retry cả hàm: `rowNumber` chỉ được xác định 1 lần rồi tái sử dụng, nên nếu bước ghi cột F thất bại
 * và phải thử lại, bước ghi cột A-C KHÔNG bị lặp lại vào dòng mới (tránh trùng lead khi retry).
 */
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

    // Ghi riêng cột E (không gộp vào vùng A:E) để tuyệt đối không đụng cột D xen giữa (mục 8).
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${targetSheetName}'!E${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[lead.source]] },
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
      findLastValidAssignmentAcrossTabs(sheets, spreadsheetId, targetSheetName, dropdownList, rowNumber)
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

/**
 * Tab theo dõi khách đã CLOSED nhưng nhắn lại hỏi thêm (mục 6 phiên bản mới) — giả định tab này đã
 * được tạo sẵn thủ công trên Sheet thật với header giống các tab tháng (A-H); bot không tự tạo tab
 * này nếu chưa có (khác với tab tháng ở mục 8b), chỉ đọc/ghi vào tab đã tồn tại.
 */
const FOLLOW_UP_SHEET_NAME = 'Hỏi lại';

interface LeadRowLocation {
  tabTitle: string;
  rowNumber: number;
  values: string[];
}

/**
 * Quét cột B (SĐT) của tất cả các tab "Tháng {N}" hiện có (không tính tab "Hỏi lại") để tìm dòng
 * lead cũ khớp đúng `phone`, trả về tên tab + số dòng + TOÀN BỘ giá trị cột A-H của dòng đó; trả về
 * `null` nếu không tìm thấy ở bất kỳ tab nào. Dừng ngay khi tìm thấy match đầu tiên (giả định 1 số
 * điện thoại chỉ xuất hiện ở đúng 1 dòng lead, khớp nguyên tắc "1 lead = 1 dòng" của mục 8).
 */
async function findLeadRowLocationByPhone(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  phone: string
): Promise<LeadRowLocation | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const monthTabTitles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((title): title is string => !!title && /^Tháng \d+$/.test(title));

  for (const tabTitle of monthTabTitles) {
    const columnBRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabTitle}'!B2:B${MAX_TRACKED_ROWS}`,
    });
    const rows = columnBRes.data.values ?? [];
    const matchIndex = rows.findIndex((row) => row?.[0] === phone);
    if (matchIndex === -1) continue;

    const rowNumber = matchIndex + 2;
    const rowRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabTitle}'!A${rowNumber}:H${rowNumber}`,
    });
    return { tabTitle, rowNumber, values: rowRes.data.values?.[0] ?? [] };
  }

  return null;
}

const LEAD_ROW_NOT_FOUND_RETRY_DELAYS_MS = [500, 1000, 2000];

/**
 * Google Sheets API đôi khi có độ trễ lan truyền ngắn giữa lúc ghi (`values.update` trong
 * `appendLead`) và lúc đọc lại gần như ngay lập tức (`values.get` trong `findLeadRowLocationByPhone`)
 * — nếu khách CLOSED nhắn lại rất nhanh ngay sau khi vừa chốt lead, có thể đọc không kịp thấy dòng
 * vừa ghi dù dữ liệu đã tồn tại thật trên Sheet (khác với lỗi mạng/5xx mà `withRetry` đã xử lý).
 * Thử lại thêm vài lần với khoảng nghỉ ngắn trước khi thực sự kết luận "không tìm thấy".
 */
async function findLeadRowLocationByPhoneWithRetry(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  phone: string
): Promise<LeadRowLocation | null> {
  for (let attempt = 0; attempt <= LEAD_ROW_NOT_FOUND_RETRY_DELAYS_MS.length; attempt++) {
    const location = await withRetry(() => findLeadRowLocationByPhone(sheets, spreadsheetId, phone));
    if (location) return location;
    if (attempt < LEAD_ROW_NOT_FOUND_RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, LEAD_ROW_NOT_FOUND_RETRY_DELAYS_MS[attempt]));
    }
  }
  return null;
}

/**
 * Ghi `rowValues` (đúng 8 giá trị cột A-H) vào dòng trống tiếp theo của tab "Hỏi lại" (dò dòng trống
 * theo cột A, tái sử dụng đúng `findNextEmptyRow` — bỏ qua dòng đã có dữ liệu). Dùng chung cho cả
 * `copyLeadToFollowUpSheet` (copy nguyên trạng) lẫn `updateLeadPhoneAndCopyToFollowUpSheet` (copy
 * sau khi đã sửa số điện thoại) — tránh cài trùng logic dò-dòng-trống-rồi-ghi ở 2 nơi.
 *
 * Khoá theo tên tab "Hỏi lại" (R7): 2 khách CLOSED nhắn lại gần như cùng lúc không được cùng đọc
 * "dòng trống kế tiếp" của tab "Hỏi lại" rồi ghi đè lên nhau.
 */
async function appendRowToFollowUpSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rowValues: string[]
): Promise<void> {
  await withLock(`sheet:${spreadsheetId}:${FOLLOW_UP_SHEET_NAME}`, async () => {
    const rowNumber = await withRetry(() =>
      findNextEmptyRow(sheets, spreadsheetId, FOLLOW_UP_SHEET_NAME)
    );
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${FOLLOW_UP_SHEET_NAME}'!A${rowNumber}:H${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowValues] },
      })
    );
  });
}

/**
 * Khách đã CLOSED nhắn lại hỏi thêm, không sửa số điện thoại (mục 6 phiên bản mới): tìm dòng lead cũ
 * theo số điện thoại đã ghi, copy TOÀN BỘ giá trị cột A-H NGUYÊN TRẠNG sang tab "Hỏi lại". Không tạo
 * dòng mới ở tab tháng, không đổi cột F/round-robin — đây chỉ là bản sao để nhân viên biết khách nào
 * đang hỏi lại, cần ưu tiên liên hệ, KHÔNG phải 1 lead mới.
 *
 * Nếu không tìm thấy dòng lead cũ nào khớp số điện thoại (vd `appendLead` từng thất bại và chỉ được
 * ghi log lỗi chứ chưa lên Sheet — mục 10), hàm throw để lớp gọi ngoài log lỗi, không âm thầm bỏ qua.
 */
export async function copyLeadToFollowUpSheet(phone: string): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set');
  }

  const sheets = await getSheetsClient();
  const location = await findLeadRowLocationByPhoneWithRetry(sheets, spreadsheetId, phone);
  if (!location) {
    throw new Error(
      `copyLeadToFollowUpSheet: không tìm thấy dòng lead nào khớp số điện thoại ${phone} ở bất kỳ tab tháng nào`
    );
  }

  await appendRowToFollowUpSheet(sheets, spreadsheetId, location.values);
}

/**
 * Khách đã CLOSED gửi lại số điện thoại HỢP LỆ nhưng KHÁC số đã ghi trước đó (mục 6, 8c): tìm dòng
 * lead cũ theo `oldPhone`, SỬA lại đúng cột B (SĐT) của dòng đó thành `newPhone` trên tab tháng gốc,
 * rồi copy dòng ĐÃ SỬA (không phải bản gốc) sang tab "Hỏi lại". Chỉ sửa cột B — tuyệt đối không đụng
 * các cột còn lại (tên khách, nguồn khách, nhân viên phụ trách... giữ nguyên như lần chốt lead đầu).
 *
 * Khoá theo tên tab tháng gốc (R7, giống `appendLead`) khi sửa cột B — tránh đụng độ với 1 lead khác
 * đang được ghi/đọc trên cùng tab đó cùng lúc; khoá riêng tab "Hỏi lại" khi copy (xem
 * `appendRowToFollowUpSheet`).
 */
export async function updateLeadPhoneAndCopyToFollowUpSheet(oldPhone: string, newPhone: string): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set');
  }

  const sheets = await getSheetsClient();
  const location = await findLeadRowLocationByPhoneWithRetry(sheets, spreadsheetId, oldPhone);
  if (!location) {
    throw new Error(
      `updateLeadPhoneAndCopyToFollowUpSheet: không tìm thấy dòng lead nào khớp số điện thoại cũ ${oldPhone} ở bất kỳ tab tháng nào`
    );
  }

  await withLock(`sheet:${spreadsheetId}:${location.tabTitle}`, () =>
    withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${location.tabTitle}'!B${location.rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[newPhone]] },
      })
    )
  );

  const updatedValues = [...location.values];
  updatedValues[1] = newPhone;
  await appendRowToFollowUpSheet(sheets, spreadsheetId, updatedValues);
}
