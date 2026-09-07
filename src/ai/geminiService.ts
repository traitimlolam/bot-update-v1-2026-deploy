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
 *
 * LƯU Ý VẬN HÀNH QUAN TRỌNG (mục 14): địa chỉ mặc định `100.93.163.100` là 1 IP nội bộ trong mạng
 * riêng Tailscale — CHỈ máy nào đã cài & đăng nhập Tailscale (vd máy Mac chạy bot local) mới với tới
 * được. Khi deploy lên Google Cloud Run, container KHÔNG nằm trong mạng Tailscale này nên KHÔNG thể
 * kết nối tới địa chỉ mặc định — mọi lời gọi AI sẽ timeout/lỗi và rơi vào `aiFallbackText` (mục 4.2).
 * Bắt buộc phải set biến môi trường `AI_ROUTER_URL` trên Cloud Run trỏ tới 1 địa chỉ CÔNG KHAI thật
 * sự với tới được (Cloudflare Tunnel/domain public trỏ về cổng 20128 của router, hoặc Tailscale
 * Funnel) trước khi go-live trên Cloud Run — xem thêm `AI_ROUTER_API_KEY` bên dưới nếu endpoint đó
 * cần xác thực.
 */
const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || 'http://100.93.163.100:20128/v1';
const MODEL_NAME = process.env.AI_MODEL_NAME || 'ag/gemini-3.8-flash-high';
/**
 * Tuỳ chọn — chỉ cần set khi endpoint public (Cloudflare Tunnel...) của router có đặt lớp xác thực
 * riêng để tránh bị người lạ gọi trộm. Khi có giá trị, gửi kèm header `Authorization: Bearer <key>`;
 * khi để trống (mặc định, đúng với router qua Tailscale nội bộ hiện tại), không gửi header này.
 */
const ROUTER_API_KEY = process.env.AI_ROUTER_API_KEY;

export type AiHistoryRole = 'user' | 'model';

