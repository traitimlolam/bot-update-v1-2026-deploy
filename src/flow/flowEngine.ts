import { checkPhone, PhoneErrorType } from './phoneValidator';

export type ConversationState = 'NEW' | 'IN_PROGRESS' | 'CLOSED';

export interface ConversationRecord {
  state: ConversationState;
  phone: string | null;
  assignedStaff: string | null;
  customerName?: string | null;
}

export function newConversation(): ConversationRecord {
  return { state: 'NEW', phone: null, assignedStaff: null, customerName: null };
}

export type ReplyTopic = 'location' | 'legal' | 'price';

/**
 * Ý định trả lời (mục 4.2 — "giao toàn quyền cho Gemini trả lời"): flowEngine không tra message code
 * cố định cho bất kỳ nội dung hội thoại nào nữa, kể cả câu mời để lại số Zalo — AI tự viết TOÀN BỘ
 * câu chữ, bao gồm cả việc lịch sự xin số điện thoại/Zalo khi phù hợp (mục 4.2). Lớp gọi ngoài
 * (`webhook/facebook.ts`) gọi sang `ai/geminiService.ts` để Gemini viết linh hoạt theo đúng SỰ KIỆN
 * mà code đã xác định (`describeIntent` trong geminiService.ts quyết định khi nào cần xin số, khi
 * nào tuyệt đối không). flowEngine chỉ mô tả Ý ĐỊNH cần trả lời (sự kiện gì vừa xảy ra), không tự
 * quyết định nội dung câu chữ và không tự gọi API (vẫn là hàm thuần — mục 3).
 */
export type ReplyIntent =
  | { kind: 'AI_GREETING' }
  | { kind: 'AI_TOPIC'; topic: ReplyTopic }
  | { kind: 'AI_FREE_TEXT' }
  | { kind: 'AI_PHONE_CONFIRMED' }
  | { kind: 'AI_PHONE_INVALID'; errorType: PhoneErrorType }
  | { kind: 'AI_FOLLOWUP_CLOSED' };

/**
 * `AI_GREETING` KHÔNG bao giờ do `processInput` trả về — chỉ dùng ở lớp gọi ngoài
 * (`webhook/facebook.ts`) cho đúng 1 tình huống: khách vừa mở cửa sổ chat lần đầu (mục 5.1), TRƯỚC
 * khi flowEngine chạy. Khai báo ở đây (không phải riêng trong geminiService.ts) để dùng chung đúng 1
 * định nghĩa `ReplyIntent` cho toàn hệ thống.
 */

/** Không còn message code cố định nào trong hệ thống — mọi tin gửi khách đều là 1 ReplyIntent. */
export type OutgoingMessage = ReplyIntent;

export type FlowInput =
  | { type: 'BUTTON'; payload: 'BTN_LOCATION' | 'BTN_LEGAL' | 'BTN_PRICE' }
  | { type: 'TEXT'; text: string }
  /** text: nội dung comment, dùng để quét số điện thoại ngay trong comment — mục 5.3. */
  | { type: 'FEED_COMMENT'; text?: string };

export interface FlowResult {
  record: ConversationRecord;
  messagesToSend: OutgoingMessage[];
  /** Số điện thoại hợp lệ vừa được nhận diện trong lượt này — trigger ghi Sheet + round-robin ở lớp ngoài. */
  leadPhone: string | null;
  /**
   * Chỉ có giá trị khi khách ĐÃ CLOSED và gửi lại đúng 1 số điện thoại HỢP LỆ nhưng KHÁC số đã ghi
   * trước đó (mục 6, 8c) — lớp gọi ngoài cần SỬA lại số này trên Sheet (cột B của dòng lead cũ)
   * trước khi copy dòng đã sửa sang tab "Hỏi lại". Không set trong bất kỳ trường hợp nào khác.
   */
  correctedPhone: string | null;
  /**
   * true khi cần copy dòng lead sang tab "Hỏi lại" (mục 6, 8c) — chỉ true khi khách ĐÃ CLOSED từ
   * trước lượt này VÀ lượt này không phải 1 lần gõ sai định dạng số điện thoại (mục 7 điểm 6: số
   * không hợp lệ tuyệt đối không được phép làm phát sinh bất kỳ thay đổi nào trên Sheet).
   */
  trackFollowUp: boolean;
}

const BUTTON_TOPIC: Record<'BTN_LOCATION' | 'BTN_LEGAL' | 'BTN_PRICE', ReplyTopic> = {
  BTN_LOCATION: 'location',
  BTN_LEGAL: 'legal',
  BTN_PRICE: 'price',
};

