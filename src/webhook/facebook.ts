import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { loadMessages } from '../config/loadConfig';
import { formatPersonalizedMessage } from '../utils/genderDetector';
import {
  ConversationRecord,
  FlowInput,
  MessageCode,
  newConversation,
  phoneErrorToMessage,
  processInput,
} from '../flow/flowEngine';
import { checkPhone } from '../flow/phoneValidator';
import { getConversation, getDb, logError, saveConversation, withLock } from '../state/firestore';
import {
  appendLead,
  copyLeadToFollowUpSheet,
  LeadSource,
  updateLeadPhoneAndCopyToFollowUpSheet,
} from '../services/sheetsService';
import { withRetry } from '../util/retry';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MIN_DELAY_BETWEEN_MESSAGES_MS = process.env.NODE_ENV === 'test' ? 0 : 2000;

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
  await callSendApi({ recipient, sender_action: 'typing_on' });
}

export async function sendText(recipient: Recipient, text: string): Promise<string | undefined> {
  const result = await callSendApi({
    recipient,
    messaging_type: 'RESPONSE',
    message: { text },
  });
  return result.recipient_id;
}

async function sendQuickReplyButtons(psid: string, customerName?: string | null): Promise<void> {
  const messages = loadMessages();
  const text = formatPersonalizedMessage(messages.M1, customerName);
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
 * Gửi tuần tự danh sách message code, mỗi tin cách nhau >=2s kèm typing_on (mục 4).
 * Trả về PSID nếu recipient ban đầu là comment_id và Facebook trả về recipient_id thật.
 *
 * `keepOriginalRecipient` (mặc định false, giữ hành vi cũ cho luồng BUTTON/TEXT vốn đã gọi bằng
 * { id: psid } — chuyển sang { id } sau tin đầu không ảnh hưởng gì vì đã là { id } sẵn): khi true,
 * KHÔNG tự chuyển sang { id: resolvedPsid } sau tin đầu tiên dù Facebook có trả recipient_id — dùng
 * cho trường hợp gửi tiếp M2/M3 qua Private Reply ({ comment_id }) cho người CHỈ MỚI comment, chưa
 * từng chủ động nhắn tin: nếu đổi sang { id }, Facebook từ chối với lỗi 551/1545041 "Người này hiện
 * không có mặt" vì người đó chưa mở cuộc trò chuyện thật — phải giữ nguyên comment_id cho MỌI tin.
 */
async function sendMessageSequence(
  recipient: Recipient,
  codes: MessageCode[],
  keepOriginalRecipient = false,
  customerName?: string | null
): Promise<string | undefined> {
  const messages = loadMessages();
  let resolvedPsid: string | undefined;
  let currentRecipient = recipient;

  for (let i = 0; i < codes.length; i++) {
    await sendTypingOn(currentRecipient);
    const text = formatPersonalizedMessage(messages[codes[i]], customerName);
    const recipientId = await sendText(currentRecipient, text);
    if (recipientId && !resolvedPsid) {
      resolvedPsid = recipientId;
      if (!keepOriginalRecipient) {
        currentRecipient = { id: recipientId };
      }
    }
    if (i < codes.length - 1) {
      await delay(MIN_DELAY_BETWEEN_MESSAGES_MS);
    }
  }
  return resolvedPsid;
}

// ---------------------------------------------------------------------------
// Orchestration: flowEngine + Firestore + Sheets + round-robin (mục 5, 6, 8, 9)
// ---------------------------------------------------------------------------

async function loadOrCreateConversation(psid: string): Promise<ConversationRecord> {
  const stored = await getConversation(psid);
  return stored ?? newConversation();
}

/**
 * Chạy 1 lượt flow: xử lý input, gửi message tương ứng, ghi Sheet nếu có lead (round-robin được
 * tính ngay trong `appendLead` dựa trên dropdown cột F — mục 9), rồi persist state mới vào Firestore.
 * Không để lỗi ở bước sau rollback bước trước đã thành công (mục 10).
 *
 * Toàn bộ hàm được khoá theo PSID (R7): Facebook có thể gửi webhook trùng (retry khi ack chậm)
 * hoặc khách bấm/nhắn liên tiếp rất nhanh, khiến 2 lượt xử lý cho CÙNG 1 khách chạy chồng lên nhau
 * — nếu không khoá, cả hai đều đọc cùng 1 state Firestore cũ, có thể cùng ghi lead 2 lần vào Sheet
 * và gửi M5 2 lần. Khoá đảm bảo các lượt của cùng 1 khách luôn chạy tuần tự.
 *
 * `getCustomerName` là hàm lazy — chỉ gọi (và chỉ tốn 1 lời gọi Graph API lấy first_name/last_name)
 * khi thật sự chốt được lead, tránh gọi API vô ích ở mọi tin nhắn khác.
 */
export async function runFlowTurn(
  psid: string,
  input: FlowInput,
  getCustomerName: () => Promise<string | null>,
  overrideRecipient?: Recipient
): Promise<void> {
  await withLock(`psid:${psid}`, async () => {
    const current = await loadOrCreateConversation(psid);
    const result = processInput(current, input);

    // Lấy tên khách để xưng hô chuẩn xác: ưu tiên tên đã lưu trong session, nếu chưa có thì fetch
    let customerName = current.customerName ?? null;
    if (!customerName) {
      customerName = await getCustomerName();
    }

    if (result.messagesToSend.length > 0) {
      try {
        const targetRecipient: Recipient = overrideRecipient ?? { id: psid };
        const keepOriginal = overrideRecipient !== undefined && 'comment_id' in overrideRecipient;
        await sendMessageSequence(targetRecipient, result.messagesToSend, keepOriginal, customerName);
      } catch (err) {
        await logError('sendMessageSequence', err, { psid, input });
      }
    }

    let finalRecord: ConversationRecord = {
      ...result.record,
      customerName: customerName ?? current.customerName ?? null,
    };

    if (result.leadPhone) {
      try {
        const customerName = await getCustomerName();
        // Cột E (mục 8): số điện thoại đến từ tin nhắn Messenger -> "Tin nhắn"; đến từ nội dung
        // comment (FEED_COMMENT) -> "Cmt". BUTTON không bao giờ tạo leadPhone nên không cần xét.
        const source: LeadSource = input.type === 'FEED_COMMENT' ? 'Cmt' : 'Tin nhắn';
        const assignedStaff = await appendLead({
          phone: result.leadPhone,
          customerName,
          source,
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
      // M7 ở bước trên). Nếu vừa gửi lại số hợp lệ KHÁC số cũ (result.correctedPhone) -> đây là 1
      // lần SỬA số, phải sửa lại cột B trên tab tháng gốc trước khi copy; ngược lại chỉ copy nguyên
      // trạng dòng lead cũ. Không tạo lead mới, không đụng cột F/round-robin.
      try {
        if (result.correctedPhone) {
          await updateLeadPhoneAndCopyToFollowUpSheet(current.phone, result.correctedPhone);
        } else {
          await copyLeadToFollowUpSheet(current.phone);
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
  });
}

// ---------------------------------------------------------------------------
// Messenger: messages + postbacks
// ---------------------------------------------------------------------------

interface MessagingEvent {
  sender: { id: string };
  message?: { text?: string; quick_reply?: { payload?: string }; is_echo?: boolean };
  postback?: { payload?: string };
}

const KNOWN_BUTTON_PAYLOADS = ['BTN_LOCATION', 'BTN_LEGAL', 'BTN_PRICE'] as const;

function isKnownButtonPayload(
  payload: string | undefined
): payload is (typeof KNOWN_BUTTON_PAYLOADS)[number] {
  return !!payload && (KNOWN_BUTTON_PAYLOADS as readonly string[]).includes(payload);
}

/**
 * Lấy tên khách hàng tương tác với Page (mục 8):
 * 1. Ưu tiên tra cứu qua `/me/conversations?user_id=${psid}&fields=participants,senders`:
 *    Vì Page Access Token thuộc về Admin của Page, API Inbox của chính Page luôn trả về đầy đủ
 *    họ tên Facebook của người nhắn (`participants.data[].name`) đối với 100% khách hàng
 *    (kể cả người lạ) mà KHÔNG bị giới hạn bởi App Review hay yêu cầu xác minh doanh nghiệp.
 * 2. Fallback sang `/{psid}?fields=first_name,last_name` cho trường hợp đặc biệt hoặc tester.
 */
async function fetchCustomerName(psid: string): Promise<string | null> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return null;

  // Cách 1: Query qua Page Conversations Inbox (hoạt động cho tất cả người dùng thật)
  try {
    const convUrl = `${GRAPH_BASE_URL}/me/conversations?user_id=${psid}&fields=participants,senders&access_token=${pageAccessToken}`;
    const convRes = await fetch(convUrl);
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
        return participant.name.trim();
      }
    }
  } catch {
    // fallback sang cách 2
  }

  // Cách 2: Query User Profile Node
  try {
    const response = await fetch(
      `${GRAPH_BASE_URL}/${psid}?fields=first_name,last_name&access_token=${pageAccessToken}`
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { first_name?: string; last_name?: string };
    const name = [data.last_name, data.first_name].filter(Boolean).join(' ').trim();
    return name || null;
  } catch {
    return null;
  }
}

async function handleMessagingEvent(event: MessagingEvent): Promise<void> {
  const psid = event.sender.id;

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

  const text = event.message?.text;
  if (typeof text === 'string' && text.length > 0) {
    await runFlowTurn(psid, { type: 'TEXT', text }, () => fetchCustomerName(psid));
  }
}

/**
 * Nếu PSID này đã CLOSED từ trước (vd đã cho số hợp lệ qua kênh khác), tuyệt đối không gửi lại
 * menu 3 nút dù Facebook có gửi lại postback GET_STARTED (bot đã bàn giao — mục 6, AC6).
 */
async function handleFirstOpen(psid: string): Promise<void> {
  try {
    const current = await getConversation(psid);
    if (current && current.state === 'CLOSED') {
      return;
    }
    const customerName = current?.customerName ?? (await fetchCustomerName(psid));
    await sendTypingOn({ id: psid });
    await sendQuickReplyButtons(psid, customerName);
    if (!current) {
      await saveConversation(psid, {
        state: 'NEW',
        phone: null,
        assignedStaff: null,
        customerName: customerName ?? null,
      });
    }
  } catch (err) {
    await logError('handleFirstOpen', err, { psid });
  }
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
 * Nếu không có số (hoặc số không hợp lệ), `processInput` tự xử lý M1-M3/M6/hỏi-lại như mục 5.2/6.
 */
async function handleMappedCommentTurn(
  psid: string,
  commentId: string,
  commentText: string,
  customerName: string | null
): Promise<void> {
  await runFlowTurn(
    psid,
    { type: 'FEED_COMMENT', text: commentText },
    async () => customerName,
    { comment_id: commentId }
  );
}

/**
 * Comment đầu tiên của 1 người (chưa từng phân giải PSID) và nội dung đã có sẵn số điện thoại hợp
 * lệ -> chốt lead ngay từ comment, không gửi M1-M3 trước (mục 5.3, AC10). Facebook chỉ trả PSID sau
 * khi gửi Private Reply đầu tiên qua comment_id, nên tin đầu tiên gửi đi chính là M5 (đúng nội dung
 * cần trả lời cho 1 lead, không phải tin "chờ" để dò PSID).
 */
async function handleFirstCommentWithValidPhone(
  commentId: string,
  commenterId: string,
  customerName: string | null,
  phone: string
): Promise<void> {
  const messages = loadMessages();
  let resolvedPsid: string | undefined;
  try {
    await sendTypingOn({ comment_id: commentId });
    const text = formatPersonalizedMessage(messages.M5, customerName);
    resolvedPsid = await sendText({ comment_id: commentId }, text);
  } catch (err) {
    await logError('handleFeedChange_sendM5', err, { commentId, commenterId });
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
    // Gửi thừa 1 tin M5 thay vì M7 là rủi ro tồn dư đã biết của Private Reply API (mục 14, không
    // biết trước state trước khi gửi). Vẫn thực hiện đúng việc theo dõi "hỏi lại" như kênh nhắn tin
    // trực tiếp (mục 6, 8c): số trong comment khác số đã ghi -> sửa lại + copy; giống số cũ -> chỉ
    // copy nguyên trạng — tránh 2 kênh xử lý lệch nhau (comment vs tin nhắn) cho cùng 1 tình huống.
    if (existing.phone) {
      try {
        if (existing.phone !== phone) {
          await updateLeadPhoneAndCopyToFollowUpSheet(existing.phone, phone);
          await saveConversation(resolvedPsid, { ...existing, phone });
        } else {
          await copyLeadToFollowUpSheet(existing.phone);
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
    const assignedStaff = await appendLead({ phone, customerName, source: 'Cmt' });
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
 * Comment đầu tiên có chuỗi số nhưng không hợp lệ -> M6 tương ứng, tuyệt đối không đụng Sheet
 * (mục 7 điểm 6, mục 8). Không đọc/ghi state Firestore ở nhánh này (M6 không làm chuyển state —
 * mục 5.2) nên không có rủi ro ghi đè; việc phải gửi M6 trước khi biết PSID có thể đã CLOSED hay
 * chưa là cùng 1 giới hạn kỹ thuật của Private Reply API đã chấp nhận ở mục 14.
 */
async function handleFirstCommentWithInvalidPhone(
  commentId: string,
  commenterId: string,
  errorMessageCode: MessageCode,
  customerName?: string | null
): Promise<void> {
  const messages = loadMessages();
  try {
    await sendTypingOn({ comment_id: commentId });
    const text = formatPersonalizedMessage(messages[errorMessageCode], customerName);
    const resolvedPsid = await sendText({ comment_id: commentId }, text);
    if (resolvedPsid) {
      await saveMappedPsid(commenterId, resolvedPsid);
    }
  } catch (err) {
    await logError('handleFeedChange_sendM6', err, { commentId, commenterId });
  }
}

/**
 * Comment đầu tiên không có số điện thoại -> Private Reply M1→M2→M3 (mục 5.3). Facebook CHỈ trả
 * PSID sau khi đã gửi Private Reply đầu tiên qua comment_id — không có cách nào đọc trước để biết
 * PSID này đã từng chat trực tiếp (có thể đã IN_PROGRESS hay CLOSED) hay chưa. Chấp nhận gửi tối
 * thiểu 1 tin (M1) trước, rồi mới kiểm tra state thật để quyết định bước tiếp theo:
 * - `CLOSED` (đã có số hợp lệ) -> không gửi thêm M2/M3, không đổi state, nhưng vẫn theo dõi "hỏi
 *   lại" như kênh nhắn tin trực tiếp (copy nguyên trạng dòng lead cũ sang tab "Hỏi lại" — mục 6,
 *   8c) vì comment này không có số mới để sửa. Việc lỡ gửi M1 thay vì M7 là giới hạn kỹ thuật
 *   không tránh được của Private Reply API (mục 14), không phải lỗi logic.
 * - `NEW`/`IN_PROGRESS`/chưa từng có hội thoại -> tiếp tục gửi đủ M2, M3 để hoàn thành trọn bộ
 *   M1→M2→M3, dù là hỏi lần đầu hay "hỏi lại" khi đang IN_PROGRESS (mục 5.2/6, AC8/AC9) — không
 *   còn dừng giữa chừng ở M1 như hành vi cũ trước khi có quy tắc "hỏi lại".
 */
async function handleFirstCommentWithoutPhone(
  commentId: string,
  commenterId: string,
  customerName?: string | null
): Promise<void> {
  const messages = loadMessages();
  let resolvedPsid: string | undefined;
  try {
    await sendTypingOn({ comment_id: commentId });
    const text = formatPersonalizedMessage(messages.M1, customerName);
    resolvedPsid = await sendText({ comment_id: commentId }, text);
  } catch (err) {
    await logError('handleFeedChange_sendM1', err, { commentId, commenterId });
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
    if (existing.phone) {
      try {
        await copyLeadToFollowUpSheet(existing.phone);
      } catch (err) {
        await logError('followUpSheetTracking', err, { commentId, commenterId, resolvedPsid, phone: existing.phone });
      }
    }
    return;
  }

  try {
    await delay(MIN_DELAY_BETWEEN_MESSAGES_MS);
    // Tiếp tục dùng { comment_id } thay vì { id: resolvedPsid } (mục 5.3): Facebook chỉ cho phép gửi
    // tin thường (recipient theo id) tới người đã chủ động mở cuộc trò chuyện — người mới chỉ comment
    // (chưa từng nhắn tin) sẽ bị từ chối với lỗi 551/1545041 "Người này hiện không có mặt" nếu đổi
    // sang { id }. Private Reply qua comment_id không bị giới hạn này.
    await sendMessageSequence({ comment_id: commentId }, ['M2', 'M3'], true, customerName);
    await saveConversation(resolvedPsid, {
      state: 'IN_PROGRESS',
      phone: null,
      assignedStaff: null,
      customerName: customerName ?? null,
    });
  } catch (err) {
    await logError('handleFeedChange_sendRest', err, { commentId, commenterId, resolvedPsid });
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
 * và cùng mở luồng M1→M2→M3 lần nữa — khách nhận trùng tin, và bản ghi PSID cuối cùng có thể lệch
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
      await handleFirstCommentWithInvalidPhone(
        commentId,
        commenterId,
        phoneErrorToMessage(phoneCheck.errorType),
        customerName
      );
    } else {
      await handleFirstCommentWithoutPhone(commentId, commenterId, customerName);
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
  // Trả 200 ngay để tránh Facebook retry trùng lặp; xử lý nghiệp vụ chạy nền.
  res.sendStatus(200);

  // Response đã gửi ở trên — từ đây về sau TUYỆT ĐỐI không được để lỗi thoát ra ngoài hàm này
  // (index.ts gọi .catch() chỉ để log, không phải next(), vì gọi next() sau khi đã sendStatus
  // sẽ gây crash ERR_HTTP_HEADERS_SENT). Bọc toàn bộ phần còn lại trong 1 try/catch tổng.
  try {
    const body = req.body as WebhookBody | undefined;
    if (!body || body.object !== 'page') return;

    for (const entry of body.entry ?? []) {
      const pageId = entry.id;

      for (const event of entry.messaging ?? []) {
        try {
          if (!event.message && !event.postback) continue;
          if (event.message?.is_echo) continue;
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
  }
}

export { handleFirstOpen, handleFeedChange, hideComment };
