import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { loadMessages } from '../config/loadConfig';
import { formatPersonalizedMessage, determineCustomerGender, analyzeVietnameseName, Gender } from '../utils/genderDetector';
import {
  ConversationRecord,
  FlowInput,
  newConversation,
  OutgoingMessage,
  processInput,
  ReplyIntent,
  getPhoneCadence,
} from '../flow/flowEngine';
import { checkPhone, PhoneErrorType } from '../flow/phoneValidator';
import {
  AiHistoryEntry,
  checkAndSaveMidInFirestore,
  getConversation,
  getDb,
  isHumanTakeoverActive,
  getTimestampMillis,
  logError,
  saveConversation,
  setLastCommentId,
  setLastHumanReplyAt,
  setLastProcessedMessageAt,
  StoredConversation,
  touchFollowUpTracked,
  updateAiHistory,
  withLock,
} from '../state/firestore';
import {
  appendLead,
  copyLeadToFollowUpSheet,
  LeadSource,
  updateLeadPhoneAndCopyToFollowUpSheet,
} from '../services/sheetsService';
import { generateAiReply } from '../ai/geminiService';
import { withRetry } from '../util/retry';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
// ---------------------------------------------------------------------------
// Chống trùng lặp Webhook & Debounce theo PSID (Idempotency & Burst Protection)
// ---------------------------------------------------------------------------

const processedMids = new Map<string, number>();
const lastProcessedAtByPsid = new Map<string, number>();

/**
 * Kiểm tra mã tin nhắn: Mỗi tin nhắn từ Facebook đều có message.mid duy nhất.
 * Lưu mid vào bộ nhớ đệm và Firestore. Nếu mid đã tồn tại thì return true (bỏ qua ngay lập tức).
 */
export async function isDuplicateMid(mid?: string): Promise<boolean> {
  if (!mid) return false;
  const now = Date.now();

  // 1. Kiểm tra nhanh trong memory cache
  if (processedMids.has(mid)) {
    return true;
  }
  processedMids.set(mid, now);

  if (processedMids.size > 5000) {
    for (const [key, time] of processedMids.entries()) {
      if (now - time > 10 * 60 * 1000) processedMids.delete(key);
    }
  }

  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  // 2. Kiểm tra và ghi nhận trong Firestore (chia sẻ giữa các Cloud Run container instances)
  const isDuplicateInDb = await checkAndSaveMidInFirestore(mid);
  if (isDuplicateInDb) {
    return true;
  }

  return false;
}

/**
 * Khóa chống trùng theo thời gian (Debounce 4 giây):
 * Trong Firestore, ghi nhận lastProcessedMessageAt = Date.now().
 * Nếu có một sự kiện mới đến từ cùng 1 PSID trong vòng 4 giây kể từ tin trước, lập tức bỏ qua (return ngay).
 */
export async function isPsidDebounced(psid: string, debounceMs: number = 4000): Promise<boolean> {
  if (!psid) return false;
  const now = Date.now();

  // 1. Kiểm tra nhanh trong memory cache
  const lastMemoryTime = lastProcessedAtByPsid.get(psid);
  if (lastMemoryTime && now - lastMemoryTime < debounceMs) {
    return true;
  }
  lastProcessedAtByPsid.set(psid, now);

  if (lastProcessedAtByPsid.size > 5000) {
    for (const [key, time] of lastProcessedAtByPsid.entries()) {
      if (now - time > 10 * 60 * 1000) lastProcessedAtByPsid.delete(key);
    }
  }

  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  // 2. Kiểm tra trong Firestore (chia sẻ giữa các Cloud Run instances)
  try {
    const conv = await getConversation(psid);
    if (conv?.lastProcessedMessageAt) {
      const lastTime = getTimestampMillis(conv.lastProcessedMessageAt);
      if (lastTime > 0 && now - lastTime < debounceMs) {
        return true;
      }
    }
    // Ghi nhận ngay mốc thời gian vào Firestore để chặn các container instances khác
    await setLastProcessedMessageAt(psid, now);
    return false;
  } catch {
    return false;
  }
}

/**
 * Reset cache deduplication và debounce phục vụ unit tests.
 */
export function resetWebhookDeduplicationForTest(): void {
  processedMids.clear();
  lastProcessedAtByPsid.clear();
}

/**
 * Thời gian chờ ngẫu nhiên giữa 2 tin nhắn/bong bóng (2 đến 3 giây) để giống người nhắn thật.
 * Trong môi trường test: 0ms để test chạy tức thì.
 */
export function getRandomMessageDelayMs(): number {
  if (process.env.NODE_ENV === 'test') return 0;
  return 2000 + Math.floor(Math.random() * 1001);
}

// Debounce ghi tab "Hỏi lại" (mục 8c, mở rộng theo yêu cầu chủ dự án): khách CLOSED nhắn qua lại
// liên tục trong thời gian ngắn mà KHÔNG có gì mới (không có số, hoặc số giống hệt số cũ) chỉ tạo
// 1 dòng mỗi 30 phút, tránh dòng rác. Không áp dụng cho trường hợp khách SỬA số điện thoại — sửa số
// là thông tin thật sự mới, luôn được ghi ngay bất kể debounce (xem các nơi gọi bên dưới).
const FOLLOW_UP_DEBOUNCE_MS = 30 * 60 * 1000;

function isFollowUpDebounceElapsed(lastTrackedAt: { toMillis(): number } | null | undefined): boolean {
  if (!lastTrackedAt) return true;
  return Date.now() - lastTrackedAt.toMillis() >= FOLLOW_UP_DEBOUNCE_MS;
}

// ---------------------------------------------------------------------------
// Verify GET (Facebook webhook handshake)
// ---------------------------------------------------------------------------

export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
}

// ---------------------------------------------------------------------------
// Signature verification (R7 / mục 15 bước 3) — hàm thuần, test được bằng fixture.
// ---------------------------------------------------------------------------

export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedHash = signatureHeader.slice('sha256='.length);
  const computedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expectedHash, 'hex');
  const computedBuf = Buffer.from(computedHash, 'hex');
  if (expectedBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, computedBuf);
}

// ---------------------------------------------------------------------------
// Facebook Send API — lớp mỏng gọi Graph API (retry theo mục 10).
// ---------------------------------------------------------------------------

async function callSendApi(body: Record<string, unknown>): Promise<{ recipient_id?: string }> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  return withRetry(async () => {
    const response = await fetch(`${GRAPH_BASE_URL}/me/messages?access_token=${pageAccessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Facebook Send API error ${response.status}: ${text}`);
    }
    return (await response.json()) as { recipient_id?: string };
  });
}

export type Recipient = { id: string } | { comment_id: string };

export async function sendTypingOn(recipient: Recipient): Promise<void> {
  try {
    await callSendApi({ recipient, sender_action: 'typing_on' });
  } catch (err) {
    console.warn('[sendTypingOn] Bỏ qua lỗi typing_on (không làm gián đoạn gửi tin nhắn):', err);
  }
}