/**
 * State machine hội thoại thuần (mục 5, 6 CLAUDE.md).
 * Không gọi API bên ngoài — nhận state hiện tại, trả state mới + danh sách ý định trả lời cần gửi
 * theo thứ tự. Lớp gọi ngoài (webhook/facebook.ts) chịu trách nhiệm: dịch từng ý định thành câu chữ
 * thật (qua Gemini, có fallback), gửi từng tin cách nhau >=2s kèm typing_on, ghi Sheet + round-robin
 * khi leadPhone khác null, rồi mới persist `record` trả về vào Firestore.
 *
 * TEXT (tin nhắn Messenger) và FEED_COMMENT kèm `text` (comment trên Page) dùng chung đúng 1 nhánh xử
 * lý số điện thoại/hỏi-lại bên dưới (mục 5.3: "dùng chung state theo PSID như mục 5.2") — tránh cài đặt
 * trùng lặp logic chốt lead ở 2 nơi có thể lệch nhau theo thời gian.
 */
export function processInput(current: ConversationRecord, input: FlowInput): FlowResult {
  // CLOSED: không tạo lead mới trên tab tháng, không đổi assignedStaff, dù khách gửi thêm gì — nhưng
  // KHÔNG còn im lặng hoàn toàn như trước: trả lời (do AI viết) để trấn an khách đã bàn giao nhân
  // viên (mục 6, AC6), đồng thời quét luôn nội dung để phát hiện khách đang SỬA LẠI số điện thoại
  // (mục 6, 8c).
  if (current.state === 'CLOSED') {
    const text = input.type === 'TEXT' ? input.text : input.type === 'FEED_COMMENT' ? input.text ?? '' : '';
    const phoneCheck = checkPhone(text);

    if (phoneCheck.errorType !== null) {
      // Khách có thể đang cố sửa số nhưng gõ sai định dạng -> báo lỗi để sửa đúng ở lượt sau, tuyệt
      // đối không đụng Sheet (mục 7 điểm 6) — không copy sang "Hỏi lại" ở nhánh này.
      return {
        record: current,
        messagesToSend: [{ kind: 'AI_PHONE_INVALID', errorType: phoneCheck.errorType }],
        leadPhone: null,
        correctedPhone: null,
        trackFollowUp: false,
      };
    }

    // Số hợp lệ nhưng KHÁC số đã ghi trước đó -> đây là 1 lần sửa số, không phải lead mới (mục 8c).
    const correctedPhone =
      phoneCheck.valid && phoneCheck.normalizedPhone && phoneCheck.normalizedPhone !== current.phone
        ? phoneCheck.normalizedPhone
        : null;

    return {
      record: correctedPhone ? { ...current, phone: correctedPhone } : current,
      messagesToSend: [{ kind: 'AI_FOLLOWUP_CLOSED' }],
      leadPhone: null,
      correctedPhone,
      trackFollowUp: true,
    };
  }

  if (input.type === 'BUTTON') {
    return {
      record: { ...current, state: 'IN_PROGRESS' },
      messagesToSend: [{ kind: 'AI_TOPIC', topic: BUTTON_TOPIC[input.payload] }],
      leadPhone: null,
      correctedPhone: null,
      trackFollowUp: false,
    };
  }

  // TEXT hoặc FEED_COMMENT (comment không kèm text coi như rỗng, tương đương "không có số điện thoại").
  const text = input.type === 'TEXT' ? input.text : input.text ?? '';
  const phoneCheck = checkPhone(text);

  // Chỉ được phép tác động Sheet khi valid === true (mục 7 điểm 6, mục 8) — không có ngoại lệ,
  // dù số điện thoại đến từ tin nhắn Messenger hay từ nội dung comment (mục 5.3).
  if (phoneCheck.valid && phoneCheck.normalizedPhone) {
    const record: ConversationRecord = {
      state: 'CLOSED',
      phone: phoneCheck.normalizedPhone,
      assignedStaff: current.assignedStaff,
      customerName: current.customerName ?? null,
    };
    return {
      record,
      messagesToSend: [{ kind: 'AI_PHONE_CONFIRMED' }],
      leadPhone: phoneCheck.normalizedPhone,
      correctedPhone: null,
      trackFollowUp: false,
    };
  }

  if (phoneCheck.errorType !== null) {
    // Sai định dạng: báo lỗi (do AI viết), tuyệt đối không ghi Sheet, state giữ nguyên (mục 5.2, 7, 8).
    return {
      record: current,
      messagesToSend: [{ kind: 'AI_PHONE_INVALID', errorType: phoneCheck.errorType }],
      leadPhone: null,
      correctedPhone: null,
      trackFollowUp: false,
    };
  }

  // Không có chuỗi số ứng viên nào (mục 4.2): để AI trả lời đúng câu hỏi/nội dung khách vừa nhắn, kèm
  // lời mời để lại số Zalo do chính AI viết (không còn M3 cố định) — áp dụng như nhau dù đây là lần
  // đầu (NEW) hay nhắn thêm/hỏi lại (IN_PROGRESS), vì không còn tin chào M1 cố định để phân biệt 2
  // trường hợp này nữa.
  return {
    record: { ...current, state: 'IN_PROGRESS' },
    messagesToSend: [{ kind: 'AI_FREE_TEXT' }],
    leadPhone: null,
    correctedPhone: null,
    trackFollowUp: false,
  };
}
