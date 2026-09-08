export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';

export interface GenderAnalysis {
  gender: Gender;
  callName: string;
}

/**
 * Bỏ dấu tiếng Việt và chuẩn hóa về dạng chữ thường không dấu để so sánh tên chính xác
 * (hỗ trợ cả tài khoản Facebook đặt tên có dấu hoặc không dấu).
 */
export function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Các họ phổ biến của người Việt (dùng để nhận diện tên đảo thứ tự như "Bay Nguyen", "Lan Nguyen").
 */
const COMMON_SURNAMES = new Set([
  'nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'vu', 'vo', 'phan',
  'truong', 'bui', 'dang', 'do', 'ngo', 'duong', 'ly', 'dinh', 'doan',
  'dao', 'ha', 'ma', 'ho', 'trinh', 'luong'
]);

/**
 * Tên đệm đặc trưng 100% của NỮ trong tiếng Việt.
 */
const FEMALE_MIDDLE_NAMES = new Set(['thi']);

/**
 * Tên đệm phổ biến của NAM trong tiếng Việt.
 */
/**
 * Danh sách tên trung tính (dùng cho cả nam và nữ):
 * Khi tên khách thuộc danh sách này và không có tên đệm rõ ràng (Thị/Văn...), tuyệt đối không đoán mò mà phải soi avatar hoặc giữ anh/chị.
 */
export const NEUTRAL_FIRST_NAMES = new Set([
  "anh", "binh", "ha", "giang", "khanh", "minh", "thanh", "duong", "tu", "an", "quy"
]);

const MALE_MIDDLE_NAMES = new Set([
  'van', 'huu', 'dinh', 'duc', 'cong', 'ba', 'trong', 'viet', 'dang', 'khac', 'the', 'quoc'
]);

/**
 * Từ điển tên chính (given name) phổ biến của NỮ.
 */
const FEMALE_FIRST_NAMES = new Set([
  'huong', 'hang', 'lan', 'mai', 'trang', 'thao', 'linh', 'hoa', 'nga', 'tuyet',
  'loan', 'oanh', 'yen', 'nhung', 'hanh', 'diep', 'thuy', 'ngan', 'ly', 'huyen',
  'tram', 'phuong', 'trinh', 'chau', 'quyen', 'dung', 'quynh', 'giang', 'hien',
  'my', 'chi', 'van', 'thu', 'dao', 'khiem', 'cuc', 'sen', 'thom', 'gam', 'lua',
  'mo', 'thoa', 'hoi', 'tuoi', 'anh', 'bich', 'dieu', 'duyen', 'hue', 'khanh',
  'le', 'lieu', 'man', 'men', 'mi', 'net', 'nguyet', 'nhan', 'nuong', 'phuong',
  'que', 'sinh', 'tam', 'tham', 'thuc', 'thuong', 'tien', 'truc', 'uyen', 'xuyen',
  'xoan', 'cam', 'nu', 'no', 'mui', 'tho', 'giao', 'nhi', 'nhu', 'ngat', 'lanh',
  'vui', 'kieu', 'thuan', 'thao', 'lai'
]);

/**
 * Từ điển tên chính (given name) phổ biến của NAM.
 */
const MALE_FIRST_NAMES = new Set([
  'cuong', 'hieu', 'tuan', 'hung', 'thang', 'nam', 'long', 'quan', 'huy', 'phong',
  'hai', 'hoang', 'tung', 'son', 'san', 'thanh', 'dat', 'trung', 'kien', 'bach',
  'phuc', 'quang', 'trong', 'thieu', 'minh', 'viet', 'duc', 'nghia', 'khang',
  'khoa', 'vu', 'tien', 'toan', 'lam', 'chien', 'trieu', 'thinh', 'kha', 'khoi',
  'luan', 'bao', 'tan', 'loc', 'sang', 'quy', 'vinh', 'phat', 'tai', 'chinh',
  'truc', 'hau', 'duong', 'quyen', 'tan', 'thai', 'tuan', 'canh', 'con', 'dien',
  'dinh', 'don', 'giap', 'hao', 'hiep', 'hoan', 'huan', 'huynh', 'hung', 'kinh',
  'liem', 'luat', 'luong', 'mau', 'nghi', 'nguyen', 'nhuan', 'niem', 'phu',
  'phung', 'quyet', 'si', 'song', 'tin', 'toan', 'truong', 'tuong', 'uy', 'vuong',
  'vu', 'yen', 'khanh', 'luc', 'khoat', 'tu'
]);

