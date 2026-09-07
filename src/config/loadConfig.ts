import messagesJson from './messages.json';

export interface MessageButton {
  label: string;
  payload: string;
}

export interface MessagesConfig {
  /**
   * Câu trả lời dự phòng DUY NHẤT còn lại trong hệ thống (mục 4.2, AC16) — chỉ hiện ra khi Gemini
   * lỗi/timeout hoặc trả về rỗng (đã hết retry). Mọi câu trả lời bình thường trong hội thoại (kể cả
   * lời mời để lại số Zalo) đều do AI tự viết, không còn kịch bản M1-M7 cố định như trước.
   */
  aiFallbackText: string;
  buttons: MessageButton[];
}

export function loadMessages(): MessagesConfig {
  return messagesJson as MessagesConfig;
}
