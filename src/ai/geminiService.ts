import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { AREA_KNOWLEDGE_BASE } from '../config/knowledgeBase';
import { analyzeVietnameseName } from '../utils/genderDetector';
import { withRetry } from '../util/retry';

/**
 * Model dùng cho lớp trả lời tự do (mục 4.2 CLAUDE.md): Gemini Developer API qua Google AI Studio
 * (KHÔNG phải Vertex AI), chạy trong hạn mức free tier. Cố tình chọn thẳng dòng 3.x (không phải
 * 2.5) vì dòng 2.5 sẽ ngừng hoạt động 16/10/2026 — tránh phải migrate lại ngay sau khi go-live.
 */
const MODEL_NAME = 'gemini-3.5-flash';

export type AiHistoryRole = 'user' | 'model';

export interface AiHistoryTurn {
  role: AiHistoryRole;
  text: string;
}

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/**
 * Dựng system instruction (hàm thuần, không gọi API — mục 4.2/13): nhúng đúng `knowledgeBase.ts`
 * làm nguồn dữ kiện DUY NHẤT AI được phép dùng, kèm quy tắc xưng hô đúng theo mục 4.1 (tái dùng
 * `analyzeVietnameseName`, không qua `formatPersonalizedMessage` vì đó chỉ thay thế đúng chuỗi mẫu
 * cố định, không áp dụng được lên văn bản AI tự sinh). Không nhận/không nhúng số điện thoại khách.
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
 * Gọi Gemini Developer API sinh câu trả lời tự do (mục 4.2) — lớp mỏng gọi API bên ngoài, chỉ test
 * thủ công (mục 3), bọc `withRetry` như mọi lời gọi ra ngoài khác (mục 10). Ném lỗi ra ngoài khi hết
 * số lần retry hoặc model trả về rỗng — lớp gọi ngoài (`webhook/facebook.ts`) chịu trách nhiệm bắt
 * lỗi này và fallback về M2 (mục 4.2, AC16), không được để khách không nhận được tin nào.
 */
export async function generateAiReply(params: GenerateAiReplyParams): Promise<string> {
  const { userMessage, history, customerName } = params;

  return withRetry(async () => {
    const response = await getClient().models.generateContent({
      model: MODEL_NAME,
      contents: [
        ...history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
        { role: 'user' as const, parts: [{ text: userMessage }] },
      ],
      config: {
        systemInstruction: buildSystemInstruction(customerName),
        temperature: 0.4,
        maxOutputTokens: 500,
        // Ép mức "thinking" (suy luận nội bộ) xuống MINIMAL (mục 4.2, tối giản chi phí): đã kiểm
        // chứng thủ công — `thinkingBudget: 0` KHÔNG có tác dụng với gemini-3.5-flash (model vẫn tự
        // trích ~280 token cho thinking bất kể), trong khi `thinkingLevel: 'MINIMAL'` mới thực sự bỏ
        // qua bước này. Nếu không set, thinking từng chiếm gần hết maxOutputTokens và cắt cụt câu trả
        // lời giữa chừng (finishReason: MAX_TOKENS) — với câu trả lời tư vấn ngắn (1-3 câu) không cần
        // suy luận nhiều bước, MINIMAL vừa tránh lỗi này vừa giảm token phải trả phí mỗi lượt.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error('Gemini trả về nội dung rỗng');
    }
    return text;
  });
}
