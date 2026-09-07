import { AREA_KNOWLEDGE_BASE } from '../config/knowledgeBase';
import { analyzeVietnameseName } from '../utils/genderDetector';
import { withRetry } from '../util/retry';
import { ReplyIntent, ReplyTopic } from '../flow/flowEngine';
import { PhoneErrorType } from '../flow/phoneValidator';

/**
 * Model và Endpoint bộ não máy chủ 9Router qua mạng Tailscale (ag/gemini-3.8-flash-high) — chủ dự
 * án đã duyệt phương án này (mục 4.2/14 CLAUDE.md): xoay vòng tài khoản Google Pro cá nhân, không bị
 * giới hạn 20 lượt/ngày của Gemini Developer API free tier. Có thể ghi đè qua biến môi trường
 * `AI_ROUTER_URL`/`AI_MODEL_NAME` nếu router đổi địa chỉ hoặc đổi tên model.
 */
const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || 'http://100.93.163.100:20128/v1';
const MODEL_NAME = process.env.AI_MODEL_NAME || 'ag/gemini-3.8-flash-high';

export type AiHistoryRole = 'user' | 'model';

export interface AiHistoryTurn {
  role: AiHistoryRole;
  text: string;
}

/**
 * Lời chào mở đầu, KHÔNG qua AI (tiết kiệm chi phí — dùng cho lúc mở màn hội thoại/probe PSID qua
 * comment, nội dung không phụ thuộc câu hỏi cụ thể của khách nên không cần gọi model).
 */
export function buildNaturalGreeting(customerName: string | null): string {
  const { gender, callName } = analyzeVietnameseName(customerName);
  if (gender === 'MALE') {
    return 'Dạ em chào anh ạ! Em có thể hỗ trợ anh tìm hiểu thông tin lô đất nào bên em hôm nay ạ?';
  }
  if (gender === 'FEMALE') {
    return 'Dạ em chào chị ạ! Em có thể hỗ trợ chị tìm hiểu thông tin lô đất nào bên em hôm nay ạ?';
  }
  if (callName) {
    return `Dạ em chào ${callName} ạ! Em có thể hỗ trợ mình tìm hiểu thông tin lô đất nào bên em hôm nay ạ?`;
  }
  return 'Dạ em chào anh/chị ạ! Em có thể hỗ trợ mình tìm hiểu thông tin lô đất nào bên em hôm nay ạ?';
}

/**
 * Lời chào ngắn dùng làm tin PROBE đầu tiên gửi qua comment_id để buộc Facebook trả về PSID thật
 * của người bình luận lần đầu (mục 5.3) — cũng không qua AI vì nội dung không phụ thuộc ngữ cảnh.
 */
export function buildCommentGreeting(customerName: string | null): string {
  const { gender, callName } = analyzeVietnameseName(customerName);
  if (gender === 'MALE') return 'Dạ em chào anh ạ!';
  if (gender === 'FEMALE') return 'Dạ em chào chị ạ!';
  if (callName) return `Dạ em chào ${callName} ạ!`;
  return 'Dạ em chào anh/chị ạ!';
}

/**
 * Dựng system instruction (hàm thuần, không gọi API): nhúng đúng `knowledgeBase.ts` làm nguồn dữ
 * kiện DUY NHẤT AI được phép dùng, kèm quy tắc xưng hô. Giữ nguyên arity 1 (chỉ nhận customerName)
 * để không có tham số nào cho phép rò rỉ số điện thoại khách vào prompt (mục 4.2/13) — chi tiết về
 * SỰ KIỆN cụ thể của lượt trả lời (bấm nút nào, câu hỏi gì, lỗi số điện thoại gì...) được ghép vào
 * tin nhắn "user" cuối cùng ở `describeIntent`, không đưa vào đây.
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
- KHÔNG tự đề nghị xin số điện thoại/Zalo trong câu trả lời, TRỪ KHI phần "Sự kiện" bên dưới yêu cầu rõ ràng khác đi (ví dụ: nhờ khách gửi lại số điện thoại đúng định dạng) — bình thường hệ thống sẽ tự gửi riêng câu xin số ngay sau câu trả lời của bạn, bạn không cần nhắc lại.
- Kỹ thuật GÂY TÒ MÒ (curiosity gap) để tăng khả năng khách để lại số: trả lời đúng trọng tâm câu hỏi nhưng KHÔNG kể hết toàn bộ chi tiết trong 1 tin nhắn — chỉ hé lộ vừa đủ để khách thấy đáng tin (dựa trên dữ kiện thật trong THÔNG TIN DỰ ÁN), rồi khéo léo gợi mở rằng còn nhiều thứ hấp dẫn hơn đang chờ nếu để lại số (hình ảnh thực tế lô đất, vị trí chính xác từng lô, bảng giá chi tiết, ưu đãi xe đưa đón miễn phí...) — cố tình chừa lại 1 khoảng trống thông tin để khách tò mò muốn biết thêm, thay vì trả lời cho khách thấy đã đủ và không cần hỏi/để lại số nữa.
- Không lặp lại y nguyên cấu trúc câu ở mỗi lượt trả lời, tránh nghe máy móc/rập khuôn.
- Nếu câu hỏi của khách nằm ngoài các dữ kiện có sẵn bên dưới, trả lời khéo rằng sẽ để nhân viên tư vấn trực tiếp trao đổi chi tiết hơn, không đoán mò hay bịa thông tin.

THÔNG TIN DỰ ÁN:
${AREA_KNOWLEDGE_BASE}`;
}

const TOPIC_LABEL: Record<ReplyTopic, string> = {
  location: 'khách vừa bấm nút hỏi dự án Ở ĐÂU',
  legal: 'khách vừa bấm nút hỏi PHÁP LÝ, có sổ đỏ không',
  price: 'khách vừa bấm nút hỏi GIÁ BÁN bao nhiêu',
};

const PHONE_ERROR_LABEL: Record<PhoneErrorType, string> = {
  missing: 'số khách vừa gửi đang THIẾU chữ số (chưa đủ 10 số)',
  excess: 'số khách vừa gửi đang THỪA chữ số (nhiều hơn 10 số)',
  invalidPrefix: 'số khách vừa gửi đủ 10 chữ số nhưng đầu số không phải đầu số di động Việt Nam hợp lệ',
};

const GREETING_HINT =
  'Đây là tin đầu tiên gửi tới khách này — bắt đầu câu trả lời bằng một lời chào ngắn tự nhiên (kiểu "Dạ em chào anh/chị ạ") trước khi trả lời.';

/**
 * Dịch 1 `ReplyIntent` (mục 4.2 mở rộng, `flow/flowEngine.ts`) + ngữ cảnh của lượt hiện tại thành
 * hướng dẫn cụ thể, ghép vào tin nhắn "user" cuối cùng gửi cho model — KHÔNG đưa vào system
 * instruction (giữ `buildSystemInstruction` thuần/arity 1, test được độc lập — mục 13).
 */
