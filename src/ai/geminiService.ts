import { AREA_KNOWLEDGE_BASE } from '../config/knowledgeBase';
import { loadMessages } from '../config/loadConfig';
import { analyzeVietnameseName, Gender } from '../utils/genderDetector';
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
const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || 'http://34.124.234.83:20129/v1';
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
export function buildSystemInstruction(customerName: string | null, knownGender: Gender | null = null): string {
  const { gender: analyzedGender, callName } = analyzeVietnameseName(customerName);
  const gender = knownGender && knownGender !== 'UNKNOWN' ? knownGender : analyzedGender;

  let pronounRule: string;
  if (gender === 'MALE') {
    pronounRule = `Bộ lọc giới tính xác định khách là NAM: Bắt buộc xưng "em", gọi khách là "anh"${callName ? ` hoặc "anh ${callName}"` : ''}. Tuyệt đối KHÔNG dùng "anh/chị".`;
  } else if (gender === 'FEMALE') {
    pronounRule = `Bộ lọc giới tính xác định khách là NỮ: Bắt buộc xưng "em", gọi khách là "chị"${callName ? ` hoặc "chị ${callName}"` : ''}. Tuyệt đối KHÔNG dùng "anh/chị".`;
  } else {
    pronounRule = `Trường hợp chưa xác định chắc chắn giới tính qua tên và ảnh đại diện: Bắt buộc xưng "em" và gọi khách là "anh/chị" (ví dụ: "Dạ em chào anh/chị ạ!"). Tuyệt đối không gọi cộc lốc bằng tên riêng. Nếu trong tin nhắn khách tự xưng là "anh" hoặc "chị", hãy linh hoạt xưng hô đúng theo khách.`;
  }

  return `Bạn là chuyên viên tư vấn bất động sản của Fanpage, đang trực tiếp trả lời tin nhắn/comment của khách hàng.

Phương châm trả lời: NGẮN GỌN, súc tích, đúng trọng tâm — tuyệt đối không viết một đoạn văn dài dòng như văn mẫu, không liệt kê lan man. Thân thiện, lịch sự, nhiệt tình nhưng dứt khoát và chuyên nghiệp như một người thật đang gõ từng tin nhắn trên Messenger.

MỤC ĐÍCH CUỐI CÙNG của mọi câu trả lời KHÔNG PHẢI là giải đáp cho khách thật đầy đủ, mà là giải quyết thắc mắc trước, khơi gợi tò mò và tạo sự tin tưởng để khách SẴN LÒNG để lại số Zalo nhận tài liệu chi tiết.

1. Quy tắc độ dài câu trả lời và ngắt tin nhắn như người thật:
- Độ dài câu trả lời: Mỗi lượt trả lời chỉ được phép viết từ 2 đến 3 câu ngắn gọn (tổng độ dài dưới 60 từ).
- Văn phong: Đi thẳng vào đúng trọng tâm câu hỏi của khách (vị trí, giá, đường đi, pháp lý). Tự nhiên, ngắn gọn như người thật đang gõ phím nhanh trên điện thoại.
- Nghiêm cấm: Không viết văn giải thích dài dòng, không liệt kê tràng giang đại hải khi khách chưa hỏi sâu.
- Tuyệt đối không viết một đoạn văn dài dòng như văn mẫu, không dùng gạch đầu dòng hay bullet point.
- Chia câu trả lời thành 2 đến 3 câu ngắn gọn, tách biệt nhau bằng dấu xuống dòng. Mỗi câu là một ý rõ ràng (tối đa 3 bong bóng tin nhắn).
- Tin nhắn 1: Chào hỏi hoặc xác nhận ngắn gọn (nếu là tin đầu tiên).
- Tin nhắn 2: Trả lời thông tin trọng tâm (vị trí, giá, đường đi, pháp lý).
- Tin nhắn 3 (khi có cờ xin số): Lời mở đầu xin số điện thoại / Zalo lịch thiệp kèm lý do mang lại lợi ích cụ thể cho khách (ví dụ gửi sơ đồ phân lô, bảng giá chi tiết).

2. Quy tắc xin số điện thoại khéo léo & kiểm soát chặt theo cờ từ hệ thống:
- BẮT BUỘC TUÂN THỦ CỜ XIN SỐ TỪ HỆ THỐNG: Bot CHỈ ĐƯỢC PHÉP xin số điện thoại/Zalo khi trong hướng dẫn "Sự kiện" ở tin nhắn cuối cùng có CỜ XIN SỐ: BẬT. Nếu CỜ XIN SỐ: TẮT hoặc không yêu cầu, bot TUYỆT ĐỐI KHÔNG được gài câu xin số hay gợi ý để lại số, mà phải tập trung 100% giải đáp câu hỏi của khách một cách nhiệt tình, chính xác và tự nhiên.
- Quy tắc 3 mốc xin số của hệ thống:
  + Mốc 1 (Tại tin nhắn thứ 3 của khách): Lần đầu tiên xin số lịch sự kèm lý do chính đáng mang lại lợi ích cho khách (ví dụ: gửi sơ đồ phân lô, bảng giá chi tiết).
  + Mốc 2 (Tại tin nhắn thứ 6 của khách): Nhắc xin số lần thứ 2 nhẹ nhàng sau khi đã giải đáp chu đáo các tin 4 và 5.
  + Mốc 3 (Từ tin thứ 7 trở đi): Tuyệt đối không xin dồn dập; chỉ nhắc nhẹ khi khách hỏi sâu về thủ tục pháp lý, đặt cọc, xem đất thực tế hoặc đúng chu kỳ hệ thống bật cờ.
- Không được vồ vập, không hỏi xin số cộc lốc kiểu "cho em xin số điện thoại".
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

5. Chống trả lời trùng lặp & giữ nhịp hội thoại tự nhiên:
- Đối chiếu kỹ các tin nhắn bot đã gửi trong lịch sử hội thoại gần nhất (aiHistory):
  + Tuyệt đối không lặp lại cùng một kiểu mở đầu câu, không dùng lại các câu chào xã giao nếu đã chào trước đó (chỉ chào một lần ở tin nhắn đầu tiên, từ tin thứ 2 trở đi đi thẳng vào vấn đề).
  + Tuyệt đối không dùng lại y nguyên các câu từ, cấu trúc câu hoặc công thức của lượt chat trước.
  + Thay đổi linh hoạt cách diễn đạt, từ ngữ xưng hô và ngắt nhịp để cuộc trò chuyện luôn tự nhiên, sinh động và chân thực như một người tư vấn thật đang nhắn tin qua lại.

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
  'Quy tắc xin số: Khi khách hỏi sâu hoặc câu hỏi phù hợp để gửi thêm tài liệu (bảng giá chi tiết, sơ đồ phân lô, xem đất thực tế), hãy khéo léo mời khách để lại số Zalo/điện thoại để bên em gửi qua. TUY NHIÊN: Nếu khách chỉ hỏi thông tin cơ bản, hoặc trong các câu chat gần nhất bot đã từng xin số mà khách lờ đi hỏi câu khác, TUYỆT ĐỐI KHÔNG xin lại số dồn dập ở lượt này — chỉ tập trung trả lời đúng trọng tâm câu hỏi mới và giải đáp nhiệt tình, tự nhiên.';

/**
 * Tạo chỉ dẫn xin số điện thoại theo đúng 3 mốc:
 * - Mốc 1 (Bong bóng chat thứ 3): Lần đầu xin số lịch sự kèm lý do mang lại lợi ích.
 * - Mốc 2 (Tin nhắn thứ 6 của khách): Nhắc xin số lần 2 nhẹ nhàng.
 * - Mốc 3 (Từ tin thứ 7 trở đi): Tế nhị, chỉ hỏi khi sâu hoặc cách 4-5 lượt.
 * - Cờ TẮT: Tuyệt đối không xin số.
 */
export function buildPhoneGuidance(askPhone?: boolean, milestone?: 1 | 2 | 3): string {
  if (askPhone === false) {
    return '[CỜ XIN SỐ: TẮT - TUYỆT ĐỐI KHÔNG XIN SỐ Ở LƯỢT NÀY. Chỉ tập trung giải đáp nhiệt tình, chính xác và tự nhiên câu hỏi của khách. Tuyệt đối KHÔNG hỏi số điện thoại, số Zalo hay gợi ý để lại số.]';
  }
  if (askPhone === true) {
    if (milestone === 1) {
      return '[CỜ XIN SỐ: BẬT - MỐC 1 (tin nhắn thứ 3 của khách): Sau khi giải đáp thắc mắc, hãy bắt đầu lịch sự xin số điện thoại/Zalo lần đầu tiên kèm một lý do chính đáng và mang lại lợi ích thiết thực cho khách (ví dụ: Em có sẵn sơ đồ phân lô và bảng giá chi tiết từng vị trí, anh/chị cho em xin số Zalo để em gửi qua cho mình tiện xem nhé). Mời khách để lại số Zalo/điện thoại một cách tự nhiên và lịch sự.]';
    }
    if (milestone === 2) {
      return '[CỜ XIN SỐ: BẬT - MỐC 2 (tin nhắn thứ 6 của khách): Sau khi giải đáp nhiệt tình đúng trọng tâm câu hỏi của khách, hãy lịch sự nhắc xin số Zalo/điện thoại lần thứ 2 một cách nhẹ nhàng (ví dụ: để gửi tài liệu quy hoạch, bảng giá và bản đồ trích lục mới nhất). Mời khách để lại số Zalo/điện thoại.]';
    }
    if (milestone === 3) {
      return '[CỜ XIN SỐ: BẬT - MỐC 3 (tế nhị, từ tin thứ 7 trở đi): Khách đang hỏi sâu hoặc đến nhịp nhắc nhẹ. Hãy giải đáp chu đáo câu hỏi trước, sau đó mở lời nhắc nhẹ nhàng một lần mời kết nối Zalo/điện thoại để hỗ trợ thủ tục pháp lý, gửi trích lục sổ hoặc sắp xếp xe đưa đón xem đất thực tế miễn phí.]';
    }
    return '[CỜ XIN SỐ: BẬT: Hãy khéo léo mời khách để lại số Zalo/điện thoại để bên em gửi tài liệu chi tiết qua.]';
  }
  return PHONE_CTA_HINT;
}

/**
 * Dịch 1 `ReplyIntent` (mục 4.2 mở rộng, `flow/flowEngine.ts`) + ngữ cảnh của lượt hiện tại thành
 * hướng dẫn cụ thể, ghép vào tin nhắn "user" cuối cùng gửi cho model.
 */
export function describeIntent(
  intent: ReplyIntent,
  userText: string,
  isNewCustomer: boolean,
  overrideAskPhone?: boolean,
  overrideMilestone?: 1 | 2 | 3
): string {
  const askPhone =
    overrideAskPhone !== undefined
      ? overrideAskPhone
      : 'askPhone' in intent
      ? (intent as any).askPhone
      : undefined;
  const milestone =
    overrideMilestone !== undefined
      ? overrideMilestone
      : 'milestone' in intent
      ? (intent as any).milestone
      : undefined;

  const phoneHint = buildPhoneGuidance(askPhone, milestone);

  switch (intent.kind) {
    case 'AI_GREETING':
      return 'Sự kiện: khách vừa mở cửa sổ chat lần đầu, CHƯA nói/hỏi gì cả. Viết đúng 1 câu chào ngắn, thân thiện, tự nhiên theo đúng giới tính quy định ở trên (nếu là anh thì chào anh, nếu là chị thì chào chị, chỉ dùng anh/chị khi không xác định được giới tính) — không cần hỏi han hay giới thiệu gì thêm vì bên dưới tin này đã có sẵn 3 nút bấm chủ đề cho khách chọn. TUYỆT ĐỐI KHÔNG hỏi số điện thoại/Zalo ở bước này, còn quá sớm.';
    case 'AI_TOPIC':
      return `Sự kiện: ${TOPIC_LABEL[intent.topic]}. Trả lời đúng trọng tâm câu hỏi này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới. ${phoneHint}`;
    case 'AI_FREE_TEXT':
      return `Sự kiện: khách vừa nhắn/bình luận tự do, nguyên văn: "${userText}". ${
        isNewCustomer ? GREETING_HINT : ''
      } Trả lời đúng trọng tâm nội dung này, dựa hoàn toàn vào THÔNG TIN DỰ ÁN bên dưới. ${phoneHint}`;
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
  knownGender?: Gender | null;
  shouldAskPhone?: boolean;
  phoneMilestone?: 1 | 2 | 3;
}

/**
 * Gọi bộ não 9Router máy chủ qua OpenAI-compatible API (mục 4.2) — bọc `withRetry` (mục 10) như
 * mọi lời gọi ra ngoài khác.
 */
function getSafeFallbackText(customerName: string | null, knownGender?: Gender | null, userText?: string): string {
  const fallback = loadMessages().aiFallbackText;
  const effectiveGender =
    knownGender && knownGender !== 'UNKNOWN' ? knownGender : analyzeVietnameseName(customerName, userText ?? '').gender;
  if (effectiveGender === 'MALE') {
    return fallback.replace(/anh\/chị/g, 'anh').replace(/Anh\/chị/g, 'Anh');
  } else if (effectiveGender === 'FEMALE') {
    return fallback.replace(/anh\/chị/g, 'chị').replace(/Anh\/chị/g, 'Chị');
  }
  return fallback;
}

export async function generateAiReply(params: GenerateAiReplyParams): Promise<string> {
  const { intent, userText, history, customerName, isNewCustomer, knownGender } = params;

  try {
    return await withRetry(async () => {
    const shouldAskPhone =
      params.shouldAskPhone !== undefined
        ? params.shouldAskPhone
        : 'askPhone' in intent
        ? (intent as any).askPhone
        : undefined;
    const phoneMilestone =
      params.phoneMilestone !== undefined
        ? params.phoneMilestone
        : 'milestone' in intent
        ? (intent as any).milestone
        : undefined;

    // Phân tích lịch sử hội thoại để kiểm soát tần suất xin số & chống lặp:
    const alreadyGreeted = history.some(
      (h) => h.role === 'model' && /(xin chào|chào anh|chào chị|em chào)/i.test(h.text)
    );

    let historyGuidance = '';
    if (alreadyGreeted || !isNewCustomer) {
      historyGuidance += ' [QUY TẮC CHỐNG LẶP: Bot đã chào khách ở các lượt trước, tuyệt đối KHÔNG chào lại, không mở đầu bằng câu chào xã giao, đi thẳng vào câu trả lời.]';
    }

    if (shouldAskPhone === false) {
      historyGuidance += ' [KIỂM SOÁT TẦN SUẤT: Lớp kiểm soát luồng đã TẮT cờ xin số ở lượt này. TUYỆT ĐỐI KHÔNG xin số điện thoại/Zalo, chỉ tập trung trả lời đúng trọng tâm câu hỏi của khách.]';
    } else if (shouldAskPhone === true) {
      if (phoneMilestone === 1) {
        historyGuidance += ' [KIỂM SOÁT TẦN SUẤT: MỐC 1 (tin 3 của khách). Lịch sự xin số Zalo/điện thoại lần đầu tiên kèm lý do mang lại lợi ích thiết thực (sơ đồ phân lô/bảng giá).]';
      } else if (phoneMilestone === 2) {
        historyGuidance += ' [KIỂM SOÁT TẦN SUẤT: MỐC 2 (tin 6 của khách). Lịch sự nhắc xin số lần 2 nhẹ nhàng sau khi đã giải đáp chu đáo các tin 4 và 5.]';
      } else if (phoneMilestone === 3) {
        historyGuidance += ' [KIỂM SOÁT TẦN SUẤT: MỐC 3 (tế nhị, từ tin thứ 7 trở đi). Khách hỏi sâu hoặc đến nhịp nhắc nhẹ. Mở lời nhắc nhẹ một lần mời kết nối Zalo/điện thoại.]';
      }
    }

    const messages = [
      { role: 'system', content: buildSystemInstruction(customerName, knownGender) },
      ...history.map((turn) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.text,
      })),
      { role: 'user', content: describeIntent(intent, userText, isNewCustomer, shouldAskPhone, phoneMilestone) + historyGuidance },
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
        max_tokens: 250,
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
    // Nếu bộ lọc/avatar đã xác định rõ NAM hoặc NỮ, thay thế mọi từ "anh/chị" còn sót lại thành "anh" hoặc "chị"
    const effectiveGender = knownGender && knownGender !== 'UNKNOWN' ? knownGender : analyzeVietnameseName(customerName, userText).gender;
    if (effectiveGender === 'MALE') {
      text = text.replace(/anh\/chị/g, 'anh').replace(/Anh\/chị/g, 'Anh').replace(/anh\/Chị/g, 'anh').replace(/Anh\/Chị/g, 'Anh');
    } else if (effectiveGender === 'FEMALE') {
      text = text.replace(/anh\/chị/g, 'chị').replace(/Anh\/chị/g, 'Chị').replace(/anh\/Chị/g, 'chị').replace(/Anh\/Chị/g, 'Chị');
    }

    return text;
    });
  } catch (error) {
    console.error('[generateAiReply] Lỗi khi gọi AI Router, sử dụng câu trả lời dự phòng an toàn:', error);
    return getSafeFallbackText(customerName, knownGender, userText);
  }
}
