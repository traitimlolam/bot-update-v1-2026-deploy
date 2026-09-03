import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import { ConversationRecord } from '../flow/flowEngine';

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
  }
  return db;
}

export interface StoredConversation extends ConversationRecord {
  lastFlowSentAt: Timestamp | null;
  lastReminderSentDate?: string | null;
}

const CONVERSATIONS_COLLECTION = 'conversations';

export async function getConversation(psid: string): Promise<StoredConversation | null> {
  const doc = await getDb().collection(CONVERSATIONS_COLLECTION).doc(psid).get();
  if (!doc.exists) return null;
  return doc.data() as StoredConversation;
}

export async function saveConversation(
  psid: string,
  record: ConversationRecord
): Promise<void> {
  await getDb()
    .collection(CONVERSATIONS_COLLECTION)
    .doc(psid)
    .set(
      {
        ...record,
        lastFlowSentAt: Timestamp.now(),
      },
      { merge: true }
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
 * lên nhau, gây mất lead hoặc trùng round-robin. Khoá tự hết hạn sau `LOCK_TTL_MS` nếu tiến trình
 * giữ khoá bị crash giữa chừng, tránh deadlock vĩnh viễn.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
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
      tx.set(lockRef, { expiresAtMs: now + LOCK_TTL_MS });
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
