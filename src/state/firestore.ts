import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import { ConversationRecord } from '../flow/flowEngine';
import { withRetry } from '../util/retry';

let app: App | undefined;
let db: Firestore | undefined;

function getApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  const projectId = process.env.FIRESTORE_PROJECT_ID;
  const credsPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;

  if (credsPath && fs.existsSync(credsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    app = initializeApp({ credential: cert(serviceAccount), projectId });
  } else {
    // Cloud Run/GCP môi trường mặc định có Application Default Credentials.
    app = initializeApp({ projectId });
  }
  return app;
}

export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(getApp());
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Bỏ qua nếu settings đã được cấu hình trước đó
    }
  }
  return db;
}

/** 1 lượt trao đổi trong lịch sử hội thoại cho AI (mục 4.2) — không bao giờ chứa số điện thoại
 * thật của khách, vì nhánh AI chỉ được gọi khi `phoneValidator` xác nhận tin nhắn không có chuỗi
 * số ứng viên nào (mục 5.2/5.3).
 */
export interface AiHistoryEntry {
  role: 'user' | 'model';
  text: string;
}

/** Chỉ giữ tối đa 10 phần tử gần nhất (≈5 lượt qua lại) để không tốn token/dung lượng vô hạn (mục 4.2). */
export const MAX_AI_HISTORY_LENGTH = 10;

export interface StoredConversation extends ConversationRecord {
  lastFlowSentAt: Timestamp | null;
  lastReminderSentDate?: string | null;
  /**
   * Lần gần nhất bot thực sự ghi 1 dòng vào tab "Hỏi lại" (mục 8c) cho khách này — dùng để chặn
   * (debounce) 30 phút, tránh tạo nhiều dòng rác khi khách CLOSED nhắn qua lại liên tục trong thời
   * gian ngắn mà không có gì mới. Khác với `lastFlowSentAt` (cập nhật ở MỌI lượt, phục vụ cửa sổ
   * quét của reminderService mục 5.4) — 2 field không được dùng lẫn cho nhau.
   */
  lastFollowUpTrackedAt?: Timestamp | null;
  /** Lịch sử hội thoại ngắn dùng làm ngữ cảnh cho AI trả lời tự do (mục 4.2). */
  aiHistory?: AiHistoryEntry[];
  /**
   * `comment_id` của lượt tương tác GẦN NHẤT nếu đó là 1 lượt bình luận (mục 5.3) — `null` nếu lượt
   * gần nhất là nhắn tin trực tiếp. Facebook Send API từ chối gửi tin thường theo `{id: psid}`
   * (lỗi 551/1545041 "người này hiện không có mặt") cho người CHỈ MỚI bình luận, chưa từng chủ động
   * nhắn tin trực tiếp — phải gửi qua `{comment_id}` (Private Reply) như `webhook/facebook.ts` đã
   * làm. `services/reminderService.ts` (mục 5.4) đọc field này để chọn đúng kiểu recipient khi gửi
   * tin nhắc 20h cho nhóm khách này thay vì luôn mặc định `{id: psid}`.
   */
  lastCommentId?: string | null;
  /**
   * Mốc thời gian (ms) gần nhất nhân viên/admin dùng nick Page nhắn trực tiếp cho khách (mục Human Takeover).
   * Dùng để tạm ngưng bot trong 10 phút, tránh chen ngang khi người thật đang tư vấn.
   */
  lastHumanReplyAt?: number | Timestamp | null;
  /**
   * Mốc thời gian (ms hoặc Timestamp) gần nhất nhận được tin nhắn từ PSID này.
   * Dùng để khoá debounce chống trùng 4 giây giữa các webhook từ Facebook Ads.
   */
  lastProcessedMessageAt?: number | Timestamp | null;
}

const CONVERSATIONS_COLLECTION = 'conversations';

export async function getConversation(psid: string): Promise<StoredConversation | null> {
  const doc = await getDb().collection(CONVERSATIONS_COLLECTION).doc(psid).get();
  if (!doc.exists) return null;
  return doc.data() as StoredConversation;
}

const PROCESSED_MIDS_COLLECTION = 'processed_mids';

/**
 * Kiểm tra và lưu mid vào Firestore (chia sẻ giữa các Cloud Run container instances).
 * Trả về true nếu mid đã tồn tại (trùng lặp).
 * Trả về false nếu là mid mới, đồng thời ghi nhận vào Firestore.
 */
export async function checkAndSaveMidInFirestore(mid: string): Promise<boolean> {
  if (!mid) return false;
  try {
    const docRef = getDb().collection(PROCESSED_MIDS_COLLECTION).doc(mid);
    const snap = await docRef.get();
    if (snap.exists) {
      return true;
    }
    await docRef.set({
      mid,
      createdAt: Date.now(),
    });
    return false;
  } catch {
    return false;
  }
}