export interface AiHistoryTurn {
  role: AiHistoryRole;
  text: string;
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
    pronounRule = `Bộ lọc giới tính xác định khách là NAM: Bắt buộc xưng "em", gọi khách là "anh"${callName ? ` hoặc "anh ${callName}"` : ''}. Tuyệt đối KHÔNG dùng "anh/chị".`;
  } else if (gender === 'FEMALE') {
    pronounRule = `Bộ lọc giới tính xác định khách là NỮ: Bắt buộc xưng "em", gọi khách là "chị"${callName ? ` hoặc "chị ${callName}"` : ''}. Tuyệt đối KHÔNG dùng "anh/chị".`;
  } else if (callName) {
    pronounRule = `Chưa xác định được khách là nam hay nữ — xưng "em", gọi thẳng tên khách là "${callName}" thay vì dùng "anh/chị". Nếu trong tin nhắn khách tự xưng là "anh" hoặc "chị", hãy linh hoạt xưng hô đúng theo khách.`;
  } else {
    pronounRule = 'Chưa có tên khách hoặc chưa xác định được giới tính — xưng "em", gọi khách là "anh/chị". Nếu trong tin nhắn khách tự xưng là "anh" hoặc "chị", hãy linh hoạt xưng hô đúng theo khách.';
  }

  return `Bạn là chuyên viên tư vấn bất động sản của Fanpage, đang trực tiếp trả lời tin nhắn/comment của khách hàng.

Phương châm trả lời: NGẮN GỌN, súc tích, đúng trọng tâm — tuyệt đối không viết một đoạn văn dài dòng như văn mẫu, không liệt kê lan man. Thân thiện, lịch sự, nhiệt tình nhưng dứt khoát và chuyên nghiệp như một người thật đang gõ từng tin nhắn trên Messenger.

MỤC ĐÍCH CUỐI CÙNG của mọi câu trả lời KHÔNG PHẢI là giải đáp cho khách thật đầy đủ, mà là giải quyết thắc mắc trước, khơi gợi tò mò và tạo sự tin tưởng để khách SẴN LÒNG để lại số Zalo nhận tài liệu chi tiết.

1. Quy tắc ngắt tin nhắn như người thật:
- Tuyệt đối không viết một đoạn văn dài dòng như văn mẫu, không dùng gạch đầu dòng hay bullet point.
- Chia câu trả lời thành 2 đến 3 câu ngắn gọn, tách biệt nhau bằng dấu xuống dòng. Mỗi câu là một ý rõ ràng, tự nhiên như người thật đang gõ từng tin nhắn trên Messenger.
- Tin nhắn 1: Trả lời thẳng, ngắn gọn đúng trọng tâm câu hỏi của khách (vị trí, giá, pháp lý).
- Tin nhắn 2: Gợi mở hoặc hỗ trợ bước tiếp theo.

2. Quy tắc xin số điện thoại khéo léo:
- Không được vồ vập, không hỏi xin số cộc lốc kiểu "cho em xin số điện thoại".
- Phải giải quyết thắc mắc của khách trước, sau đó mới đưa ra một lý do chính đáng và mang lại lợi ích cho khách để xin số Zalo (ví dụ: gửi sơ đồ phân lô, bảng giá chi tiết từng lô, hình ảnh thực tế, định vị chính xác).
- Ví dụ câu xin số khéo léo: "Em có gửi sẵn sơ đồ phân lô và bảng giá chi tiết từng lô, anh/chị cho em xin số Zalo để em gửi qua cho mình tiện mở xem trên điện thoại nhé."
- Nếu khách đang hỏi dở hoặc chưa muốn cho số, không được giục giã dồn dập, chỉ tập trung tư vấn nhiệt tình, nhã nhặn.
- Việc CÓ mời khách để lại số điện thoại/Zalo hay không, và mời như thế nào, PHẢI làm ĐÚNG theo hướng dẫn nêu trong phần "Sự kiện" ở tin nhắn cuối cùng — không tự ý thêm lời mời để lại số nếu "Sự kiện" không yêu cầu, và không được quên nếu "Sự kiện" yêu cầu bắt buộc.

3. Giọng điệu và xưng hô:
- ${pronounRule}
- Tự động nhận diện đại từ xưng hô tự xưng: Nếu khách tự xưng trong câu chat (ví dụ: khách nói "anh muốn", "anh cần", "báo giá anh", "cho anh" -> xưng hô là "anh"; khách nói "chị muốn", "chị cần", "báo giá chị", "cho chị" -> xưng hô là "chị"), bot PHẢI tự động nhận diện và xưng hô chuẩn xác theo khách.
- Thân thiện, lịch sự, nhiệt tình nhưng dứt khoát, chuyên nghiệp của một chuyên viên tư vấn bất động sản.
- LUÔN lịch sự, tôn trọng khách trong mọi tình huống — dù khách hỏi cộc lốc hay mặc cả gắt, vẫn giữ sự nhã nhặn, chuẩn mực, không suồng sã lại.
- Kỹ thuật gây tò mò: trả lời đúng trọng tâm nhưng hé lộ vừa đủ thông tin để khách thấy uy tín, khéo léo chừa lại khoảng trống để khách muốn kết nối Zalo nhận thông tin đầy đủ.
- Không lặp lại y nguyên cấu trúc câu ở mỗi lượt trả lời, tránh rập khuôn máy móc.

4. Nguyên tắc dữ kiện:
- CHỈ được dùng đúng các dữ kiện trong phần "THÔNG TIN DỰ ÁN" dưới đây để trả lời. Tuyệt đối không tự đoán mò hay bịa thêm giá, pháp lý, vị trí, tiện ích, hay cam kết nào không có trong đó.
- Nếu câu hỏi của khách nằm ngoài các dữ kiện có sẵn bên dưới, trả lời khéo léo rằng sẽ nhờ chuyên viên phụ trách liên hệ trao đổi chi tiết hơn với khách, không đoán mò hay bịa thông tin.

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
  'Đây là tin đầu tiên gửi tới khách này — bắt đầu câu trả lời bằng một lời chào ngắn tự nhiên theo đúng giới tính quy định (nam thì chào anh, nữ thì chào chị, không xác định được mới dùng anh/chị) trước khi trả lời.';

/**
 * Mục 4.2 (cập nhật — không còn CTA cố định 'M3' do code tự thêm): AI phải tự viết luôn cả câu mời
 * để lại số Zalo/điện thoại, GHÉP TỰ NHIÊN vào cuối câu trả lời (không phải 1 câu tách rời, càng
 * không phải công thức lặp lại y hệt mỗi lần) — đây là mục tiêu chốt lead DUY NHẤT còn lại của hệ
 * thống nên bắt buộc phải có, không được quên hay bỏ qua ở bất kỳ câu trả lời nào thuộc AI_TOPIC/
 * AI_FREE_TEXT.
 */
const PHONE_CTA_HINT =
  'Quy tắc xin số: Khi câu hỏi phù hợp để gửi thêm tài liệu (bảng giá chi tiết, vị trí chính xác, sơ đồ phân lô, hình ảnh thực tế), hãy khéo léo mời khách để lại số Zalo/điện thoại để bên em gửi qua. TUY NHIÊN, nếu trong các câu chat gần nhất bot đã từng mời xin số rồi hoặc khách đang hỏi dở chi tiết khác mà chưa muốn cho số, TUYỆT ĐỐI KHÔNG lặp lại câu xin số dồn dập ở lượt này — chỉ tập trung trả lời đúng trọng tâm và gợi mở bước tiếp theo một cách nhã nhặn.';

/**
 * Dịch 1 `ReplyIntent` (mục 4.2 mở rộng, `flow/flowEngine.ts`) + ngữ cảnh của lượt hiện tại thành
 * hướng dẫn cụ thể, ghép vào tin nhắn "user" cuối cùng gửi cho model — KHÔNG đưa vào system
 * instruction (giữ `buildSystemInstruction` thuần/arity 1, test được độc lập — mục 13). Export để
 * unit test độc lập được việc CHỈ đúng 2 intent (AI_TOPIC/AI_FREE_TEXT) mang theo `PHONE_CTA_HINT`,
 * 3 intent còn lại tuyệt đối không (mục 13).
 */
export function describeIntent(intent: ReplyIntent, userText: string, isNewCustomer: boolean): string {
  switch (intent.kind) {
    case 'AI_GREETING':
      return 'Sự kiện: khách vừa mở cửa sổ chat lần đầu, CHƯA nói/hỏi gì cả. Viết đúng 1 câu chào ngắn, thân thiện, tự nhiên theo đúng giới tính quy định ở trên (nếu là anh thì chào anh, nếu là chị thì chào chị, chỉ dùng anh/chị khi không xác định được giới tính) — không cần hỏi han hay giới thiệu gì thêm vì bên dưới tin này đã có sẵn 3 nút bấm chủ đề cho khách chọn. TUYỆT ĐỐI KHÔNG hỏi số điện thoại/Zalo ở bước này, còn quá sớm.';
    case 'AI_TOPIC':
      // Nút bấm chỉ có thể xuất hiện SAU khi khách đã nhận tin chào mở màn kèm 3 nút (mục 5.1,
      // handleFirstOpen gửi AI_GREETING riêng trước đó) -> AI_TOPIC không bao giờ cần tự chào lại,
      // kể cả lần bấm nút đầu tiên. Trước đây chèn GREETING_HINT vô điều kiện ở đây khiến khách bấm
      // nút chủ đề thứ 2 trở đi (sau khi đã trò chuyện) vẫn bị AI chào lại từ đầu — sai (mục 4.2).
      return `Sự kiện: ${TOPIC_LABEL[intent.topic]}. Trả lời đúng trọng tâm câu hỏi này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới. ${PHONE_CTA_HINT}`;
    case 'AI_FREE_TEXT':
      return `Sự kiện: khách vừa nhắn/bình luận tự do, nguyên văn: "${userText}". ${
        isNewCustomer ? GREETING_HINT : ''
      } Trả lời đúng trọng tâm nội dung này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới. ${PHONE_CTA_HINT}`;
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
        ...(ROUTER_API_KEY ? { Authorization: `Bearer ${ROUTER_API_KEY}` } : {}),
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
    let text = (data?.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/`/g, '');

    if (!text) {
      throw new Error('AI Router trả về nội dung rỗng');
    }

    // Bảo đảm triệt để đại từ xưng hô theo bộ lọc giới tính:
    // Nếu bộ lọc đã xác định rõ NAM hoặc NỮ, thay thế mọi từ "anh/chị" còn sót lại thành "anh" hoặc "chị"
    const { gender } = analyzeVietnameseName(customerName, userText);
    if (gender === 'MALE') {
      text = text.replace(/anh\/chị/g, 'anh').replace(/Anh\/chị/g, 'Anh').replace(/anh\/Chị/g, 'anh').replace(/Anh\/Chị/g, 'Anh');
    } else if (gender === 'FEMALE') {
      text = text.replace(/anh\/chị/g, 'chị').replace(/Anh\/chị/g, 'Chị').replace(/anh\/Chị/g, 'chị').replace(/Anh\/Chị/g, 'Chị');
    }

    return text;
  });
}
