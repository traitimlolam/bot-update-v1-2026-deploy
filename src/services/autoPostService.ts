import { AREA_KNOWLEDGE_BASE } from "../config/knowledgeBase";

export type PostTopic = "MORNING" | "NOON" | "EVENING";

export interface GeneratedPost {
  caption: string;
  imageQuery: string;
}

export interface PublishResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface AutoPostResult {
  success: boolean;
  postId?: string;
  topic: PostTopic;
  caption?: string;
  imageUrl?: string;
  error?: string;
}

// 1. Cấu hình AI Router & Meta Graph API
const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || "http://100.93.163.100:20127/v1";
const MODEL_NAME = process.env.AI_MODEL_NAME || "ag/gemini-3.8-flash-high";
const ROUTER_API_KEY =
  process.env.AI_ROUTER_API_KEY ||
  (ROUTER_BASE_URL.includes("100.93.163.100") ? "sk-6bc6c7cc0898de2d-n44te0-912e33fb" : "123456");

const GRAPH_BASE_URL = "https://graph.facebook.com/v19.0";
const AI_TIMEOUT_MS = 25000;

// Thông tin Hotline / Zalo liên hệ bắt buộc ở mỗi bài đăng
export const DEFAULT_HOTLINE = "0916.060.254";
export const HOTLINE_PHONE = process.env.HOTLINE_PHONE || DEFAULT_HOTLINE;
export const HOTLINE_LINE = `Hotline / Zalo tư vấn và xe đưa đón xem đất: ${HOTLINE_PHONE}`;
export const POSTER_INFO_LINE = HOTLINE_LINE;

// 2. KHO ẢNH PHONG CẢNH THỰC TẾ HÒA BÌNH TUYỂN CHỌN (100% chuẩn làng quê, đồi núi Lạc Sơn, thung lũng Mai Châu, hồ Thung Nai, nhà vườn ven đô)
const HOA_BINH_CURATED_POOLS: Record<PostTopic, string[]> = {
  MORNING: [
    // Sương sớm, đồi núi thoai thoải Lạc Sơn, thung lũng Mai Châu xanh mát
    "https://cdn.tgdd.vn/Files/2023/03/13/1517343/du-lich-lac-son-hoa-binh-co-gi-hap-dan-kham-pha-ngay-202303142302489649.jpg",
    "https://saomaifly.com/image/catalog/thung-lung-mai-chau-tinh-hoa-binh.jpg",
    "https://dulichkhatvongviet.com/wp-content/uploads/2024/05/thung-lung-mai-chau.jpg",
    "https://titangroup.vn/wp-content/uploads/du-lich-mai-chau-hoa-binh.jpg",
    "https://cdn.tgdd.vn/Files/2023/03/13/1517343/du-lich-lac-son-hoa-binh-co-gi-hap-dan-kham-pha-ngay-202303142300169058.jpg",
    "https://dulichkhatvongviet.com/wp-content/uploads/2019/03/Mai-Chau.jpg",
  ],
  NOON: [
    // Đất nền thực tế, đường làng bê tông, ruộng bậc thang mùa lúa, cảnh làng quê Hòa Bình
    "https://cdn.tgdd.vn/Files/2023/03/13/1517343/du-lich-lac-son-hoa-binh-co-gi-hap-dan-kham-pha-ngay-202303142303133077.jpg",
    "https://media.vietnamplus.vn/images/6c6de9d9f940a6133c03c2b9de5db196b389af05bd9f4b988ecbfb8af2ffdafc838fd54a674bf6928db7a869e43b0de10d1eb70a9d7a1d59774dcce3f22d82d8/lua-chin-8-9926.jpg",
    "https://imgnvsk.vnanet.vn/mediaupload/content/2024/11/04/154-21-22-10.jpg",
    "https://hnm.1cdn.vn/2023/10/19/cdnimg.vietnamplus.vn-t870-uploaded-qfsqy-2023_10_18-_ttxvn_ruong1.jpg",
    "https://cloud.muaban.net/images/thumb-detail/2026/01/05/064/bcc18eb2c9204cf5b71c6b09ada610f6.jpg",
    "https://cloud.muaban.net/images/thumb-detail/2026/01/05/063/5f732e017d4e4cf49937075d8ab493fb.jpg",
  ],
  EVENING: [
    // Lòng hồ Thung Nai sông Đà nước xanh ngọc, hoàng hôn đồi núi, toàn cảnh Tây Bắc
    "https://www.vietnambooking.com/wp-content/uploads/2022/10/du-lich-thung-nai-hoa-binh-2-ngay-1-dem-11.jpg",
    "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhlcWkQmV7crpzqcyg0QJesdWOkNCjRk3SElhe3t5oBwZ4l4Lq14CEE4Dm_IzgtopsEpIwFObW2mn-E44l5VJ1u2bSEWlaFFrn2mv9Xsdp-xkWafl-JFvc0sFHr8PhjhzSgwHmG2Jtv7-rVKMf9x_PPW-ZBGnRMd8YXMh4aU_sOTyekjoppDRA5gCTT6hw/w640-h428/Kh%C3%A1m%20ph%C3%A1%20Thung%20Nai%20H%C3%B2a%20B%C3%ACnh%20Vi%C3%AAn%20ng%E1%BB%8Dc%20xanh%20gi%E1%BB%AFa%20l%C3%B2ng%20h%E1%BB%93%20s%C3%B4ng%20%C4%90%C3%A0.jpg",
    "https://ticotravel.com.vn/wp-content/uploads/2022/05/thung-nai-hoa-binh-1.jpg",
    "https://maichauhideaway.com/Data/Sites/1/media/thung-nai-hoa-binh/image6.jpg",
    "https://bazaarvietnam.vn/wp-content/uploads/2025/04/harper-bazaar-du-lich-hoa-binh-3.jpeg",
  ],
};

