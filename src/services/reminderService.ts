import { Timestamp } from 'firebase-admin/firestore';
import { formatPersonalizedMessage } from '../utils/genderDetector';
import {
  getConversation,
  getDb,
  logError,
  updateConversationReminder,
  withLock,
} from '../state/firestore';
import { sendText, sendTypingOn } from '../webhook/facebook';

export const LAND_TOUR_REMINDER_TEMPLATE =
  'Thứ 7 này em có xe đưa đón xem đất miễn phí, anh/chị có đi được không ạ?';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const VIETNAM_TIMEZONE_OFFSET_HOURS = 7;

export interface VietnamDateRange {
  todayStr: string; // YYYY-MM-DD
  startOfToday: Date;
  endOfToday: Date;
  vnHours: number;
  vnMinutes: number;
}

/**
 * Tính toán mốc thời gian trong ngày theo múi giờ Việt Nam (UTC+7).
 */
export function getVietnamDateRange(refDate = new Date()): VietnamDateRange {
  const vnTime = new Date(refDate.getTime() + VIETNAM_TIMEZONE_OFFSET_HOURS * 3600000);
  const year = vnTime.getUTCFullYear();
  const monthIdx = vnTime.getUTCMonth();
  const day = vnTime.getUTCDate();
  const vnHours = vnTime.getUTCHours();
  const vnMinutes = vnTime.getUTCMinutes();

  const monthStr = String(monthIdx + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const todayStr = `${year}-${monthStr}-${dayStr}`;

  // Bắt đầu ngày tại 00:00:00.000 giờ VN (tương ứng -7 tiếng UTC)
  const startOfToday = new Date(
    Date.UTC(year, monthIdx, day, 0 - VIETNAM_TIMEZONE_OFFSET_HOURS, 0, 0, 0)
  );
  // Kết thúc ngày tại 23:59:59.999 giờ VN
  const endOfToday = new Date(
    Date.UTC(year, monthIdx, day, 24 - VIETNAM_TIMEZONE_OFFSET_HOURS, 0, 0, -1)
  );

  return { todayStr, startOfToday, endOfToday, vnHours, vnMinutes };
}

interface ConversationCandidate {
  psid: string;
  customerName: string | null;
}

/**
 * Quét các cuộc trò chuyện trên Fanpage phát sinh tương tác trong ngày từ Graph API.
 */
async function fetchPageConversationsToday(
  startOfToday: Date
): Promise<Map<string, ConversationCandidate>> {
  const map = new Map<string, ConversationCandidate>();
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return map;

  try {
    const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,updated_time,participants,senders&limit=100&access_token=${pageAccessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      await logError('fetchPageConversationsToday', new Error(`Graph API error ${res.status}: ${errText}`));
      return map;
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        updated_time: string;
        participants?: { data?: Array<{ id: string; name: string }> };
      }>;
    };

    const conversations = data.data ?? [];
    for (const conv of conversations) {
      const updatedTime = new Date(conv.updated_time);
      if (updatedTime >= startOfToday) {
        const participants = conv.participants?.data ?? [];
        // Lấy người tham gia không phải là ID của Page
        const customer = participants.find((p) => p.id !== process.env.FB_PAGE_ID);
        if (customer && customer.id) {
          map.set(customer.id, {
            psid: customer.id,
            customerName: customer.name ?? null,
          });
        }
      }
    }
  } catch (err) {
    await logError('fetchPageConversationsToday', err);
  }

  return map;
}

/**
 * Quét các bản ghi Firestore có tương tác trong ngày (lastFlowSentAt >= startOfToday).
 */
async function fetchFirestoreConversationsToday(
  startOfToday: Date
): Promise<Map<string, ConversationCandidate>> {
  const map = new Map<string, ConversationCandidate>();
  try {
    const startTimestamp = Timestamp.fromDate(startOfToday);
    const snap = await getDb()
      .collection('conversations')
      .where('lastFlowSentAt', '>=', startTimestamp)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      map.set(doc.id, {
        psid: doc.id,
        customerName: (data.customerName as string) ?? null,
      });
    }
  } catch (err) {
    await logError('fetchFirestoreConversationsToday', err);
  }
  return map;
}

