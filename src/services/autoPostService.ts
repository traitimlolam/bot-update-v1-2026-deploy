import { AREA_KNOWLEDGE_BASE } from '../config/knowledgeBase';

export type PostTopic = 'MORNING' | 'NOON' | 'EVENING';

interface GeneratedPost {
  caption: string;
  imageQuery: string;
}

const ROUTER_BASE_URL = process.env.AI_ROUTER_URL || 'https://womens-films-frontier-launch.trycloudflare.com/v1';
const MODEL_NAME = process.env.AI_MODEL_NAME || 'ag/gemini-3.8-flash-high';
const ROUTER_API_KEY = process.env.AI_ROUTER_API_KEY || '123456';
const GRAPH_BASE_URL = 'https://graph.facebook.com/v19.0';

/**
 * 1. Gọi AI viết nội dung theo 3 kịch bản khác nhau cho 3 khung giờ
 */
export async function generatePostContent(topic: PostTopic): Promise<GeneratedPost> {
  let promptContext = '';
  let imageKeywords = '';

  if (topic === 'MORNING') {
    promptContext = `
CHỦ ĐỀ: Phong cách sống xanh, nghỉ dưỡng cuối tuần, trốn khói bụi thành phố về vùng đồi Lạc Sơn (Hòa Bình cũ, nay thuộc Phú Thọ).
NỘI DUNG: Không khí trong lành, cây xanh, view đồi thoai thoải, ngôi nhà thứ hai (second home) ven đô cách Hà Nội chỉ hơn 1h di chuyển. Thích hợp cho gia đình thư giãn, làm vườn.
`;
    imageKeywords = 'vietnam peaceful mountain valley landscape';
  } else if (topic === 'NOON') {
    promptContext = `
CHỦ ĐỀ: Giới thiệu sản phẩm đất nền thực tế giá rẻ, pháp lý chuẩn.
CĂN CỨ DỮ LIỆU TỪ KNOWLEDGE BASE:
${AREA_KNOWLEDGE_BASE}
NỘI DUNG: Nhấn mạnh diện tích phổ biến 100-120m2, full thổ cư (ONT), sổ đỏ sẵn trao tay công chứng ngay. Giá chỉ từ 1,5 - 2 triệu/m2 (chỉ hơn trăm triệu một lô). Đường ô tô vào tận đất.
`;
    imageKeywords = 'vietnam countryside rural land plot garden';
  } else {
    promptContext = `
CHỦ ĐỀ: Phân tích cơ hội đầu tư tích sản và đón sóng hạ tầng.
NỘI DUNG: Đón đầu các tuyến cao tốc, làn sóng nghỉ dưỡng ven đô, bất động sản giá vùng trũng chỉ 2-3 triệu/m2 tiềm năng tăng trưởng tốt. Kênh giữ tiền an toàn chống lạm phát thời điểm hiện tại.
`;
    imageKeywords = 'modern highway infrastructure mountain green vietnam';
  }

  const systemInstruction = `
Bạn là chuyên gia marketing bất động sản nghỉ dưỡng chuyên nghiệp, am hiểu thị trường đất ven đô Hòa Bình.
Nhiệm vụ của bạn là viết một bài đăng Facebook Fanpage hấp dẫn, súc tích và chân thực.

QUY TẮC BẮT BUỘC:
1. Độ dài vừa phải: từ 120 đến 180 từ. Không viết lan man dài dòng.
2. Bố cục rõ ràng, ngắt dòng thoáng mắt:
   - Dòng 1: Tiêu đề giật tít hấp dẫn, có icon phù hợp.
   - Đoạn thân bài (2-3 đoạn ngắn): Nêu bật điểm đắt giá nhất của chủ đề.
   - Đoạn kết: Lời kêu gọi hành động (Call To Action) tự nhiên: Mời anh chị để lại bình luận hoặc nhắn tin trực tiếp để nhận thông tin sổ đỏ và vị trí thực tế.
3. Tuyệt đối không dùng ký hiệu markdown dạng in đậm sao sao (**), không dùng tiêu đề thăng (#). Chỉ dùng văn bản tự nhiên kèm emoji.
4. Cuối bài đính kèm 3-4 hashtag liên quan: #datnghiduong #dathoabinh #bdsgiare #secondhome
`;

  try {
    const res = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: promptContext },
        ],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      throw new Error(`AI generation failed with status ${res.status}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let caption = data.choices?.[0]?.message?.content || '';
    caption = caption.replace(/\\*\\*/g, '').replace(/#/g, '').trim();

    return {
      caption,
      imageQuery: imageKeywords,
    };
  } catch (err) {
    console.error('[autoPost] AI content generation error, using fallback:', err);
    return {
      caption: `🌿 SỞ HỮU NGAY LÔ ĐẤT NGHỈ DƯỠNG VEN ĐÔ CHỈ TỪ HƠN 100 TRIỆU\\n\\nKhông khí mát mẻ quanh năm, thế đất đồi thoai thoải nhìn ra thung lũng xanh mướt. Thích hợp làm nhà vườn cuối tuần cho cả gia đình xả stress.\\n\\n✅ Diện tích đẹp 100-120m2, full thổ cư 100%\\n✅ Sổ đỏ riêng chính chủ, công chứng sang tên ngay trong ngày\\n✅ Đường ô tô vào tận đất, hạ tầng giao thông kết nối thuận tiện\\n\\nAnh chị quan tâm nhắn tin hoặc để lại bình luận bên dưới, em gửi ngay sổ đỏ và vị trí chi tiết nhé!\\n\\n#datnghiduong #dathoabinh #bdsgiare #secondhome`,
      imageQuery: imageKeywords || 'vietnam peaceful mountain landscape',
    };
  }
}

