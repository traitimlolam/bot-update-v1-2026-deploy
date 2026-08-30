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

export type MessageCode = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6_SHORT' | 'M6_LONG' | 'M6_INVALID' | 'M7';

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
  // CLOSED: không tạo lead mới trên tab tháng, không đổi assignedStaff, dù khách gửi thêm gì — nhưng
  // KHÔNG còn im lặng hoàn toàn như trước: trả lời M7 để trấn an khách đã bàn giao nhân viên (mục 6,
  // AC6), đồng thời quét luôn nội dung để phát hiện khách đang SỬA LẠI số điện thoại (mục 6, 8c).
  if (current.state === 'CLOSED') {
    const text = input.type === 'TEXT' ? input.text : input.type === 'FEED_COMMENT' ? input.text ?? '' : '';
    const phoneCheck = checkPhone(text);

    if (phoneCheck.errorType !== null) {
      // Khách có thể đang cố sửa số nhưng gõ sai định dạng -> báo lỗi để sửa đúng ở lượt sau, tuyệt
      // đối không đụng Sheet (mục 7 điểm 6) — không copy sang "Hỏi lại" ở nhánh này.
      return {
        record: current,
        messagesToSend: [phoneErrorToMessage(phoneCheck.errorType)],
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
      messagesToSend: ['M7'],
      leadPhone: null,
      correctedPhone,
      trackFollowUp: true,
    };
  }

  if (input.type === 'BUTTON') {
    const sequence =
      input.payload === 'BTN_LEGAL' ? LEGAL_SEQUENCE : LOCATION_OR_PRICE_SEQUENCE;
    return {
      record: { ...current, state: 'IN_PROGRESS' },
      messagesToSend: sequence,
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
    };
    return {
      record,
      messagesToSend: ['M5'],
      leadPhone: phoneCheck.normalizedPhone,
      correctedPhone: null,
      trackFollowUp: false,
    };
  }

  if (phoneCheck.errorType !== null) {
    // Sai định dạng: trả lời M6, tuyệt đối không ghi Sheet, state giữ nguyên (mục 5.2, 7, 8).
    return {
      record: current,
      messagesToSend: [phoneErrorToMessage(phoneCheck.errorType)],
      leadPhone: null,
      correctedPhone: null,
      trackFollowUp: false,
    };
  }

  // Không có chuỗi số ứng viên nào: NEW = hỏi lần đầu, IN_PROGRESS = "hỏi lại" (mục 5.2/6) —
  // cả 2 trường hợp đều gửi lại đúng M1 → M2 → M3, không giới hạn số lần lặp cho tới khi có số hợp lệ.
  return {
    record: { ...current, state: 'IN_PROGRESS' },
    messagesToSend: LOCATION_OR_PRICE_SEQUENCE,
    leadPhone: null,
    correctedPhone: null,
    trackFollowUp: false,
  };
}