/**
 * Phát hiện đại từ xưng hô khách tự xưng trong nội dung tin nhắn/comment
 * (Hợp lệ 100% theo chính sách Meta, độ chính xác tuyệt đối do khách tự nhận).
 */
export function detectGenderFromText(text: string | null | undefined): Gender {
  if (!text || typeof text !== 'string') return 'UNKNOWN';

  const normalized = removeVietnameseTones(text).toLowerCase();

  // Mẫu tự xưng là Nam (Anh):
  // "anh muốn", "anh cần", "báo giá anh", "cho anh", "gửi anh", "anh hỏi", "số anh là", "zalo anh"
  const malePatterns = [
    /\b(anh)\s+(muon|can|hoi|quan tam|xem|tim|dang|chua|mua|thay|gui|lay|xin|inbox|nhan|alo|goi|biet|tinh)\b/,
    /\b(bao gia|gui|tu van|nhan|goi|alo|lien he|cho|bao)\s+(cho\s+)?(anh)\b/,
    /\bcho\s+anh\s+(hoi|xin|xem|biet)\b/,
    /\b(so|zalo|sdt|dien thoai)\s+(cua\s+)?(anh)\b/,
    /\b(anh)\s+(day|nhe|ha em|day em|nha em|nhe em)\b/,
    /\b(minh|toi)\s+la\s+anh\b/,
  ];

  // Mẫu tự xưng là Nữ (Chị):
  // "chị muốn", "chị cần", "báo giá chị", "cho chị", "gửi chị", "chị hỏi", "số chị là", "zalo chị"
  const femalePatterns = [
    /\b(chi)\s+(muon|can|hoi|quan tam|xem|tim|dang|chua|mua|thay|gui|lay|xin|inbox|nhan|alo|goi|biet|tinh)\b/,
    /\b(bao gia|gui|tu van|nhan|goi|alo|lien he|cho|bao)\s+(cho\s+)?(chi)\b/,
    /\bcho\s+chi\s+(hoi|xin|xem|biet)\b/,
    /\b(so|zalo|sdt|dien thoai)\s+(cua\s+)?(chi)\b/,
    /\b(chi)\s+(day|nhe|ha em|day em|nha em|nhe em)\b/,
    /\b(minh|toi)\s+la\s+chi\b/,
  ];

  const isMale = malePatterns.some((pattern) => pattern.test(normalized));
  const isFemale = femalePatterns.some((pattern) => pattern.test(normalized));

  if (isMale && !isFemale) return 'MALE';
  if (isFemale && !isMale) return 'FEMALE';
  return 'UNKNOWN';
}

/**
 * Phân tích tên tiếng Việt của khách để dự đoán giới tính (Nam / Nữ / Chưa xác định)
 * và trích xuất tên gọi phù hợp. Có thể kết hợp với nội dung tin nhắn (contextText) để tăng độ chính xác.
 */