function describeIntent(intent: ReplyIntent, userText: string, isNewCustomer: boolean): string {
  switch (intent.kind) {
    case 'AI_TOPIC':
      return `Sự kiện: ${TOPIC_LABEL[intent.topic]}. ${GREETING_HINT} Trả lời đúng trọng tâm câu hỏi này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới.`;
    case 'AI_FREE_TEXT':
      return `Sự kiện: khách vừa nhắn/bình luận tự do, nguyên văn: "${userText}". ${
        isNewCustomer ? GREETING_HINT : ''
      } Trả lời đúng trọng tâm nội dung này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới.`;
    case 'AI_PHONE_CONFIRMED':
      return 'Sự kiện: khách VỪA ĐỂ LẠI SỐ ĐIỆN THOẠI hợp lệ. Viết đúng 1 câu ngắn cảm ơn và xác nhận đã nhận được số, báo nhân viên tư vấn sẽ liên hệ với khách ngay. TUYỆT ĐỐI KHÔNG hỏi lại số điện thoại/Zalo vì đã có rồi.';
    case 'AI_PHONE_INVALID':
      return `Sự kiện: ${PHONE_ERROR_LABEL[intent.errorType]}. ĐÂY LÀ NGOẠI LỆ DUY NHẤT được phép nhắc tới số điện thoại: viết đúng 1 câu ngắn, nhẹ nhàng, không trách móc, nhờ khách kiểm tra và gửi lại đúng số điện thoại.`;
    case 'AI_FOLLOWUP_CLOSED':
      return 'Sự kiện: khách này đã để lại số điện thoại và đã được chuyển cho nhân viên phụ trách từ trước, giờ nhắn thêm. Viết đúng 1 câu ngắn trấn an rằng bên em đã có thông tin, nhân viên sẽ liên hệ lại ngay. TUYỆT ĐỐI KHÔNG hỏi thêm số điện thoại/Zalo.';
  }
}

/** Shape tối thiểu của response OpenAI-compatible mà 9Router trả về (chỉ phần code thật sự dùng). */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface GenerateAiReplyParams {
  intent: ReplyIntent;
  /** Nội dung tin/comment mới nhất của khách — rỗng khi lượt này không phát sinh từ 1 câu chữ cụ thể (vd bấm nút). */
  userText: string;
  history: AiHistoryTurn[];
  customerName: string | null;
  /** true nếu đây là lượt trả lời đầu tiên gửi cho khách này (mục 5.2: chỉ NEW mới cần chào). */
  isNewCustomer: boolean;
}

/**
 * Gọi bộ não 9Router máy chủ qua OpenAI-compatible API (mục 4.2) — bọc `withRetry` (mục 10) như
 * mọi lời gọi ra ngoài khác.
 */
export async function generateAiReply(params: GenerateAiReplyParams): Promise<string> {
  const { intent, userText, history, customerName, isNewCustomer } = params;

  return withRetry(async () => {
    const messages = [
      { role: 'system', content: buildSystemInstruction(customerName) },
      ...history.map((turn) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.text,
      })),
      { role: 'user', content: describeIntent(intent, userText, isNewCustomer) },
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
        max_tokens: 400,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`AI Router returned HTTP ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const text = (data?.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/`/g, '');

    if (!text) {
      throw new Error('AI Router trả về nội dung rỗng');
    }
    return text;
  });
}