/**
 * Ghi nhận lastProcessedMessageAt cho PSID vào Firestore để debounce 4s giữa các instances.
 */
export async function setLastProcessedMessageAt(psid: string, timestampMs: number): Promise<void> {
  try {
    await getDb()
      .collection(CONVERSATIONS_COLLECTION)
      .doc(psid)
      .set({ lastProcessedMessageAt: timestampMs }, { merge: true });
  } catch {
    // Không chặn luồng nếu Firestore ghi nhận tạm thời thất bại
  }
}

/**
 * Ghi state hội thoại (mục 6). Bọc `withRetry` (mục 10, R7): đây là bước CUỐI của `runFlowTurn`
 * sau khi Sheet đã được ghi (mục 8) — nếu ghi thất bại và không retry, state CLOSED sẽ không được
 * lưu lại, khiến tin nhắn kế tiếp của cùng khách bị xử lý lại như chưa từng chốt lead (đọc lại state
 * cũ) và tạo thêm 1 lead trùng trên Sheet dù khách đã có số từ trước.
 */
export async function saveConversation(
  psid: string,
  record: ConversationRecord
): Promise<void> {
  await withRetry(() =>
    getDb()
      .collection(CONVERSATIONS_COLLECTION)
      .doc(psid)
      .set(
        {
          ...record,
          lastFlowSentAt: Timestamp.now(),
        },
        { merge: true }
      )
  );
}

/**
 * Đánh dấu "vừa ghi 1 dòng vào tab Hỏi lại" cho khách này (mục 8c) — dùng làm mốc cho debounce 30
 * phút ở lớp gọi ngoài (`webhook/facebook.ts`). Ghi riêng field này bằng `merge: true`, không đụng
 * các field khác của conversation (state/phone/assignedStaff...).
 */
export async function touchFollowUpTracked(psid: string): Promise<void> {
  await withRetry(() =>
    getDb()
      .collection(CONVERSATIONS_COLLECTION)
      .doc(psid)
      .set({ lastFollowUpTrackedAt: Timestamp.now() }, { merge: true })
  );
}

/**
 * Cập nhật `lastCommentId` sau MỖI lượt xử lý (mục 5.3/5.4) — truyền `commentId` thật nếu lượt này
 * là 1 bình luận, hoặc `null` nếu là 1 lượt nhắn tin trực tiếp (đã tự chứng minh `{id: psid}` gửi
 * được, không cần fallback qua comment_id nữa). Ghi riêng field này bằng `merge: true`.
 */
export async function setLastCommentId(psid: string, commentId: string | null): Promise<void> {
  await withRetry(() =>
    getDb().collection(CONVERSATIONS_COLLECTION).doc(psid).set({ lastCommentId: commentId }, { merge: true })
  );
}

/**
 * Ghi lại lịch sử hội thoại cho AI sau 1 lượt trả lời tự do (mục 4.2) — merge riêng field
 * `aiHistory`, không đụng các field khác của conversation. Cắt còn tối đa `MAX_AI_HISTORY_LENGTH`
 * phần tử gần nhất trước khi ghi để tránh phình vô hạn.
 */
export async function updateAiHistory(psid: string, history: AiHistoryEntry[]): Promise<void> {
  const trimmed = history.slice(-MAX_AI_HISTORY_LENGTH);
  await withRetry(() =>
    getDb().collection(CONVERSATIONS_COLLECTION).doc(psid).set({ aiHistory: trimmed }, { merge: true })
  );
}

export async function updateConversationReminder(
  psid: string,
  data: Partial<ConversationRecord> & { lastReminderSentDate: string }
): Promise<void> {
  await getDb()
    .collection(CONVERSATIONS_COLLECTION)
    .doc(psid)
    .set(
      {
        ...data,
      },
      { merge: true }
    );
}

const LOCKS_COLLECTION = 'locks';
// TTL đủ dài để bao trọn 1 lượt runFlowTurn thực tế (gửi tối đa 3 tin, mỗi tin cách nhau 2s, cộng
// retry mạng chậm cho cả Send API lẫn Sheets API — appendLead còn tự khoá lồng bên trong theo tab
// Sheet). Nếu TTL ngắn hơn thời gian xử lý thật, khoá có thể hết hạn giữa chừng và một tiến trình
// khác chiếm được khoá trong lúc tiến trình đầu vẫn đang chạy — tái diễn đúng race condition ban
// đầu. Timeout chờ khoá (cho tiến trình đang đợi) cố tình ngắn hơn TTL: nếu chủ khoá thật sự crash,
// khoá sẽ tự hết hạn và yêu cầu tiếp theo lấy được; yêu cầu đang đợi timeout trước đó chỉ log lỗi
// (mục 10), không làm mất dữ liệu.
const LOCK_TTL_MS = 90000;
const LOCK_ACQUIRE_TIMEOUT_MS = 60000;
const LOCK_POLL_MIN_MS = 200;
const LOCK_POLL_MAX_MS = 450;