export function analyzeVietnameseName(
  fullName: string | null | undefined,
  contextText: string | null | undefined = null
): GenderAnalysis {
  if (!fullName || typeof fullName !== 'string') {
    const textGender = detectGenderFromText(contextText);
    return { gender: textGender, callName: '' };
  }

  // Làm sạch các ký tự đặc biệt, số hoặc emoji
  const cleaned = fullName
    .trim()
    .replace(/[\d+!@#$%^&*()_=+~`{}[\]:;"'<>,.?/\\|-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!cleaned) {
    const textGender = detectGenderFromText(contextText);
    return { gender: textGender, callName: '' };
  }

  const rawTokens = cleaned.split(' ');
  const normTokens = rawTokens.map((t) => removeVietnameseTones(t).toLowerCase());

  // Xác định tên gọi (callName):
  // Mặc định là từ cuối cùng (chuẩn đặt tên Việt Nam: Họ + Đệm + Tên)
  let callName = rawTokens[rawTokens.length - 1];

  // Nếu tên chỉ gồm 2 từ và từ sau là Họ phổ biến (vd "Bay Nguyen", "Lan Nguyen" theo chuẩn Tây),
  // thì từ đầu tiên chính là tên gọi.
  if (
    rawTokens.length === 2 &&
    COMMON_SURNAMES.has(normTokens[1]) &&
    !COMMON_SURNAMES.has(normTokens[0])
  ) {
    callName = rawTokens[0];
  }

  // Ưu tiên 0: Nếu trong tin nhắn khách có tự xưng rõ ràng (vd "anh cần", "chị muốn"), lấy ngay giới tính này
  const textGender = detectGenderFromText(contextText);
  if (textGender !== 'UNKNOWN') {
    return { gender: textGender, callName };
  }

  // 1. Kiểm tra tên đệm "Thị" (chắc chắn 100% Nữ)
  for (let i = 1; i < normTokens.length - 1; i++) {
    if (FEMALE_MIDDLE_NAMES.has(normTokens[i])) {
      return { gender: 'FEMALE', callName };
    }
  }

  // 1b. Kiểm tra tên đệm nam (Văn, Hữu, Đình, Đức, Công,...)
  for (let i = 1; i < normTokens.length - 1; i++) {
    if (MALE_MIDDLE_NAMES.has(normTokens[i])) {
      return { gender: 'MALE', callName };
    }
  }

  // 2. Kiểm tra tên trung tính (Anh, Bình, Hà, Giang, Khánh, Minh, Thanh, Dương, Tú, An, Quý):
  // Nếu không có tên đệm rõ ràng ở trên -> bắt buộc UNKNOWN để soi avatar hoặc dùng đại từ lịch sự anh/chị
  const givenNameNorm = removeVietnameseTones(callName).toLowerCase();
  if (NEUTRAL_FIRST_NAMES.has(givenNameNorm)) {
    return { gender: 'UNKNOWN', callName };
  }

  // 3. Kiểm tra tên chính (given name) thuần Nữ / thuần Nam
  const isFemaleGiven = FEMALE_FIRST_NAMES.has(givenNameNorm);
  const isMaleGiven = MALE_FIRST_NAMES.has(givenNameNorm);

  if (isFemaleGiven && !isMaleGiven) {
    return { gender: 'FEMALE', callName };
  }
  if (isMaleGiven && !isFemaleGiven) {
    return { gender: 'MALE', callName };
  }

  // 4. Nếu tên gọi là tên trung tính hoặc không nằm trong từ điển -> UNKNOWN
  return { gender: 'UNKNOWN', callName };
}

/**
 * Điền đại từ xưng hô thích hợp vào câu trả lời mẫu:
 * - Nam: thay "Anh/chị", "Anh/Chị" -> "Anh", "anh/chị", "anh chị" -> "anh"
 * - Nữ: thay "Anh/chị", "Anh/Chị" -> "Chị", "anh/chị", "anh chị" -> "chị"
 * - Không xác định được: bỏ trống danh xưng Anh/Chị mà điền thẳng tên khách vào (vd "Bình", "Bay")
 *   Nếu không có tên -> giữ nguyên "Anh/chị", "anh/chị".
 */
export function formatPersonalizedMessage(
  template: string,
  customerName: string | null | undefined,
  contextText: string | null | undefined = null,
  knownGender?: Gender | null
): string {
  if (!template) return '';

  const { gender: analyzedGender } = analyzeVietnameseName(customerName, contextText);
  const gender = knownGender && knownGender !== 'UNKNOWN' ? knownGender : analyzedGender;

  let pronounLower = 'anh/chị';
  let pronounCap = 'Anh/chị';
  let pronounTitle = 'Anh/Chị';

  if (gender === 'MALE') {
    pronounLower = 'anh';
    pronounCap = 'Anh';
    pronounTitle = 'Anh';
  } else if (gender === 'FEMALE') {
    pronounLower = 'chị';
    pronounCap = 'Chị';
    pronounTitle = 'Chị';
  }
  // UNKNOWN: giữ nguyên đại từ lịch sự mặc định "anh/chị" đã set ở trên — tuyệt đối không tự ý
  // đoán mò và gọi cộc lốc bằng tên riêng khi chưa chắc chắn giới tính.

  return template
    .replace(/Anh\/Chị/g, pronounTitle)
    .replace(/Anh\/chị/g, pronounCap)
    .replace(/anh\/chị/g, pronounLower)
    .replace(/anh chị/g, pronounLower);
}

/**
 * Nhận diện giới tính từ ảnh đại diện Facebook (profile_pic) thông qua Gemini Vision (9Router).
 * Bọc timeout 6 giây để không bao giờ làm nghẽn tiến trình webhook.
 * Trả về: 'MALE' | 'FEMALE' | 'UNKNOWN'.
 */
export async function detectGenderFromAvatar(
  avatarUrl: string | null | undefined,
  options?: {
    routerBaseUrl?: string;
    routerApiKey?: string;
    modelName?: string;
    timeoutMs?: number;
  }
): Promise<Gender> {
  if (!avatarUrl || typeof avatarUrl !== 'string' || !avatarUrl.startsWith('http')) {
    return 'UNKNOWN';
  }

  const routerBaseUrl = options?.routerBaseUrl || process.env.AI_ROUTER_URL || 'http://100.93.163.100:20128/v1';
  const routerApiKey = options?.routerApiKey || process.env.AI_ROUTER_API_KEY;
  const modelName = options?.modelName || process.env.AI_MODEL_NAME || 'ag/gemini-3.8-flash-high';
  const timeoutMs = options?.timeoutMs || 3000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hãy nhìn ảnh đại diện này và trả lời chính xác một từ duy nhất: NAM hoặc NU hoặc KHONG_RO (nếu là ảnh phong cảnh, đồ vật, anime, hoạt hình, hoa lá, không có người, hoặc không thể xác định rõ nam hay nữ).',
            },
            {
              type: 'image_url',
              image_url: { url: avatarUrl },
            },
          ],
        },
      ],
      stream: false,
      max_tokens: 10,
    };

    const response = await fetch(`${routerBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(routerApiKey ? { Authorization: `Bearer ${routerApiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return 'UNKNOWN';
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data?.choices?.[0]?.message?.content ?? '';
    const normalized = removeVietnameseTones(rawContent).trim().toUpperCase();

    if (normalized.includes('NAM') && !normalized.includes('KHONG_RO')) {
      return 'MALE';
    }
    if (normalized.includes('NU') && !normalized.includes('KHONG_RO')) {
      return 'FEMALE';
    }
    return 'UNKNOWN';
  } catch {
    // Timeout hoặc lỗi mạng -> an toàn fallback về UNKNOWN
    return 'UNKNOWN';
  }
}

