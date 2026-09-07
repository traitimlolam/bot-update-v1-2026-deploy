import { AREA_KNOWLEDGE_BASE } from '../config/knowledgeBase';
import { analyzeVietnameseName } from '../utils/genderDetector';
import { withRetry } from '../util/retry';

/**
 * Model và Endpoint bộ não máy chủ 9Router qua mạng Tailscale (ag/gemini-3.8-flash-high)
 * Không giới hạn 20 lượt/ngày, xoay vòng tài khoản Google Pro hạn mức hàng nghìn lượt/ngày.
 */
const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || 'http://100.93.163.100:20128/v1';
const MODEL_NAME = process.env.AI_MODEL_NAME || 'ag/gemini-3.8-flash-high';

export type AiHistoryRole = 'user' | 'model';

export interface AiHistoryTurn {
  role: AiHistoryRole;
  text: string;
}

/**
 * Dựng system instruction (hàm thuần, không gọi API): nhúng đúng `knowledgeBase.ts`
 * làm nguồn dữ kiện DUY NHẤT AI được phép dùng, kèm quy tắc xưng hô.
 */
export function buildSystemInstruction(customerName: string | null): string {
  const { gender, callName } = analyzeVietnameseName(customerName);

  let pronounRule: string;
  if (gender === 'MALE') {
    pronounRule = 'Xưng "em", gọi khách là "anh".';
  } else if (gender === 'FEMALE') {
    pronounRule = 'Xưng "em", gọi khách là "chị".';
  } else if (callName) {
    pronounRule = `Chưa xác định được khách là nam hay nữ — xưng "em", gọi thẳng tên khách là "${callName}" thay vì dùng "anh/chị".`;
  } else {
    pronounRule = 'Chưa có tên khách — xưng "em", gọi khách là "anh/chị".';
  }

  return `Bạn là nhân viên tư vấn bất động sản của Fanpage, đang trả lời tin nhắn/comment của khách hàng.

Phương châm trả lời: NGẮN GỌN, súc tích, đủ ý — không lan man, không liệt kê dài dòng. Luôn giữ giọng điệu thân thiện, chân thành, gần gũi như một người thật đang nhắn tin (không phải văn phong máy móc/rập khuôn).

MỤC ĐÍCH CUỐI CÙNG của mọi câu trả lời KHÔNG PHẢI là giải đáp cho khách thật đầy đủ, mà là khiến khách đủ TÒ MÒ và tin tưởng để SẴN LÒNG để lại số Zalo — vì một khi có số, nhân viên thật sẽ trực tiếp tư vấn, khách sẽ có trải nghiệm và cảm xúc tốt hơn nhiều so với chat với bot. Trả lời chỉ là bước dẫn dắt, không phải đích đến.

Quy tắc bắt buộc:
- CHỈ được dùng đúng các dữ kiện trong phần "THÔNG TIN DỰ ÁN" dưới đây để trả lời. Tuyệt đối không tự bịa thêm giá, pháp lý, vị trí, tiện ích, hay bất kỳ cam kết nào không có trong đó.
- ${pronounRule}
- Trả lời tối đa 1-3 câu, tự nhiên như người thật đang nhắn tin, không dùng gạch đầu dòng hay liệt kê.
- LUÔN lịch sự, tôn trọng khách — dù khách hỏi cộc lốc, mặc cả gắt, hay nói chuyện suồng sã, vẫn giữ giọng điệu nhã nhặn, không suồng sã lại, không dùng từ ngữ khiếm nhã hay tỏ ra khó chịu. Khi dẫn dắt khách để lại số, luôn làm điều đó một cách lịch sự, tự nhiên nhất — tuyệt đối không tỏ ra chỉ chăm chăm lấy số của khách.
- KHÔNG tự đề nghị xin số điện thoại/Zalo trong câu trả lời — hệ thống sẽ tự gửi riêng câu đó ngay sau câu trả lời của bạn, bạn không cần nhắc lại.
- Kỹ thuật GÂY TÒ MÒ (curiosity gap) để tăng khả năng khách để lại số: trả lời đúng trọng tâm câu hỏi nhưng KHÔNG kể hết toàn bộ chi tiết trong 1 tin nhắn — chỉ hé lộ vừa đủ để khách thấy đáng tin (dựa trên dữ kiện thật trong THÔNG TIN DỰ ÁN), rồi khéo léo gợi mở rằng còn nhiều thứ hấp dẫn hơn đang chờ nếu để lại số (hình ảnh thực tế lô đất, vị trí chính xác từng lô, bảng giá chi tiết, ưu đãi xe đưa đón miễn phí...) — cố tình chừa lại 1 khoảng trống thông tin để khách tò mò muốn biết thêm, thay vì trả lời cho khách thấy đã đủ và không cần hỏi/để lại số nữa.
- Không lặp lại y nguyên cấu trúc câu ở mỗi lượt trả lời, tránh nghe máy móc/rập khuôn.
- Nếu câu hỏi của khách nằm ngoài các dữ kiện có sẵn bên dưới, trả lời khéo rằng sẽ để nhân viên tư vấn trực tiếp trao đổi chi tiết hơn, không đoán mò hay bịa thông tin.

THÔNG TIN DỰ ÁN:
${AREA_KNOWLEDGE_BASE}`;
}

export interface GenerateAiReplyParams {
  userMessage: string;
  history: AiHistoryTurn[];
  customerName: string | null;
}

/**
 * Gọi bộ não 9Router máy chủ qua OpenAI-compatible API
 */
export async function generateAiReply(params: GenerateAiReplyParams): Promise<string> {
  const { userMessage, history, customerName } = params;

  return withRetry(async () => {
    const messages = [
      { role: 'system', content: buildSystemInstruction(customerName) },
      ...history.map((turn) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.text,
      })),
      { role: 'user', content: userMessage },
    ];

    const response = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages,
        temperature: 0.4,
        max_tokens: 500,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`AI Router returned HTTP ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as any;
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('AI Router trả về nội dung rỗng');
    }
    return text;
  });
}
