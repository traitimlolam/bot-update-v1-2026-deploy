import { checkPhone, PhoneErrorType } from './phoneValidator';

export type ConversationState = 'NEW' | 'IN_PROGRESS' | 'CLOSED';

export interface ConversationRecord {
  state: ConversationState;
  phone: string | null;
  assignedStaff: string | null;
}

export function newConversation(): ConversationRecord {
  return { state: 'NEW', phone: null, assignedStaff: null };
}

export type MessageCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6_SHORT' | 'M6_LONG' | 'M6_INVALID';

export type FlowInput =
  | { type: 'BUTTON'; payload: 'BTN_LOCATION' | 'BTN_LEGAL' | 'BTN_PRICE' }
  | { type: 'TEXT'; text: string }
  /** text: nội dung comment, dùng để quét số điện thoại ngay trong comment — mục 5.3. */
  | { type: 'FEED_COMMENT'; text?: string };

export interface FlowResult {
  record: ConversationRecord;
  messagesToSend: MessageCode[];
  /** Số điện thoại hợp lệ vừa được nhận diện trong lượt này — trigger ghi Sheet + round-robin ở lớp ngoài. */
  leadPhone: string | null;
}

const LOCATION_OR_PRICE_SEQUENCE: MessageCode[] = ['M1', 'M2', 'M3'];
const LEGAL_SEQUENCE: MessageCode[] = ['M1', 'M4', 'M3'];

export function phoneErrorToMessage(errorType: PhoneErrorType): MessageCode {
  switch (errorType) {
    case 'missing':
      return 'M6_SHORT';
    case 'excess':
      return 'M6_LONG';
    case 'invalidPrefix':
      return 'M6_INVALID';
  }
}

/**
 * State machine hội thoại thuần (mục 5, 6 CLAUDE.md).
 * Không gọi API bên ngoài — nhận state hiện tại, trả state mới + danh sách message code cần gửi theo thứ tự.
 * Lớp gọi ngoài (webhook/facebook.ts) chịu trách nhiệm: gửi từng message cách nhau >=2s kèm typing_on,
 * ghi Sheet + round-robin khi leadPhone khác null, rồi mới persist `record` trả về vào Firestore.
 *
 * TEXT (tin nhắn Messenger) và FEED_COMMENT kèm `text` (comment trên Page) dùng chung đúng 1 nhánh xử
 * lý số điện thoại/hỏi-lại bên dưới (mục 5.3: "dùng chung state theo PSID như mục 5.2") — tránh cài đặt
 * trùng lặp logic chốt lead ở 2 nơi có thể lệch nhau theo thời gian.
 */
export function processInput(current: ConversationRecord, input: FlowInput): FlowResult {
  // CLOSED: bot ngừng tự động trả lời hoàn toàn (mục 6, AC6), kể cả khi khách gửi thêm số điện thoại khác.
  if (current.state === 'CLOSED') {
    return { record: current, messagesToSend: [], leadPhone: null };
  }

  if (input.type === 'BUTTON') {
    const sequence =
      input.payload === 'BTN_LEGAL' ? LEGAL_SEQUENCE : LOCATION_OR_PRICE_SEQUENCE;
    return {
      record: { ...current, state: 'IN_PROGRESS' },
      messagesToSend: sequence,
      leadPhone: null,
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
    };
    return { record, messagesToSend: ['M5'], leadPhone: phoneCheck.normalizedPhone };
  }

  if (phoneCheck.errorType !== null) {
    // Sai định dạng: trả lời M6, tuyệt đối không ghi Sheet, state giữ nguyên (mục 5.2, 7, 8).
    return {
      record: current,
      messagesToSend: [phoneErrorToMessage(phoneCheck.errorType)],
      leadPhone: null,
    };
  }

  // Không có chuỗi số ứng viên nào: NEW = hỏi lần đầu, IN_PROGRESS = "hỏi lại" (mục 5.2/6) —
  // cả 2 trường hợp đều gửi lại đúng M1 → M2 → M3, không giới hạn số lần lặp cho tới khi có số hợp lệ.
  return {
    record: { ...current, state: 'IN_PROGRESS' },
    messagesToSend: LOCATION_OR_PRICE_SEQUENCE,
    leadPhone: null,
  };
}