export interface DetermineGenderParams {
  customerName?: string | null;
  avatarUrl?: string | null;
  contextText?: string | null;
  isSilhouette?: boolean;
}

/**
 * Tổng hợp dự đoán giới tính từ nội dung tin nhắn, bộ lọc tên tiếng Việt và Gemini Vision ảnh đại diện.
 */
export async function determineCustomerGender(params: DetermineGenderParams): Promise<{
  gender: Gender;
  callName: string;
  source: 'TEXT' | 'NAME' | 'AVATAR' | 'DEFAULT';
}> {
  const { customerName, avatarUrl, contextText, isSilhouette } = params;

  // 1. Phân tích tên & trích xuất callName
  const nameAnalysis = analyzeVietnameseName(customerName, contextText);
  const callName = nameAnalysis.callName;

  // Nếu khách tự xưng trong tin nhắn (vd "anh cần", "chị muốn") -> Ưu tiên tuyệt đối 100%
  const textGender = detectGenderFromText(contextText);
  if (textGender !== 'UNKNOWN') {
    return { gender: textGender, callName, source: 'TEXT' };
  }

  // Tầng 1: bộ lọc tên xác định được rõ ràng -> dùng luôn, không cần gọi sang Tầng 2 (đỡ tốn 1 lượt
  // gọi Gemini Vision khi tên đã đủ chắc chắn).
  if (nameAnalysis.gender !== 'UNKNOWN') {
    return { gender: nameAnalysis.gender, callName, source: 'NAME' };
  }

  // Tầng 2: tên trung tính/không xác định được -> thử nhận diện qua ảnh đại diện (nếu có ảnh thật,
  // không phải silhouette mặc định).
  let avatarGender: Gender = 'UNKNOWN';
  if (avatarUrl && !isSilhouette) {
    avatarGender = await detectGenderFromAvatar(avatarUrl);
  }
  if (avatarGender === 'MALE' || avatarGender === 'FEMALE') {
    return { gender: avatarGender, callName, source: 'AVATAR' };
  }

  // Tầng 3: cả Tên lẫn Avatar đều không xác định được -> UNKNOWN (an toàn, giữ "anh/chị")
  return { gender: 'UNKNOWN', callName, source: 'DEFAULT' };
}