// Đa dạng hóa góc nhìn cho từng khung giờ để bài đăng mỗi ngày luôn mới mẻ
const TOPIC_ANGLES: Record<PostTopic, Array<{ prompt: string; keywords: string }>> = {
  MORNING: [
    {
      prompt: `CHỦ ĐỀ: Phong cách sống xanh và ngôi nhà thứ hai (second home) ven đô tại Lạc Sơn (Hòa Bình cũ, nay thuộc Phú Thọ).
NỘI DUNG: Buổi sáng trong lành, tiếng chim hót, trốn khói bụi Hà Nội chỉ hơn 1 giờ di chuyển. Không gian lý tưởng cho cả gia đình nghỉ ngơi cuối tuần, con trẻ trải nghiệm thiên nhiên, ông bà dưỡng già thanh thản.`,
      keywords: "đồi núi Lạc Sơn Hòa Bình sương sớm",
    },
    {
      prompt: `CHỦ ĐỀ: Trải nghiệm không gian đồi chè, vườn hoa trái và khí hậu mát mẻ quanh năm tại vùng núi Hòa Bình.
NỘI DUNG: Thức dậy giữa sương sớm vùng cao, nhâm nhi tách trà ấm ngắm view thung lũng xanh mướt. Sở hữu mảnh đất vườn sinh thái vừa nghỉ dưỡng vừa có rau sạch quả ngọt cho cả nhà.`,
      keywords: "thung lũng Mai Châu Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Nghỉ dưỡng tái tạo năng lượng (healing retreat) gần gũi thiên nhiên non nước Hòa Bình.
NỘI DUNG: Thế đất tựa sơn hướng thủy đón tài lộc, không gian khoáng đạt không tiếng còi xe ồn ào. Một chốn đi về an yên sau những ngày làm việc căng thẳng tại thủ đô.`,
      keywords: "nhà vườn sinh thái ven đô Hòa Bình",
    },
  ],
  NOON: [
    {
      prompt: `CHỦ ĐỀ: Giới thiệu sản phẩm đất nền thực tế giá rẻ, pháp lý chuẩn chỉnh tại Lạc Sơn.
CĂN CỨ DỮ LIỆU TỪ KNOWLEDGE BASE:
${AREA_KNOWLEDGE_BASE}
NỘI DUNG: Nhấn mạnh diện tích đẹp 100-120m2, full thổ cư (ONT), sổ đỏ sẵn trao tay công chứng ngay trong ngày. Giá chỉ từ 1,5 - 2 triệu/m2 (chỉ hơn 100 triệu một lô). Đường ô tô vào tận đất, điện nước đầy đủ.`,
      keywords: "đồi núi Lạc Sơn Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Đất phân lô pháp lý vàng - Sổ đỏ riêng từng lô cầm tay tại Hòa Bình.
CĂN CỨ DỮ LIỆU TỪ KNOWLEDGE BASE:
${AREA_KNOWLEDGE_BASE}
NỘI DUNG: An toàn tuyệt đối không lo tranh chấp quy hoạch. Giá bán chỉ hơn 100 triệu, trọn gói bao thuế phí sang tên đo đạc. Cuối tuần bên em có xe ô tô đưa đón tham quan thực tế hoàn toàn miễn phí.`,
      keywords: "ruộng bậc thang Hòa Bình mùa lúa",
    },
    {
      prompt: `CHỦ ĐỀ: Đất view đồi thoai thoải - Thích hợp làm nhà vườn nghỉ dưỡng hoặc homestay ngay.
CĂN CỨ DỮ LIỆU TỪ KNOWLEDGE BASE:
${AREA_KNOWLEDGE_BASE}
NỘI DUNG: Đất vuông vắn, dân cư hiện hữu thân thiện, gần chợ và trường học. Vốn nhỏ chỉ hơn trăm triệu đã sở hữu ngay tài sản có sổ hồng công chứng ngay.`,
      keywords: "cảnh đẹp Hòa Bình làng quê",
    },
  ],
  EVENING: [
    {
      prompt: `CHỦ ĐỀ: Phân tích cơ hội đầu tư tích sản và đón sóng hạ tầng ven đô Hòa Bình.
NỘI DUNG: Đón đầu các tuyến đường cao tốc và liên tỉnh kết nối thủ đô với Tây Bắc. Bất động sản giá vùng trũng chỉ 1,5 - 2 triệu/m2 còn nhiều dư địa tăng trưởng vượt bậc. Kênh giữ tiền an toàn và chống lạm phát bền vững.`,
      keywords: "hồ Thung Nai sông Đà Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Tích sản an toàn - Xu hướng dòng tiền tìm về đất sổ đỏ vùng ven Hòa Bình.
NỘI DUNG: Trong khi giá nhà chung cư nội đô tăng cao, đất nền ven đô pháp lý minh bạch giá chỉ từ hơn 100 triệu/lô là lựa chọn lý tưởng cho người trẻ và gia đình muốn tích lũy tài sản dài hạn.`,
      keywords: "hoàng hôn thung lũng Hòa Bình",
    },
    {
      prompt: `CHỦ ĐỀ: Đón sóng quy hoạch du lịch sinh thái và công nghiệp công nghệ cao Hòa Bình.
NỘI DUNG: Quy hoạch phát triển du lịch xanh gắn liền mở rộng hạ tầng giao thông mở ra tiềm năng tăng giá trị lớn. Cơ hội vàng cho nhà đầu tư sở hữu quỹ đất đẹp ngay từ giai đoạn đầu.`,
      keywords: "du lịch sông Đà Hòa Bình",
    },
  ],
};

// Bài viết dự phòng chuẩn mực cho từng chủ đề (đảm bảo luôn có Hotline/Zalo và nội dung chuẩn)
const FALLBACK_CAPTIONS: Record<PostTopic, string> = {
  MORNING: `🌿 THỨC DẬY GIỮA MÂY NGÀN – NGÔI NHÀ THỨ HAI VEN ĐÔ CHỈ HƠN 100 TRIỆU

Buổi sáng hít thở bầu không khí trong lành thoang thoảng mùi cỏ cây, xa rời hoàn toàn khói bụi ồn ào của thủ đô. Chỉ hơn 1 giờ lái xe, cả gia đình đã có chốn nghỉ dưỡng cuối tuần an yên, thảnh thơi làm vườn và hòa mình vào thiên nhiên.

✅ Không gian xanh mát quanh năm, thế đất tựa đồi nhìn thung lũng
✅ Diện tích 100-120m2, full thổ cư 100%, xây dựng tự do
✅ Sổ đỏ chính chủ trao tay, công chứng sang tên ngay trong ngày
✅ Đường ô tô vào tận đất, giao thông kết nối cực kỳ thuận tiện

Anh chị quan tâm để lại bình luận hoặc nhắn tin trực tiếp cho trang để nhận trọn bộ hình ảnh thực tế và vị trí lô đất nhé!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,

  NOON: `🏡 SỞ HỮU ĐẤT NỀN SẴN SỔ ĐỎ CHỈ TỪ 1,5 - 2 TRIỆU/M2

Cơ hội hiếm có sở hữu lô đất nền nghỉ dưỡng tại Lạc Sơn với mức giá vùng trũng cực kỳ hấp dẫn, pháp lý rõ ràng minh bạch từng mét vuông!

✅ Diện tích chuẩn đẹp: 100-120m2, 100% thổ cư (ONT)
✅ Sổ đỏ riêng từng lô cầm tay, công chứng sang tên ngay
✅ Đường bê tông ô tô vào tận nơi, điện nước sinh hoạt sẵn có
✅ Giá chỉ hơn 100 triệu/lô, bao trọn gói chi phí đo đạc sang tên
🚗 Cuối tuần bên em có xe ô tô đưa đón tham quan thực tế miễn phí

Để lại bình luận hoặc nhắn tin ngay hôm nay để nhận thông tin trích lục sổ đỏ và chọn vị trí đẹp nhất ạ!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,

  EVENING: `📈 TÍCH SẢN AN TOÀN ĐÓN SÓNG HẠ TẦNG VEN ĐÔ – GIÁ CHỈ HƠN 100 TRIỆU

Khi bất động sản nội đô liên tục lập đỉnh, dòng tiền thông minh đang dịch chuyển mạnh mẽ về các vùng đất trũng ven đô có hạ tầng cao tốc kết nối đồng bộ.

✅ Giá chỉ từ 1,5 - 2 triệu/m2 – dư địa tăng trưởng còn rất lớn
✅ Đất full thổ cư, sổ đỏ trao tay, bảo toàn vốn và chống lạm phát tối ưu
✅ Thích hợp cả đầu tư tích lũy lâu dài lẫn làm homestay nhà vườn sinh thái
✅ Giao thông liên tỉnh thuận tiện, kết nối nhanh chóng về trung tâm Hà Nội

Anh chị muốn đón đầu cơ hội hãy nhắn tin hoặc để lại bình luận bên dưới, em gửi ngay bảng giá và sơ đồ từng lô nhé!

${POSTER_INFO_LINE}

#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare`,
};

/**
 * Xử lý làm sạch nội dung do AI tạo ra và kiểm tra an toàn 100% có hotline:
 * - Loại bỏ suy nghĩ <think>...</think> nếu có.
 * - Chỉ xóa ký tự # làm tiêu đề Markdown ở đầu dòng (khi có dấu cách sau #).
 * - Loại bỏ ký hiệu in đậm (**) và ngoặc kép bao ngoài.
 * - HẬU KIỂM BẮT BUỘC: Đảm bảo 100% bài viết chứa Hotline / Zalo (nếu thiếu tự chèn trước hashtag).
 * - Giữ nguyên vẹn tất cả #hashtag ở cuối bài.
 */
export function cleanCaption(rawContent: string): string {
  let text = rawContent;

  // 1. Xóa khối suy nghĩ nội tâm <think>...</think>
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Xóa tiêu đề Markdown (# Tiêu đề, ## Tiêu đề) ở đầu dòng
  text = text.replace(/^#+\s+/gm, "");

  // 3. Xóa ký hiệu in đậm markdown (**)
  text = text.replace(/\*\*/g, "");

  // 4. Xóa dấu ngoặc kép bọc ngoài bài viết nếu AI vô tình thêm vào
  text = text.replace(/^[\"“](.*)[\"”]$/s, "$1").trim();

  // 5. Kiểm tra an toàn bắt buộc: luôn chèn cố định thông tin hotline trước hashtag
  let before = text;
  let hashtags = "#datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare";

  const firstHashtagIdx = text.search(/#[a-zA-Z0-9_À-ɏẠ-ỹ]+/);
  if (firstHashtagIdx !== -1) {
    before = text.slice(0, firstHashtagIdx).trimEnd();
    hashtags = text.slice(firstHashtagIdx).trim();
  }

  // Xóa mọi dòng thông tin người đăng cũ hoặc hotline cũ ở cuối bài để tránh trùng lặp
  before = before
    .replace(/Người đăng:[^\n]+/gi, "")
    .replace(/📞?\s*Hotline[^\n]+/gi, "")
    .trimEnd();

  text = `${before}\n\n${HOTLINE_LINE}\n\n${hashtags}`;

  return text.trim();
}

/**
 * 1. Gọi AI Router viết nội dung theo từng chủ đề và góc nhìn đa dạng, luôn chèn Hotline/Zalo
 */
export async function generatePostContent(topic: PostTopic): Promise<GeneratedPost> {
  const angles = TOPIC_ANGLES[topic] || TOPIC_ANGLES.MORNING;
  const selectedAngle = angles[Math.floor(Math.random() * angles.length)];

  const systemInstruction = `
Bạn là chuyên gia marketing bất động sản nghỉ dưỡng chuyên nghiệp, am hiểu thị trường đất ven đô Hòa Bình (khu vực Lạc Sơn).
Nhiệm vụ của bạn là viết một bài đăng Facebook Fanpage hấp dẫn, chân thực, gần gũi và giàu cảm xúc.

QUY TẮC BẮT BUỘC:
1. Độ dài: từ 130 đến 190 từ. Ngắn gọn, súc tích, ngắt dòng thoáng mắt.
2. Cấu trúc bài viết:
   - Dòng 1: Tiêu đề thu hút, có emoji phù hợp.
   - Thân bài (2-3 đoạn ngắn): Nêu bật điểm đắt giá nhất của khu đất (không khí trong lành, view đồi xanh, sổ đỏ trao tay, full thổ cư, giá chỉ từ 1,5 - 2 triệu/m2, chỉ hơn 100 triệu một lô, ô tô vào tận đất).
   - Đoạn kết: Lời kêu gọi hành động (CTA) tự nhiên: Mời anh chị để lại bình luận hoặc nhắn tin trực tiếp để nhận thông tin sổ đỏ và vị trí thực tế.
   - BẮT BUỘC CHÈN DÒNG THÔNG TIN LIÊN HỆ: Ở cuối đoạn kết bài, trước các hashtag, BẮT BUỘC luôn có dòng hotline:
${HOTLINE_LINE}
3. TUYỆT ĐỐI KHÔNG dùng ký hiệu in đậm markdown (**). Không dùng tiêu đề markdown (# ). Chỉ dùng chữ thường tự nhiên kèm emoji.
4. Cuối bài đính kèm các hashtag: #datnghiduong #dathoabinh #bdsgiare #secondhome #datnengiare
`.trim();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const res = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: selectedAngle.prompt },
        ],
        temperature: 0.75,
        max_tokens: 450,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`AI Router returned status ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content || "";

    if (!rawContent.trim()) {
      throw new Error("AI returned empty content");
    }

    const caption = cleanCaption(rawContent);

    return {
      caption,
      imageQuery: selectedAngle.keywords,
    };
  } catch (err) {
    console.error("[autoPost] AI generation failed, using thematic fallback:", err);
    return {
      caption: FALLBACK_CAPTIONS[topic] || FALLBACK_CAPTIONS.MORNING,
      imageQuery: selectedAngle.keywords,
    };
  }
}

/**
 * Tìm ảnh động theo từ khóa tiếng Việt về Hòa Bình qua công cụ tìm kiếm mở
 */
export async function searchDynamicHoaBinhImage(query: string): Promise<string | null> {
  try {
    const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&iax=images&ia=images`;
    const res = await fetch(tokenUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      signal: AbortSignal.timeout(3500),
    });
    const html = await res.text();
    const vqdMatch = html.match(/vqd="([^"]+)"/) || html.match(/vqd=([\d-]+)/);
    if (!vqdMatch) return null;

    const vqd = vqdMatch[1];
    const apiUrl = `https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
    const apiRes = await fetch(apiUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(3500),
    });
    const data = (await apiRes.json()) as { results?: Array<{ image?: string }> };

    for (const item of (data.results || []).slice(0, 10)) {
      const u = item.image;
      if (!u || !u.startsWith("https://")) continue;
      if (u.includes("scr.vn") || u.includes("pinterest") || u.includes("facebook") || u.includes("shopee")) continue;
      if (u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".png")) {
        try {
          const head = await fetch(u, {
            method: "HEAD",
            headers: { "User-Agent": "facebookexternalhit/1.1" },
            signal: AbortSignal.timeout(2000),
          });
          if (head.ok && head.headers.get("content-type")?.includes("image")) {
            return u;
          }
        } catch {
          // Bỏ qua link lỗi và thử link tiếp theo
        }
      }
    }
  } catch {
    // Nếu tìm kiếm lỗi hoặc timeout, chuyển sang kho ảnh tuyển chọn
  }
  return null;
}

/**
 * 2. Tìm ảnh minh họa chất lượng cao: Ưu tiên tìm ảnh động Hòa Bình theo từ khóa tiếng Việt,
 * nếu không thấy sẽ bốc ngẫu nhiên từ kho ảnh Hòa Bình thực tế đã chọn lọc.
 */
export async function searchContextImageUrl(query: string, topic?: PostTopic): Promise<string> {
  let targetTopic: PostTopic = topic || "MORNING";

  if (!topic) {
    const lower = (query || "").toLowerCase();
    if (lower.includes("sông đà") || lower.includes("thung nai") || lower.includes("hoàng hôn") || lower.includes("hạ tầng")) {
      targetTopic = "EVENING";
    } else if (lower.includes("ruộng") || lower.includes("thửa đất") || lower.includes("đất nền") || lower.includes("lạc sơn")) {
      targetTopic = "NOON";
    } else {
      targetTopic = "MORNING";
    }
  }

  // 1. Thử tìm ảnh động bằng từ khóa tiếng Việt về Hòa Bình
  if (query && query.trim()) {
    const dynamicImg = await searchDynamicHoaBinhImage(query);
    if (dynamicImg) {
      console.log(`[autoPost] Found authentic dynamic Hoa Binh image for "${query}":`, dynamicImg);
      return dynamicImg;
    }
  }

  // 2. Bốc ngẫu nhiên từ kho ảnh phong cảnh thực tế Hòa Bình tuyển chọn (100% chuẩn nét, không dùng ảnh Tây)
  const pool = HOA_BINH_CURATED_POOLS[targetTopic] || HOA_BINH_CURATED_POOLS.MORNING;
  const randomUrl = pool[Math.floor(Math.random() * pool.length)];

  const cacheBuster = Math.floor(Math.random() * 1000000);
  return randomUrl.includes("?") ? `${randomUrl}&sig=${cacheBuster}` : `${randomUrl}?sig=${cacheBuster}`;
}

/**
 * 3. Đăng bài viết kèm ảnh lên Fanpage qua Meta Graph API chính thức
 */
export async function publishPostToPage(caption: string, imageUrl: string): Promise<PublishResult> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return { success: false, error: "FB_PAGE_ACCESS_TOKEN not configured" };
  }

  try {
    const pageId = process.env.FB_PAGE_ID || "me";
    const url = `${GRAPH_BASE_URL}/${pageId}/photos`;
    const params = new URLSearchParams({
      url: imageUrl,
      caption: caption,
      published: "true",
      access_token: pageAccessToken,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } };
    if (!res.ok || data.error) {
      const errMsg = data.error?.message || "Facebook API error";
      if (errMsg.includes("pages_manage_posts")) {
        console.warn("[autoPost] LƯU Ý KỸ THUẬT: Token hiện tại thiếu quyền pages_manage_posts. Cần bổ sung quyền này tại Meta Developers Console để đăng trực tiếp lên Fanpage.");
      }
      console.error("[autoPost] Facebook publish photo error:", data.error);
      return { success: false, error: errMsg };
    }

    const publishedId = data.post_id || data.id;
    console.log("[autoPost] Successfully published post to Facebook:", publishedId);
    return { success: true, id: publishedId };
  } catch (err) {
    console.error("[autoPost] Failed to publish post:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * 4. Hàm điều phối thực hiện một lượt đăng bài hoàn chỉnh
 */
export async function executeAutoPost(topic?: PostTopic): Promise<AutoPostResult> {
  let targetTopic: PostTopic = topic || "MORNING";

  if (!topic) {
    const vnHours = (new Date().getUTCHours() + 7) % 24;
    if (vnHours >= 7 && vnHours < 11) {
      targetTopic = "MORNING";
    } else if (vnHours >= 11 && vnHours < 16) {
      targetTopic = "NOON";
    } else {
      targetTopic = "EVENING";
    }
  }

  console.log(`[autoPost] Starting auto-post workflow for topic: ${targetTopic}`);
  const post = await generatePostContent(targetTopic);
  const imageUrl = await searchContextImageUrl(post.imageQuery, targetTopic);
  const result = await publishPostToPage(post.caption, imageUrl);

  return {
    success: result.success,
    postId: result.id,
    topic: targetTopic,
    caption: post.caption,
    imageUrl: imageUrl,
    error: result.error,
  };
}

/**
 * 5. Thiết lập lịch đăng tự động bằng setInterval chuẩn giờ Việt Nam (UTC+7)
 */
export function startAutoPostScheduler(): void {
  const CHECK_INTERVAL_MS = 60 * 1000; // Quét mỗi phút 1 lần
  let lastPostedHour = -1;

  setInterval(async () => {
    const now = new Date();
    const vnHours = (now.getUTCHours() + 7) % 24;
    const vnMinutes = now.getUTCMinutes();

    // Khung giờ 1: 08h00 sáng (MORNING)
    if (vnHours === 8 && vnMinutes === 0 && lastPostedHour !== 8) {
      lastPostedHour = 8;
      await executeAutoPost("MORNING").catch((e) => console.error("[autoPost] 08h scheduler error:", e));
    }

    // Khung giờ 2: 11h30 trưa (NOON)
    if (vnHours === 11 && vnMinutes === 30 && lastPostedHour !== 11) {
      lastPostedHour = 11;
      await executeAutoPost("NOON").catch((e) => console.error("[autoPost] 11h30 scheduler error:", e));
    }

    // Khung giờ 3: 20h00 tối (EVENING)
    if (vnHours === 20 && vnMinutes === 0 && lastPostedHour !== 20) {
      lastPostedHour = 20;
      await executeAutoPost("EVENING").catch((e) => console.error("[autoPost] 20h scheduler error:", e));
    }
  }, CHECK_INTERVAL_MS);

  console.log("[autoPost] Scheduler initialized for 08:00, 11:30, 20:00 VN Time.");
}