function sanitizeLockKey(key: string): string {
  return key.replace(/[/\\]/g, '_');
}

/**
 * Khoá phân tán đơn giản dựa trên transaction atomic của Firestore (document `locks/{key}`,
 * field `expiresAtMs`). Dùng để serialize các thao tác theo cùng 1 khoá (vd cùng 1 PSID, cùng
 * 1 tab Sheet) — tránh 2 lệnh xử lý đồng thời ("lệnh chồng chéo") đọc cùng 1 state cũ rồi ghi đè
 * lên nhau, gây mất lead hoặc trùng round-robin. Khoá tự hết hạn sau `ttlMs` nếu tiến trình
 * giữ khoá bị crash giữa chừng, tránh deadlock vĩnh viễn.
 *
 * `ttlMs` (mặc định `LOCK_TTL_MS`, đủ cho 1 lượt `runFlowTurn`/1 lệnh Sheets API): CHO PHÉP ghi đè
 * khi biết trước công việc bên trong `fn` có thể chạy lâu hơn nhiều — vd `dailyReminderSweep`
 * (mục 5.4) lặp gửi tin cho hàng chục/hàng trăm khách, mỗi khách cách nhau 1s, tổng thời gian có
 * thể vượt xa `LOCK_TTL_MS` mặc định. Nếu khoá hết hạn TRONG LÚC `fn` vẫn đang chạy thật, một tiến
 * trình khác có thể chiếm được khoá và chạy sweep thứ 2 song song với sweep đầu chưa xong, dẫn tới
 * gửi trùng tin nhắc cho cùng 1 khách — luôn truyền `ttlMs` đủ lớn cho các tác vụ dài hơi như vậy.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, ttlMs: number = LOCK_TTL_MS): Promise<T> {
  const db = getDb();
  const lockRef = db.collection(LOCKS_COLLECTION).doc(sanitizeLockKey(key));
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

  for (;;) {
    const acquired = await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const data = snap.data() as { expiresAtMs?: number } | undefined;
      const now = Date.now();
      if (snap.exists && data?.expiresAtMs && data.expiresAtMs > now) {
        return false;
      }
      tx.set(lockRef, { expiresAtMs: now + ttlMs });
      return true;
    });

    if (acquired) break;
    if (Date.now() > deadline) {
      throw new Error(`withLock: hết thời gian chờ khoá "${key}"`);
    }
    const jitterMs = LOCK_POLL_MIN_MS + Math.random() * (LOCK_POLL_MAX_MS - LOCK_POLL_MIN_MS);
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
  }

  try {
    return await fn();
  } finally {
    await lockRef.delete().catch(() => {
      // Không chặn luồng chính nếu xoá khoá thất bại — khoá vẫn tự hết hạn theo expiresAtMs.
    });
  }
}

const ERRORS_COLLECTION = 'errors';

export async function logError(context: string, error: unknown, meta?: Record<string, unknown>): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  try {
    await getDb().collection(ERRORS_COLLECTION).add({
      context,
      message,
      stack: stack ?? null,
      meta: meta ?? null,
      createdAt: Timestamp.now(),
    });
  } catch (loggingError) {
    // Nếu Firestore cũng lỗi, không được để mất thông tin — fallback console (mục 10).
    console.error('[logError] failed to persist error to Firestore', loggingError);
    console.error(`[${context}]`, message, meta ?? '');
  }
}

export const HUMAN_TAKEOVER_TIMEOUT_MS = 10 * 60 * 1000; // 10 phút

/**
 * Cập nhật mốc thời gian nhân viên Page vừa nhắn cho khách (is_echo === true).
 */
export async function setLastHumanReplyAt(psid: string, timestampMs: number = Date.now()): Promise<void> {
  await withRetry(() =>
    getDb()
      .collection(CONVERSATIONS_COLLECTION)
      .doc(psid)
      .set({ lastHumanReplyAt: timestampMs }, { merge: true })
  );
}

/**
 * Kiểm tra xem chế độ Human Takeover có đang kích hoạt không (chưa quá 10 phút kể từ lúc nhân viên nhắn).
 */
export function isHumanTakeoverActive(lastHumanReplyAt?: number | Timestamp | null): boolean {
  if (!lastHumanReplyAt) return false;
  const lastMs =
    typeof lastHumanReplyAt === "number"
      ? lastHumanReplyAt
      : lastHumanReplyAt instanceof Timestamp
      ? lastHumanReplyAt.toMillis()
      : (lastHumanReplyAt as any)?.toMillis?.() || 0;
  if (!lastMs) return false;
  return Date.now() - lastMs < HUMAN_TAKEOVER_TIMEOUT_MS;
}