export async function sendText(recipient: Recipient, text: string): Promise<string | undefined> {
  const result = await callSendApi({
    recipient,
    messaging_type: 'RESPONSE',
    message: { text },
  });
  return result.recipient_id;
}

async function sendQuickReplyButtons(psid: string, text: string): Promise<void> {
  const messages = loadMessages();
  await callSendApi({
    recipient: { id: psid },
    messaging_type: 'RESPONSE',
    message: {
      text,
      quick_replies: messages.buttons.map((b) => ({
        content_type: 'text',
        title: b.label,
        payload: b.payload,
      })),
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gọi Gemini sinh câu trả lời cho 1 `ReplyIntent` (mục 4.2 mở rộng, `flow/flowEngine.ts`) và trả về
 * lịch sử đã cập nhật để caller tự quyết định lúc nào persist (`updateAiHistory`) — tách khỏi việc
 * ghi Firestore để hàm này dùng chung được cho cả `runFlowTurn` lẫn các nhánh comment hand-rolled.
 *
 * Chỉ trả `updatedHistory` (để caller lưu lại) cho 2 intent KHÔNG BAO GIỜ phát sinh từ 1 tin có chứa
 * số điện thoại — `AI_TOPIC`/`AI_FREE_TEXT` (mục 5.2/5.3: chỉ được gọi khi `phoneValidator` xác nhận
 * tin không có chuỗi số ứng viên nào). 3 intent còn lại (`AI_PHONE_CONFIRMED`/`AI_PHONE_INVALID`/
 * `AI_FOLLOWUP_CLOSED`) luôn phát sinh đúng lúc tin nhắn CÓ thể chứa số điện thoại thật của khách —
 * cố tình KHÔNG lưu vào `aiHistory` để tuyệt đối không rò rỉ số điện thoại vào lịch sử gửi cho AI
 * (mục 4.2: "trường này không bao giờ chứa số điện thoại thật của khách").
 *
 * Fallback bắt buộc (mục 4.2, AC16): nếu Gemini lỗi/timeout (đã hết retry trong `generateAiReply`)
 * hoặc trả rỗng, dùng lại nguyên văn `aiFallbackText` làm câu trả lời thay thế thay vì để khách
 * không nhận được tin nào, đồng thời log lỗi để theo dõi tần suất fallback.
 */
async function resolveIntentText(
  intent: ReplyIntent,
  userText: string,
  history: AiHistoryEntry[],
  customerName: string | null,
  isNewCustomer: boolean,
  knownGender?: Gender | null,
  shouldAskPhone?: boolean,
  phoneMilestone?: 1 | 2 | 3
): Promise<{ text: string; updatedHistory?: AiHistoryEntry[] }> {
  const shouldPersistHistory = intent.kind === 'AI_TOPIC' || intent.kind === 'AI_FREE_TEXT';

  try {
    const replyText = await generateAiReply({
      intent,
      userText,
      history,
      customerName,
      isNewCustomer,
      knownGender,
      shouldAskPhone,
      phoneMilestone,
    });
    return {
      text: replyText,
      updatedHistory: shouldPersistHistory
        ? [...history, { role: 'user', text: userText }, { role: 'model', text: replyText }]
        : undefined,
    };
  } catch (err) {
    await logError('generateAiReply', err, { intentKind: intent.kind });
    const fallbackText = formatPersonalizedMessage(loadMessages().aiFallbackText, customerName, userText, knownGender);
    return {
      text: fallbackText,
      updatedHistory: shouldPersistHistory
        ? [...history, { role: 'user', text: userText }, { role: 'model', text: fallbackText }]
        : undefined,
    };
  }
}

/**
 * Gửi tuần tự danh sách `OutgoingMessage` (= `ReplyIntent[]`, không còn message code cố định nào),
 * mỗi tin cách nhau >=2s kèm typing_on (mục 4). Trả về PSID nếu recipient ban đầu là comment_id và
 * Facebook trả về recipient_id thật.
 *
 * `keepOriginalRecipient` (mặc định false, giữ hành vi cũ cho luồng BUTTON/TEXT vốn đã gọi bằng
 * { id: psid } — chuyển sang { id } sau tin đầu không ảnh hưởng gì vì đã là { id } sẵn): khi true,
 * KHÔNG tự chuyển sang { id: resolvedPsid } sau tin đầu tiên dù Facebook có trả recipient_id — dùng
 * cho trường hợp gửi tiếp các tin còn lại qua Private Reply ({ comment_id }) cho người CHỈ MỚI
 * comment, chưa từng chủ động nhắn tin: nếu đổi sang { id }, Facebook từ chối với lỗi 551/1545041
 * "Người này hiện không có mặt" vì người đó chưa mở cuộc trò chuyện thật — phải giữ nguyên comment_id
 * cho MỌI tin.
 *
 * `resolveIntentTextFn`: bắt buộc phải truyền — mọi phần tử của `items` đều là `ReplyIntent`, cần
 * gọi AI (có fallback) để dịch ra câu chữ thật, không còn message code cố định nào để tự tra nữa.
 */
/**
 * Giới hạn cứng số lượng bong bóng: Mỗi lượt phản hồi CHỈ ĐƯỢC PHÉP BĂM TỐI ĐA 3 BONG BÓNG TIN NHẮN (tối đa 3 tin).
 * Tuyệt đối không được băm thành 4 hay 5 tin nhắn.
 * Nếu chuỗi câu trả lời tách ra nhiều hơn 3 đoạn, bắt buộc gộp các câu ngắn lại để đảm bảo mảng trả về có độ dài từ 1 đến 3 phần tử.
 */
export function splitMessageIntoBubbles(text: string): string[] {
  if (!text) return [];
  const clean = text.trim();
  if (!clean) return [];
  let parts: string[] = [];

  if (clean.includes('\n\n')) {
    parts = clean
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (clean.includes('\n')) {
    parts = clean
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    return [clean];
  }

  if (parts.length === 0) return [clean];
  if (parts.length <= 3) return parts;

  // Nếu nhiều hơn 3 phần, bắt buộc gộp lại để tối đa đúng 3 bong bóng:
  // Giữ phần cuối (thường là câu xin số / CTA) làm bong bóng thứ 3
  const last = parts[parts.length - 1];
  const first = parts[0];
  const middle = parts.slice(1, parts.length - 1).join('\n\n');
  return [first, middle, last].filter(Boolean);
}

export const MAX_BUBBLES_PER_TURN = 3;

/**
 * Làm sạch câu trả lời của AI ở bong bóng thứ 2 (lượt 1):
 * - Xóa bỏ lời chào ở đầu câu (vì bong bóng 1 đã chào chuẩn mực).
 * - Xóa bỏ lời xin số / Zalo ở cuối câu (vì bong bóng 3 đã có câu xin số chuẩn mực kèm tài liệu).
 * - Xóa bỏ các câu hỏi mở không cần thiết (mua đầu tư hay làm nhà vườn).
 */
export function cleanAnswerBubble(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  // 1. Xóa lời chào mở đầu nếu AI lỡ viết thêm
  cleaned = cleaned
    .replace(/^(dạ\s+)?(em\s+)?chào\s+(anh\/chị|anh\s+chị|anh|chị)[^.!?\n]*[.!?\n]*/i, "")
    .trim();

  // 2. Xóa lời xin số / Zalo ở cuối nếu AI viết kèm (hỗ trợ cả sau dấu chấm hoặc xuống dòng)
  cleaned = cleaned
    .replace(/(?:\n+|[.!?]\s*)[^\n.!?]*(xin|gửi|cho\s+em|kết\s+nối|kết\s+bạn|để\s+lại)[^\n.!?]*(số|sđt|zalo|điện\s+thoại)[^.!?\n]*[.!?]?$/i, ".")
    .trim();

  // 3. Xóa các câu hỏi mở như hỏi mua đầu tư hay làm nhà vườn
  cleaned = cleaned
    .replace(/(?:\n+|[.!?]\s*)[^\n.!?]*(anh\/chị|anh|chị)\s+(muốn\s+)?(mua\s+)?(để\s+)?(đầu\s+tư|làm\s+nhà\s+vườn|nghỉ\s+dưỡng|để\s+ở)[^.!?\n]*[.!?]?$/i, ".")
    .trim();

  cleaned = cleaned.replace(/\.+$/, ".");

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned || text.trim();
}

async function sendMessageSequence(
  recipient: Recipient,
  items: OutgoingMessage[],
  keepOriginalRecipient: boolean,
  resolveIntentTextFn: (intent: ReplyIntent) => Promise<string | string[]>
): Promise<string | undefined> {
  let resolvedPsid: string | undefined;
  let currentRecipient = recipient;
  let totalSentBubbles = 0;

  for (let i = 0; i < items.length; i++) {
    if (totalSentBubbles >= MAX_BUBBLES_PER_TURN) break;

    const item = items[i];
    const resolved = await resolveIntentTextFn(item);
    const bubbles = Array.isArray(resolved) ? resolved : splitMessageIntoBubbles(resolved);

    for (let b = 0; b < bubbles.length; b++) {
      if (totalSentBubbles >= MAX_BUBBLES_PER_TURN) break;

      await sendTypingOn(currentRecipient);
      const recipientId = await sendText(currentRecipient, bubbles[b]);
      totalSentBubbles++;

      if (recipientId && !resolvedPsid) {
        resolvedPsid = recipientId;
        if (!keepOriginalRecipient) {
          currentRecipient = { id: recipientId };
        }
      }
      if (b < bubbles.length - 1 && totalSentBubbles < MAX_BUBBLES_PER_TURN) {
        await delay(getRandomMessageDelayMs());
      }
    }

    if (i < items.length - 1 && totalSentBubbles < MAX_BUBBLES_PER_TURN) {
      await delay(getRandomMessageDelayMs());
    }
  }
  return resolvedPsid;
}

// ---------------------------------------------------------------------------
// Orchestration: flowEngine + Firestore + Sheets + round-robin (mục 5, 6, 8, 9)
// ---------------------------------------------------------------------------

async function loadOrCreateConversation(psid: string): Promise<StoredConversation> {
  const stored = await getConversation(psid);
  return stored ?? { ...newConversation(), lastFlowSentAt: null };
}

/**
 * Chạy 1 lượt flow: xử lý input, gửi message tương ứng, ghi Sheet nếu có lead (round-robin được
 * tính ngay trong `appendLead` dựa trên dropdown cột F — mục 9), rồi persist state mới vào Firestore.
 * Không để lỗi ở bước sau rollback bước trước đã thành công (mục 10).
 *
 * Toàn bộ hàm được khoá theo PSID (R7): Facebook có thể gửi webhook trùng (retry khi ack chậm)
 * hoặc khách bấm/nhắn liên tiếp rất nhanh, khiến 2 lượt xử lý cho CÙNG 1 khách chạy chồng lên nhau
 * — nếu không khoá, cả hai đều đọc cùng 1 state Firestore cũ, có thể cùng ghi lead 2 lần vào Sheet
 * và gửi tin xác nhận đã nhận số 2 lần. Khoá đảm bảo các lượt của cùng 1 khách luôn chạy tuần tự.
 *
 * `getCustomerName` là hàm lazy — chỉ gọi (và chỉ tốn 1 lời gọi Graph API lấy first_name/last_name)
 * khi thật sự chốt được lead, tránh gọi API vô ích ở mọi tin nhắn khác.
 */
export async function runFlowTurn(
  psid: string,
  input: FlowInput,
  _getCustomerName?: () => Promise<string | null>,
  overrideRecipient?: Recipient
): Promise<void> {
  await withLock(`psid:${psid}`, async () => {
    const current = await loadOrCreateConversation(psid);

    // Kiểm tra lại Human Takeover ngay bên trong lock: nếu nhân viên đang chat trực tiếp, bot lập tức giữ im lặng
    if (isHumanTakeoverActive(current.lastHumanReplyAt)) {
      console.log(`[humanTakeover] Bot giữ im lặng vì nhân viên đang chat trực tiếp với PSID ${psid}`);
      return;
    }


    const result = processInput(current, input);

    // Nếu khách gửi số sai hoặc thiếu số (AI_PHONE_INVALID): không tính lượt này vào các mốc xin số thông thường
    const isInvalidPhone = result.messagesToSend.length === 1 && result.messagesToSend[0].kind === 'AI_PHONE_INVALID';
    const customerMessageCount = isInvalidPhone
      ? (current.customerMessageCount ?? 0)
      : (current.customerMessageCount ?? 0) + 1;
    current.customerMessageCount = customerMessageCount;

    // mục 5.2: chỉ khách NEW mới cần AI chào ở đầu câu trả lời.
    const isNewCustomer = current.state === 'NEW';
    // `commentId` khác null khi lượt này đến từ 1 bình luận (mục 5.3) — dùng để chọn recipient khi
    // gửi (giữ nguyên comment_id cho MỌI tin, xem `sendMessageSequence`) VÀ để lưu lại `lastCommentId`
    // cho `services/reminderService.ts` fallback đúng kiểu recipient khi gửi tin nhắc 20h (mục 5.4).
    const commentId = overrideRecipient && 'comment_id' in overrideRecipient ? overrideRecipient.comment_id : null;

    // Lấy tên và giới tính khách để xưng hô chuẩn xác:
    // KHÓA CỨNG GIỚI TÍNH (Lock on First Detection):
    // Đọc thẳng giá trị đã lưu trong Firestore. Nếu đã có customerName và gender !== 'UNKNOWN',
    // TUYỆT ĐỐI KHÔNG phân tích lại, không để nội dung tin nhắn mới làm thay đổi.
    let customerName = current.customerName ?? null;
    let gender = current.gender ?? null;
    let avatarUrl = current.avatarUrl ?? null;

    const userText = input.type === 'TEXT' ? input.text : input.type === 'FEED_COMMENT' ? input.text ?? '' : '';

    if (!customerName || !gender || gender === 'UNKNOWN') {
      if (process.env.NODE_ENV === 'test') {
        if (!customerName && _getCustomerName) customerName = await _getCustomerName();
        if (!gender || gender === 'UNKNOWN') {
          const nameAnalysis = analyzeVietnameseName(customerName, userText);
          gender = nameAnalysis.gender;
        }
      } else {
        try {
          let profile = await fetchCustomerProfile(psid);
          // Cơ chế thử lại nhanh 1 lần nếu ở tin đầu Graph API trả về rỗng do chưa kịp đồng bộ chỉ mục
          if (!profile.name) {
            await delay(250);
            profile = await fetchCustomerProfile(psid);
          }
          if (profile.name) customerName = profile.name;
          if (profile.profilePicUrl) avatarUrl = profile.profilePicUrl;

          const genderResult = await determineCustomerGender({
            customerName,
            avatarUrl: avatarUrl || profile.profilePicUrl,
            contextText: userText,
            isSilhouette: profile.isSilhouette,
          });
          if (genderResult.gender !== 'UNKNOWN') {
            gender = genderResult.gender;
          } else if (!gender) {
            gender = 'UNKNOWN';
          }
        } catch (err) {
          await logError('determineCustomerGender', err, { psid });
          if (!gender) gender = 'UNKNOWN';
        }
      }

      // Khóa cứng ngay vào đối tượng current để sử dụng xuyên suốt phiên này
      if (customerName) current.customerName = customerName;
      if (gender && gender !== 'UNKNOWN') current.gender = gender;
      if (avatarUrl) current.avatarUrl = avatarUrl;
    }

    const phoneCadence = getPhoneCadence(customerMessageCount, userText);

    if (result.messagesToSend.length > 0) {
      try {
        const targetRecipient: Recipient = overrideRecipient ?? { id: psid };
        const keepOriginal = commentId !== null;

        // Khống chế cứng: Mỗi lượt chat CHỈ gửi đúng 1 intent của AI (không tách lời chào thành intent riêng)
        const itemsToSend: OutgoingMessage[] = result.messagesToSend.slice(0, 1);

        const isFirstQuestion =
          customerMessageCount === 1 &&
          (result.messagesToSend[0].kind === 'AI_FREE_TEXT' || result.messagesToSend[0].kind === 'AI_TOPIC');

        let updatedAiHistory: AiHistoryEntry[] | undefined;
        const intentResolver = async (intent: ReplyIntent): Promise<string | string[]> => {
          const { text, updatedHistory } = await resolveIntentText(
            intent,
            userText,
            current.aiHistory ?? [],
            customerName,
            isNewCustomer,
            gender,
            phoneCadence.askPhone,
            phoneCadence.milestone
          );
          if (updatedHistory) updatedAiHistory = updatedHistory;

          // Lượt hỏi đầu tiên của khách: Cố định cấu trúc đúng 3 bong bóng
          // Bong bóng 1: Chào hỏi lịch sự theo đúng danh xưng (Dạ em chào anh/chị ạ)
          // Bong bóng 2: Trả lời ngắn gọn, đúng trọng tâm câu hỏi của khách (giá, diện tích, sổ đỏ, vị trí)
          // Bong bóng 3: BẮT BUỘC câu xin số Zalo kèm lợi ích gửi tài liệu (sơ đồ phân lô, bảng giá)
          if (isFirstQuestion) {
            const { callName } = analyzeVietnameseName(customerName);
            const greetingTemplate = gender === 'FEMALE'
              ? (callName ? `Dạ em chào chị ${callName} ạ!` : 'Dạ em chào chị ạ!')
              : gender === 'MALE'
              ? (callName ? `Dạ em chào anh ${callName} ạ!` : 'Dạ em chào anh ạ!')
              : 'Dạ em chào anh/chị ạ!';
            const bubble1 = greetingTemplate;
            const bubble2 = cleanAnswerBubble(text);

            const isNoZalo = /(khong|k|ko|chua)\s*(dung|xai|co)?\s*zalo|gui\s*(qua|tren)?\s*(fb|mess|facebook)/i.test(
              userText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            );
            const defaultBubble3 = isNoZalo
              ? 'Em có sẵn sơ đồ phân lô và bảng giá chi tiết từng vị trí, em gửi qua tin nhắn Facebook này cho mình xem luôn nhé!'
              : 'Em có sẵn sơ đồ phân lô và bảng giá chi tiết từng vị trí, anh/chị cho em xin số Zalo để em gửi qua cho mình tiện xem nhé!';
            const bubble3 = formatPersonalizedMessage(defaultBubble3, customerName, userText, gender);
            return [bubble1, bubble2, bubble3].filter(Boolean);
          }

          return text;
        };

        await sendMessageSequence(targetRecipient, itemsToSend, keepOriginal, intentResolver);

        if (updatedAiHistory) {
          try {
            await updateAiHistory(psid, updatedAiHistory);
          } catch (err) {
            await logError('updateAiHistory', err, { psid });
          }
        }
      } catch (err) {
        await logError('sendMessageSequence', err, { psid, input });
      }
    }

    let askPhoneCount = current.askPhoneCount ?? 0;
    let lastAskedPhoneTurn = current.lastAskedPhoneTurn ?? null;
    if (phoneCadence.askPhone) {
      askPhoneCount += 1;
      lastAskedPhoneTurn = customerMessageCount;
    }

    let finalRecord: ConversationRecord = {
      ...result.record,
      customerMessageCount,
      askPhoneCount,
      lastAskedPhoneTurn: lastAskedPhoneTurn ?? null,
      customerName: customerName ?? current.customerName ?? null,
      gender: gender ?? current.gender ?? null,
      avatarUrl: avatarUrl ?? current.avatarUrl ?? null,
      lastProcessedMessageAt: Date.now(),
    };

    if (result.leadPhone) {
      try {
        // Dùng lại đúng `customerName` đã lấy ở đầu hàm (mục 8) — KHÔNG gọi lại `getCustomerName()`
        // lần 2 ở đây: vừa tốn thêm 1 lời gọi Graph API vô ích, vừa có rủi ro trả về tên khác với
        // tên đã dùng để cá nhân hoá câu trả lời AI vừa gửi cho khách trong CÙNG lượt này, khiến
        // tên ghi trên Sheet lệch với đại từ xưng hô khách vừa nhận được.
        // Cột E (mục 8): số điện thoại đến từ tin nhắn Messenger -> "Tin nhắn"; đến từ nội dung
        // comment (FEED_COMMENT) -> "Cmt". BUTTON không bao giờ tạo leadPhone nên không cần xét.
        const source: LeadSource = input.type === 'FEED_COMMENT' ? 'Cmt' : 'Tin nhắn';
        const assignedStaff = await appendLead({
          phone: result.leadPhone,
          customerName,
          source,
          psid,
        });
        finalRecord = { ...finalRecord, assignedStaff };
      } catch (err) {
        // Không được để mất lead: log lỗi đầy đủ để xử lý thủ công (mục 10).
        await logError('appendLead', err, {
          psid,
          phone: result.leadPhone,
        });
      }
    } else if (result.trackFollowUp && current.phone) {
      // Khách đã CLOSED từ trước nhắn lại, không phải 1 lần gõ sai định dạng số (mục 6, 8c — đã gửi
      // AI_FOLLOWUP_CLOSED ở bước trên). Nếu vừa gửi lại số hợp lệ KHÁC số cũ (result.correctedPhone) -> đây là 1
      // lần SỬA số, phải sửa lại cột B trên tab tháng gốc trước khi copy — luôn ghi ngay, không qua
      // debounce vì là thông tin mới. Ngược lại (không có gì thay đổi) mới áp dụng debounce 30 phút
      // (FOLLOW_UP_DEBOUNCE_MS) trước khi copy nguyên trạng dòng lead cũ. Không tạo lead mới, không
      // đụng cột F/round-robin ở cả 2 nhánh.
      try {
        if (result.correctedPhone) {
          await updateLeadPhoneAndCopyToFollowUpSheet(current.phone, result.correctedPhone);
          await touchFollowUpTracked(psid);
        } else if (isFollowUpDebounceElapsed(current.lastFollowUpTrackedAt)) {
          await copyLeadToFollowUpSheet(current.phone);
          await touchFollowUpTracked(psid);
        }
      } catch (err) {
        await logError('followUpSheetTracking', err, {
          psid,
          phone: current.phone,
          correctedPhone: result.correctedPhone,
        });
      }
    }

    try {
      await saveConversation(psid, finalRecord);
    } catch (err) {
      await logError('saveConversation', err, { psid, finalRecord });
    }

    // mục 5.4: ghi lại kênh của lượt này để reminderService chọn đúng kiểu recipient khi gửi tin
    // nhắc 20h — comment_id thật nếu lượt này là bình luận, null nếu là nhắn tin trực tiếp (đã tự
    // chứng minh {id: psid} gửi được).
    try {
      await setLastCommentId(psid, commentId);
    } catch (err) {
      await logError('setLastCommentId', err, { psid, commentId });
    }
  });
}

// ---------------------------------------------------------------------------
// Messenger: messages + postbacks
// ---------------------------------------------------------------------------

interface MessagingEvent {
  sender: { id: string };
  recipient?: { id: string };
  message?: {
    mid?: string;
    text?: string;
    quick_reply?: { payload?: string };
    is_echo?: boolean;
    app_id?: number | string;
  };
  postback?: { payload?: string };
}

const KNOWN_BUTTON_PAYLOADS = ['BTN_LOCATION', 'BTN_LEGAL', 'BTN_PRICE'] as const;

function isKnownButtonPayload(
  payload: string | undefined
): payload is (typeof KNOWN_BUTTON_PAYLOADS)[number] {
  return !!payload && (KNOWN_BUTTON_PAYLOADS as readonly string[]).includes(payload);
}

export interface CustomerProfile {
  name: string | null;
  profilePicUrl: string | null;
  isSilhouette?: boolean;
}

/**
 * Lấy thông tin họ tên và URL ảnh đại diện của khách hàng (Facebook Graph API):
 * 1. Query trực tiếp `/{psid}?fields=first_name,last_name,name,profile_pic`: Trả về cả họ tên và avatar URL.
 * 2. Fallback sang `/me/conversations?user_id=${psid}` nếu chưa lấy được tên.
 * 3. Fallback sang `/{psid}/picture?type=large&redirect=false` để lấy URL avatar và cờ `is_silhouette`.
 */
export async function fetchCustomerProfile(psid: string): Promise<CustomerProfile> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return { name: null, profilePicUrl: null, isSilhouette: false };

  let name: string | null = null;
  let profilePicUrl: string | null = null;
  let isSilhouette = false;

  // Bước 1: Query User Profile Node
  try {
    const userRes = await fetch(
      `${GRAPH_BASE_URL}/${psid}?fields=first_name,last_name,name,profile_pic&access_token=${pageAccessToken}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (userRes.ok) {
      const userData = (await userRes.json()) as {
        first_name?: string;
        last_name?: string;
        name?: string;
        profile_pic?: string;
      };
      if (userData.name && userData.name.trim()) {
        name = userData.name.trim();
      } else {
        const combined = [userData.last_name, userData.first_name].filter(Boolean).join(' ').trim();
        if (combined) name = combined;
      }
      if (userData.profile_pic) {
        profilePicUrl = userData.profile_pic;
      }
    }
  } catch {
    // fallback tiếp
  }

  // Bước 2: Query qua Page Conversations Inbox nếu chưa có tên
  if (!name) {
    try {
      const convUrl = `${GRAPH_BASE_URL}/me/conversations?user_id=${psid}&fields=participants,senders&access_token=${pageAccessToken}`;
      const convRes = await fetch(convUrl, { signal: AbortSignal.timeout(3500) });
      if (convRes.ok) {
        const convData = (await convRes.json()) as {
          data?: Array<{
            participants?: { data?: Array<{ id: string; name?: string }> };
            senders?: { data?: Array<{ id: string; name?: string }> };
          }>;
        };
        const conversation = convData.data?.[0];
        const participant =
          conversation?.participants?.data?.find((p) => p.id === psid) ||
          conversation?.senders?.data?.find((s) => s.id === psid);
        if (participant?.name && participant.name.trim()) {
          name = participant.name.trim();
        }
      }
    } catch {
      // bỏ qua
    }
  }

  // Bước 3: Query picture endpoint nếu chưa có profilePicUrl
  if (!profilePicUrl) {
    try {
      const picRes = await fetch(
        `${GRAPH_BASE_URL}/${psid}/picture?type=large&redirect=false&access_token=${pageAccessToken}`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (picRes.ok) {
        const picData = (await picRes.json()) as {
          data?: { url?: string; is_silhouette?: boolean };
        };
        if (picData.data?.url) {
          profilePicUrl = picData.data.url;
          isSilhouette = picData.data.is_silhouette ?? false;
        }
      }
    } catch {
      // bỏ qua
    }
  }

  return { name, profilePicUrl, isSilhouette };
}

async function fetchCustomerName(psid: string): Promise<string | null> {
  const profile = await fetchCustomerProfile(psid);
  return profile.name;
}

async function handleMessagingEvent(event: MessagingEvent): Promise<void> {
  const psid = event.sender?.id;
  const text = event.message?.text;
  const mid = event.message?.mid;

  if (!psid) return;

  // 1. Kiểm tra mã tin nhắn: Mỗi tin nhắn từ Facebook đều có message.mid duy nhất.
  // Lưu mid vào bộ nhớ đệm và Firestore. Nếu mid đã tồn tại thì return bỏ qua ngay lập tức.
  if (mid && (await isDuplicateMid(mid))) {
    console.log(`[handleMessagingEvent] Bỏ qua webhook trùng lặp mid=${mid} từ PSID ${psid}`);
    return;
  }

  // 2. Khóa chống trùng theo thời gian (Debounce 4 giây):
  // Trong Firestore, ghi nhận lastProcessedMessageAt = Date.now().
  // Nếu có một sự kiện mới đến từ cùng 1 PSID trong vòng 4 giây kể từ tin trước, lập tức bỏ qua (return ngay).
  if (await isPsidDebounced(psid, 4000)) {
    console.log(`[handleMessagingEvent] Bỏ qua webhook dồn dập (debounce 4s) từ PSID ${psid}`);
    return;
  }

  console.log(`[handleMessagingEvent] Nhận tin nhắn từ PSID ${psid}: "${text ?? ''}"`);

  // Kiểm tra Human Takeover (nhường người thật chat trong vòng 10 phút)
  const conversation = await getConversation(psid);
  if (isHumanTakeoverActive(conversation?.lastHumanReplyAt)) {
    console.log(`[humanTakeover] Bot giữ im lặng 100% vì nhân viên đang chat trực tiếp với PSID ${psid}`);
    return;
  }

  if (event.postback?.payload === 'GET_STARTED') {
    // Khách mở cửa sổ chat lần đầu (mục 5.1) -> gửi tin có 3 quick-reply button, chưa chạy flowEngine.
    await handleFirstOpen(psid);
    return;
  }

  const buttonPayload = event.postback?.payload ?? event.message?.quick_reply?.payload;
  if (isKnownButtonPayload(buttonPayload)) {
    await runFlowTurn(psid, { type: 'BUTTON', payload: buttonPayload }, () => fetchCustomerName(psid));
    return;
  }

  if (typeof text === 'string' && text.length > 0) {
    await runFlowTurn(psid, { type: 'TEXT', text }, () => fetchCustomerName(psid));
  }
}

/**
 * Nếu PSID này đã CLOSED từ trước (vd đã cho số hợp lệ qua kênh khác), tuyệt đối không gửi lại
 * menu 3 nút dù Facebook có gửi lại postback GET_STARTED (bot đã bàn giao — mục 6, AC6).
 */
async function handleFirstOpen(psid: string): Promise<void> {
  await withLock(`psid:${psid}`, async () => {
    try {
      const current = await getConversation(psid);
      if (current && current.state === 'CLOSED') {
        return;
      }
      if (current && isHumanTakeoverActive(current.lastHumanReplyAt)) {
        console.log(`[humanTakeover] Bỏ qua handleFirstOpen vì nhân viên đang chat trực tiếp với PSID ${psid}`);
        return;
      }
      await sendTypingOn({ id: psid });

      let customerName = current?.customerName ?? null;
      let gender = current?.gender ?? null;
      let avatarUrl = current?.avatarUrl ?? null;

      if (!customerName || !gender || gender === 'UNKNOWN') {
        if (process.env.NODE_ENV === 'test') {
          const nameAnalysis = analyzeVietnameseName(customerName, '');
          gender = nameAnalysis.gender;
        } else {
          try {
            let profile = await fetchCustomerProfile(psid);
            if (!profile.name) {
              await delay(250);
              profile = await fetchCustomerProfile(psid);
            }
            if (profile.name) customerName = profile.name;
            if (profile.profilePicUrl) avatarUrl = profile.profilePicUrl;
            const genderResult = await determineCustomerGender({
              customerName,
              avatarUrl: avatarUrl || profile.profilePicUrl,
              isSilhouette: profile.isSilhouette,
            });
            if (genderResult.gender !== 'UNKNOWN') {
              gender = genderResult.gender;
            } else if (!gender) {
              gender = 'UNKNOWN';
            }
          } catch (err) {
            await logError('determineCustomerGender', err, { psid });
            if (!gender) gender = 'UNKNOWN';
          }
        }
      }

      const { text } = await resolveIntentText({ kind: 'AI_GREETING' }, '', [], customerName, false, gender);
      await sendQuickReplyButtons(psid, text);
      await saveConversation(psid, {
        state: current?.state ?? 'NEW',
        phone: current?.phone ?? null,
        assignedStaff: current?.assignedStaff ?? null,
        customerName: customerName ?? null,
        gender: gender ?? null,
        avatarUrl: avatarUrl ?? null,
        lastProcessedMessageAt: Date.now(),
      });
    } catch (err) {
      await logError('handleFirstOpen', err, { psid });
    }
  });
}

// ---------------------------------------------------------------------------
// Feed (comment) -> Private Reply (mục 5.3)
// ---------------------------------------------------------------------------

interface FeedCommentValue {
  item: string;
  verb: string;
  comment_id?: string;
  from?: { id: string; name?: string };
  /** Nội dung comment — quét tìm số điện thoại ngay trong comment (mục 5.3). */
  message?: string;
}

const COMMENT_AUTHORS_COLLECTION = 'commentAuthors';

async function getMappedPsid(commenterId: string): Promise<string | null> {
  const doc = await getDb().collection(COMMENT_AUTHORS_COLLECTION).doc(commenterId).get();
  if (!doc.exists) return null;
  return (doc.data()?.psid as string) ?? null;
}

async function saveMappedPsid(commenterId: string, psid: string): Promise<void> {
  await getDb().collection(COMMENT_AUTHORS_COLLECTION).doc(commenterId).set({ psid });
}

/**
 * Đã có Private Reply trước đó cho người này (PSID đã biết) và comment mới lại chứa số điện thoại
 * hợp lệ ngay trong nội dung -> chốt lead luôn (mục 5.3, AC10) qua đúng nhánh dùng chung với tin
 * nhắn Messenger trực tiếp (`processInput`/`runFlowTurn`), tránh cài trùng logic chốt lead ở 2 nơi.
 * Nếu không có số (hoặc số không hợp lệ), `processInput` tự xử lý AI_FREE_TEXT/AI_PHONE_INVALID/hỏi-lại như mục 5.2/6.
 */
async function handleMappedCommentTurn(
  psid: string,
  commentId: string,
  commentText: string,
  customerName: string | null
): Promise<void> {
  const existing = await getConversation(psid);
  if (isHumanTakeoverActive(existing?.lastHumanReplyAt)) {
    console.log(`[humanTakeover] Bỏ qua comment vì nhân viên đang chat trực tiếp với PSID ${psid}`);
    return;
  }
  await runFlowTurn(psid, { type: 'FEED_COMMENT', text: commentText }, async () => customerName, {
    comment_id: commentId,
  });
}

/**
 * Comment đầu tiên của 1 người (chưa từng phân giải PSID) và nội dung đã có sẵn số điện thoại hợp
 * lệ -> chốt lead ngay từ comment, không gửi câu trả lời/mời để lại số nào trước (mục 5.3, AC10).
 * Facebook chỉ trả PSID sau khi gửi Private Reply đầu tiên qua comment_id, nên tin đầu tiên gửi đi
 * chính là câu xác nhận đã nhận số (AI_PHONE_CONFIRMED, đúng nội dung
 * cần trả lời cho 1 lead, không phải tin "chờ" để dò PSID).
 */
async function handleFirstCommentWithValidPhone(
  commentId: string,
  commenterId: string,
  customerName: string | null,
  phone: string
): Promise<void> {
  let resolvedPsid: string | undefined;
  try {
    await sendTypingOn({ comment_id: commentId });
    const { text } = await resolveIntentText({ kind: 'AI_PHONE_CONFIRMED' }, '', [], customerName, false);
    resolvedPsid = await sendText({ comment_id: commentId }, text);
  } catch (err) {
    await logError('handleFeedChange_sendPhoneConfirmed', err, { commentId, commenterId });
    return;
  }
  if (!resolvedPsid) {
    await logError('handleFeedChange', new Error('Facebook did not return recipient_id for private reply'), {
      commentId,
      commenterId,
    });
    return;
  }
  await saveMappedPsid(commenterId, resolvedPsid);

  const existing = await getConversation(resolvedPsid);
  if (existing && existing.state === 'CLOSED') {
    // Đã chốt lead từ trước qua kênh khác (vd đã nhắn tin trực tiếp) -> không ghi lead mới (AC6).
    // Gửi thừa 1 tin xác nhận đã nhận số thay vì trấn an là rủi ro tồn dư đã biết của Private Reply API (mục 14, không
    // biết trước state trước khi gửi). Vẫn thực hiện đúng việc theo dõi "hỏi lại" như kênh nhắn tin
    // trực tiếp (mục 6, 8c): số trong comment khác số đã ghi -> sửa lại + copy; giống số cũ -> chỉ
    // copy nguyên trạng — tránh 2 kênh xử lý lệch nhau (comment vs tin nhắn) cho cùng 1 tình huống.
    if (existing.phone) {
      try {
        if (existing.phone !== phone) {
          await updateLeadPhoneAndCopyToFollowUpSheet(existing.phone, phone);
          await saveConversation(resolvedPsid, { ...existing, phone });
          await touchFollowUpTracked(resolvedPsid);
        } else if (isFollowUpDebounceElapsed(existing.lastFollowUpTrackedAt)) {
          await copyLeadToFollowUpSheet(existing.phone);
          await touchFollowUpTracked(resolvedPsid);
        }
      } catch (err) {
        await logError('followUpSheetTracking', err, {
          commentId,
          commenterId,
          resolvedPsid,
          oldPhone: existing.phone,
          newPhone: phone,
        });
      }
    }
    return;
  }

  try {
    // Chốt lead trực tiếp từ comment -> cột E luôn là "Cmt" (mục 8, AC10/AC13).
    const assignedStaff = await appendLead({ phone, customerName, source: 'Cmt', psid: resolvedPsid });
    await saveConversation(resolvedPsid, {
      state: 'CLOSED',
      phone,
      assignedStaff,
      customerName: customerName ?? null,
    });
  } catch (err) {
    // Không được để mất lead (mục 10) dù đến từ comment.
    await logError('handleFeedChange_appendLead', err, { commentId, commenterId, resolvedPsid, phone });
  }
}

/**
 * Comment đầu tiên có chuỗi số nhưng không hợp lệ -> AI viết lời nhắc theo đúng lỗi (thiếu/thừa/sai
 * đầu số), tuyệt đối không đụng Sheet (mục 7 điểm 6, mục 8). Không đọc/ghi state Firestore ở nhánh
 * này (số không hợp lệ không làm chuyển state — mục 5.2) nên không có rủi ro ghi đè; việc phải gửi
 * lời nhắc trước khi biết PSID có thể đã CLOSED hay chưa là cùng 1 giới hạn kỹ thuật của Private
 * Reply API đã chấp nhận ở mục 14.
 */
async function handleFirstCommentWithInvalidPhone(
  commentId: string,
  commenterId: string,
  errorType: PhoneErrorType,
  customerName?: string | null
): Promise<void> {
  try {
    await sendTypingOn({ comment_id: commentId });
    const { text } = await resolveIntentText(
      { kind: 'AI_PHONE_INVALID', errorType },
      '',
      [],
      customerName ?? null,
      false
    );
    const resolvedPsid = await sendText({ comment_id: commentId }, text);
    if (resolvedPsid) {
      await saveMappedPsid(commenterId, resolvedPsid);
    }
  } catch (err) {
    await logError('handleFeedChange_sendPhoneInvalid', err, { commentId, commenterId });
  }
}

/**
 * Comment đầu tiên của 1 người chưa từng phân giải PSID, không có số điện thoại (mục 5.3). Facebook
 * CHỈ trả PSID sau khi đã gửi Private Reply đầu tiên qua comment_id — không có cách nào đọc trước để
 * biết PSID này đã từng chat trực tiếp (có thể đã IN_PROGRESS hay CLOSED) hay chưa.
 *
 * Gửi 2 tin TÁCH RIÊNG qua cùng `comment_id` (bắt buộc giữ nguyên comment_id cho cả 2 tin — xem
 * `sendMessageSequence`, không được đổi sang `{id}` giữa chừng vì người này chưa từng mở cuộc trò
 * chuyện thật): tin 1 là `AI_GREETING` (chào ngắn), tin 2 mới là `AI_FREE_TEXT` do AI đọc ĐÚNG nội
 * dung comment rồi viết (trả lời trọng tâm câu hỏi + mời để lại số Zalo) — tách ra thay vì dồn
 * chung 1 tin dài như thiết kế trước (phản hồi thực tế: "ngữ cảnh dài quá"). PSID thật chỉ được biết
 * sau khi Facebook trả về `recipient_id` của tin ĐẦU TIÊN (`AI_GREETING`) — không phải chờ tin 2.
 * Chấp nhận rủi ro tồn dư giống hệt `handleFirstCommentWithValidPhone`: nếu PSID này hoá ra đã từng
 * chat trực tiếp và đã `IN_PROGRESS`/`CLOSED` từ trước, 2 tin đầu tiên vẫn đã lỡ gửi theo kịch bản
 * "khách mới" — không tránh được do giới hạn kỹ thuật của Private Reply API (mục 14). Sau khi biết
 * PSID thật, vẫn xử lý đúng theo state thật: `CLOSED` -> chỉ theo dõi "hỏi lại" (mục 8c), không lưu
 * đè state/aiHistory; còn lại -> lưu `IN_PROGRESS` + nối tiếp lịch sử hội thoại.
 */
async function handleFirstCommentWithoutPhone(
  commentId: string,
  commenterId: string,
  customerName?: string | null,
  commentText = ''
): Promise<void> {
  let resolvedPsid: string | undefined;
  let replyText = '';
  try {
    const intentResolver = async (intent: ReplyIntent) => {
      // isNewCustomer luôn false: lời chào đã tách thành tin AI_GREETING riêng (item đầu tiên gửi đi
      // ở dưới), tin AI_FREE_TEXT theo sau không cần AI tự chào lại nữa.
      const { text } = await resolveIntentText(intent, commentText, [], customerName ?? null, false, null, false);
      if (intent.kind === 'AI_FREE_TEXT') replyText = text;
      return text;
    };
    resolvedPsid = await sendMessageSequence(
      { comment_id: commentId },
      [{ kind: 'AI_GREETING' }, { kind: 'AI_FREE_TEXT' }],
      true,
      intentResolver
    );
  } catch (err) {
    await logError('handleFeedChange_sendFreeText', err, { commentId, commenterId });
    return;
  }

  if (!resolvedPsid) {
    await logError('handleFeedChange', new Error('Facebook did not return recipient_id for private reply'), {
      commentId,
      commenterId,
    });
    return;
  }

  await saveMappedPsid(commenterId, resolvedPsid);
  await setLastCommentId(resolvedPsid, commentId).catch((err) =>
    logError('setLastCommentId', err, { psid: resolvedPsid, commentId })
  );

  const existing = await getConversation(resolvedPsid);
  if (existing && existing.state === 'CLOSED') {
    // Đã CLOSED từ trước qua kênh khác -> tin AI_FREE_TEXT vừa gửi bị lỡ sai giọng điệu (đáng lẽ phải
    // là AI_FOLLOWUP_CLOSED) — rủi ro tồn dư đã biết (mục 14). Không lưu đè state/lead, chỉ theo dõi
    // "hỏi lại" như bình thường (mục 6, 8c) vì comment này không có số mới để sửa.
    if (existing.phone && isFollowUpDebounceElapsed(existing.lastFollowUpTrackedAt)) {
      try {
        await copyLeadToFollowUpSheet(existing.phone);
        await touchFollowUpTracked(resolvedPsid);
      } catch (err) {
        await logError('followUpSheetTracking', err, { commentId, commenterId, resolvedPsid, phone: existing.phone });
      }
    }
    return;
  }

  try {
    const priorHistory = existing?.aiHistory ?? [];
    const updatedHistory = [...priorHistory, { role: 'user' as const, text: commentText }, { role: 'model' as const, text: replyText }];
    await saveConversation(resolvedPsid, {
      state: 'IN_PROGRESS',
      phone: null,
      assignedStaff: null,
      customerName: customerName ?? existing?.customerName ?? null,
    });
    await updateAiHistory(resolvedPsid, updatedHistory);
  } catch (err) {
    await logError('handleFeedChange_saveState', err, { commentId, commenterId, resolvedPsid });
  }
}

/**
 * Ẩn comment trên Fanpage sau khi bot đã xử lý và gửi tin nhắn riêng cho khách xong:
 * Tránh để lộ số điện thoại, thông tin khách hàng trên bài viết công khai và chống cướp khách.
 */
async function hideComment(commentId: string): Promise<void> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return;

  try {
    const res = await fetch(`${GRAPH_BASE_URL}/${commentId}?is_hidden=true&access_token=${pageAccessToken}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const errBody = await res.text();
      await logError('hideComment', new Error(`Facebook hide comment error ${res.status}: ${errBody}`), {
        commentId,
      });
    }
  } catch (err) {
    await logError('hideComment', err, { commentId });
  }
}

/**
 * Khoá theo commenterId (R7): người comment 2 lần liên tiếp rất nhanh (trước khi lượt đầu kịp
 * phân giải xong PSID qua Private Reply) sẽ khiến cả 2 lượt cùng thấy `getMappedPsid` trả về null
 * và cùng mở luồng trả lời lần nữa — khách nhận trùng tin, và bản ghi PSID cuối cùng có thể lệch
 * tuỳ lượt nào lưu sau. Khoá đảm bảo lượt thứ 2 luôn thấy PSID đã được lượt đầu phân giải xong.
 */
async function handleFeedChange(value: FeedCommentValue, pageId?: string): Promise<void> {
  if (value.item !== 'comment' || value.verb !== 'add' || !value.comment_id || !value.from) {
    return;
  }

  // Bỏ qua comment của chính Fanpage/Admin (mục 5.3): tránh bot tự phản hồi chính mình
  // hoặc chốt nhầm hotline của Page thành lead khách.
  if (pageId && value.from.id === pageId) {
    return;
  }

  const commenterId = value.from.id;
  const commentId = value.comment_id;
  const customerName = value.from.name ?? null;
  const commentText = value.message ?? '';
  const phoneCheck = checkPhone(commentText);

  await withLock(`commentAuthor:${commenterId}`, async () => {
    const mappedPsid = await getMappedPsid(commenterId);

    if (mappedPsid) {
      await handleMappedCommentTurn(mappedPsid, commentId, commentText, customerName);
    } else if (phoneCheck.valid && phoneCheck.normalizedPhone) {
      await handleFirstCommentWithValidPhone(commentId, commenterId, customerName, phoneCheck.normalizedPhone);
    } else if (phoneCheck.errorType !== null) {
      await handleFirstCommentWithInvalidPhone(commentId, commenterId, phoneCheck.errorType, customerName);
    } else {
      await handleFirstCommentWithoutPhone(commentId, commenterId, customerName, commentText);
    }

    // Sau khi xử lý và gửi tin nhắn riêng cho khách xong -> ẩn comment trên bài viết đi
    await hideComment(commentId);
  });
}

// ---------------------------------------------------------------------------
// Webhook POST entrypoint
// ---------------------------------------------------------------------------

interface WebhookEntry {
  id?: string;
  time?: number;
  messaging?: MessagingEvent[];
  changes?: { field: string; value: FeedCommentValue }[];
}

interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

export async function handleWebhookEvent(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as WebhookBody | undefined;
    if (!body || body.object !== 'page') return;

    for (const entry of body.entry ?? []) {
      const pageId = entry.id;

      for (const event of entry.messaging ?? []) {
        try {
          if (!event.message && !event.postback) continue;

          // Bắt sự kiện tin nhắn từ Page (is_echo === true):
          // Khi nhân viên/admin dùng nick Page nhắn cho khách, cập nhật lastHumanReplyAt = Date.now() vào Firestore
          if (event.message?.is_echo) {
            const customerPsid = event.recipient?.id;
            const botAppId = process.env.FB_APP_ID || "2090780494853003";
            const isBotSelf = event.message.app_id && String(event.message.app_id) === String(botAppId);
            if (customerPsid && !isBotSelf) {
              await setLastHumanReplyAt(customerPsid, Date.now()).catch((err: unknown) =>
                logError("setLastHumanReplyAt", err, { customerPsid })
              );
            }
            continue;
          }

          // Ngăn ngừa mọi nguy cơ lặp tin nếu tin nhắn đến từ chính Page ID
          if (pageId && event.sender.id === pageId) continue;
          await handleMessagingEvent(event);
        } catch (err) {
          await logError('handleMessagingEvent', err, { event });
        }
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== 'feed') continue;
        if (pageId && change.value?.from?.id === pageId) continue;
        try {
          await handleFeedChange(change.value, pageId);
        } catch (err) {
          await logError('handleFeedChange_top', err, { change });
        }
      }
    }
  } catch (err) {
    await logError('handleWebhookEvent', err, { body: req.body });
  } finally {
    if (!res.headersSent) {
      res.sendStatus(200);
    }
  }
}

export { handleFirstOpen, handleFeedChange, hideComment };