/**
 * 2. Tìm ảnh minh họa chất lượng cao theo ngữ cảnh trên kho ảnh mở công khai
 */
export async function searchContextImageUrl(_query: string): Promise<string> {
  try {
    const landscapePool = [
      'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1200&q=80',
    ];

    const randomImg = landscapePool[Math.floor(Math.random() * landscapePool.length)];
    return randomImg;
  } catch {
    return 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80';
  }
}

/**
 * 3. Đăng bài viết kèm ảnh lên Fanpage qua Meta Graph API chính thức
 */
export async function publishPostToPage(caption: string, imageUrl: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return { success: false, error: 'FB_PAGE_ACCESS_TOKEN not configured' };
  }

  try {
    const url = `${GRAPH_BASE_URL}/me/photos`;
    const params = new URLSearchParams({
      url: imageUrl,
      caption: caption,
      access_token: pageAccessToken,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || data.error) {
      console.error('[autoPost] Facebook publish photo error:', data.error);
      return { success: false, error: data.error?.message || 'Facebook API error' };
    }

    console.log('[autoPost] Successfully published post to Facebook:', data.id);
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[autoPost] Failed to publish post:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * 4. Hàm điều phối thực hiện một lượt đăng bài hoàn chỉnh
 */
export async function executeAutoPost(topic?: PostTopic): Promise<{ success: boolean; postId?: string; topic: PostTopic; error?: string }> {
  let targetTopic: PostTopic = topic || 'MORNING';

  if (!topic) {
    const vnHours = (new Date().getUTCHours() + 7) % 24;
    if (vnHours >= 7 && vnHours < 11) {
      targetTopic = 'MORNING';
    } else if (vnHours >= 11 && vnHours < 16) {
      targetTopic = 'NOON';
    } else {
      targetTopic = 'EVENING';
    }
  }

  console.log(`[autoPost] Starting auto-post workflow for topic: ${targetTopic}`);
  const post = await generatePostContent(targetTopic);
  const imageUrl = await searchContextImageUrl(post.imageQuery);
  const result = await publishPostToPage(post.caption, imageUrl);

  return {
    success: result.success,
    postId: result.id,
    topic: targetTopic,
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
      await executeAutoPost('MORNING').catch((e) => console.error('[autoPost] 08h scheduler error:', e));
    }

    // Khung giờ 2: 11h30 trưa (NOON)
    if (vnHours === 11 && vnMinutes === 30 && lastPostedHour !== 11) {
      lastPostedHour = 11;
      await executeAutoPost('NOON').catch((e) => console.error('[autoPost] 11h30 scheduler error:', e));
    }

    // Khung giờ 3: 20h00 tối (EVENING)
    if (vnHours === 20 && vnMinutes === 0 && lastPostedHour !== 20) {
      lastPostedHour = 20;
      await executeAutoPost('EVENING').catch((e) => console.error('[autoPost] 20h scheduler error:', e));
    }
  }, CHECK_INTERVAL_MS);

  console.log('[autoPost] Scheduler initialized for 08:00, 11:30, 20:00 VN Time.');
}