export interface SweepResult {
  success: boolean;
  todayStr: string;
  totalCandidates: number;
  sentCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * Thực hiện rà soát và gửi tin nhắn lúc 20h hàng ngày cho các khách chưa cho SĐT trong ngày.
 * - Khóa tổng: `dailyReminderSweep:${todayStr}` chống chạy đè / lặp lệnh khi có nhiều container.
 * - Khóa từng khách: `psid:${psid}` chống xung đột khi khách đang chat cùng lúc.
 * - Deduplication: Ghi nhận `lastReminderSentDate = todayStr` để tuyệt đối không gửi lặp cho 1 khách.
 */
export async function runDailyReminderSweep(options?: {
  force?: boolean;
  dryRun?: boolean;
}): Promise<SweepResult> {
  const { todayStr, startOfToday } = getVietnamDateRange();
  const lockKey = options?.force
    ? `dailyReminderSweep:force:${Date.now()}`
    : `dailyReminderSweep:${todayStr}`;

  return withLock(lockKey, async () => {
    // 1. Thu thập danh sách khách hàng tương tác trong ngày từ cả Graph API và Firestore
    const [pageCandidates, firestoreCandidates] = await Promise.all([
      fetchPageConversationsToday(startOfToday),
      fetchFirestoreConversationsToday(startOfToday),
    ]);

    // Hợp nhất danh sách ứng viên (loại bỏ trùng PSID)
    const combinedCandidates = new Map<string, ConversationCandidate>();
    for (const [psid, item] of pageCandidates) {
      combinedCandidates.set(psid, item);
    }
    for (const [psid, item] of firestoreCandidates) {
      const existing = combinedCandidates.get(psid);
      combinedCandidates.set(psid, {
        psid,
        customerName: item.customerName ?? existing?.customerName ?? null,
      });
    }

    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const [psid, candidate] of combinedCandidates) {
      try {
        // Kiểm tra trạng thái hiện tại trong Firestore
        const current = await getConversation(psid);

        // Đã cho số điện thoại (CLOSED hoặc có SĐT hợp lệ) -> bỏ qua
        if (current && (current.state === 'CLOSED' || (current.phone && current.phone.trim().length > 0))) {
          skippedCount++;
          continue;
        }

        // Đã gửi tin nhắn nhắc hôm nay rồi -> bỏ qua (trừ khi force)
        if (!options?.force && current?.lastReminderSentDate === todayStr) {
          skippedCount++;
          continue;
        }

        const customerName = candidate.customerName ?? current?.customerName ?? null;
        const text = formatPersonalizedMessage(LAND_TOUR_REMINDER_TEMPLATE, customerName);

        if (!options?.dryRun) {
          await withLock(`psid:${psid}`, async () => {
            await sendTypingOn({ id: psid });
            await sendText({ id: psid }, text);

            await updateConversationReminder(psid, {
              state: current?.state ?? 'IN_PROGRESS',
              phone: null,
              customerName: customerName ?? null,
              lastReminderSentDate: todayStr,
            });
          });

          // Nghỉ nhẹ 1s giữa các tin để không bị rate limit từ Facebook Send API
          if (process.env.NODE_ENV !== 'test') {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        sentCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`PSID ${psid}: ${msg}`);
        await logError('runDailyReminderSweep_singleUser', err, { psid });
      }
    }

    return {
      success: true,
      todayStr,
      totalCandidates: combinedCandidates.size,
      sentCount,
      skippedCount,
      errors,
    };
  });
}

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Khởi động scheduler chạy ngầm kiểm tra mỗi phút:
 * Khi đúng 20:00 giờ Việt Nam (UTC+7) thì tự động kích hoạt runDailyReminderSweep().
 */
export function startDailyReminderScheduler(): void {
  if (schedulerTimer) return;

  // Trong môi trường test không tự động bật interval
  if (process.env.NODE_ENV === 'test') return;

  schedulerTimer = setInterval(async () => {
    try {
      const { vnHours, vnMinutes } = getVietnamDateRange();
      if (vnHours === 20 && vnMinutes === 0) {
        console.log('[ReminderScheduler] 20:00 VN time detected. Running daily sweep...');
        const result = await runDailyReminderSweep();
        console.log('[ReminderScheduler] Daily sweep finished:', result);
      }
    } catch (err) {
      console.error('[ReminderScheduler] Error running scheduled sweep:', err);
    }
  }, 60000);
}

export function stopDailyReminderScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
