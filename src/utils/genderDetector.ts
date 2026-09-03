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
  'vui', 'kieu', 'thuan', 'thao', 'lai', 'lai'
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
 * Phân tích tên tiếng Việt của khách để dự đoán giới tính (Nam / Nữ / Chưa xác định)
 * và trích xuất tên gọi phù hợp.
 */
export function analyzeVietnameseName(fullName: string | null | undefined): GenderAnalysis {
  if (!fullName || typeof fullName !== 'string') {
    return { gender: 'UNKNOWN', callName: '' };
  }

  // Làm sạch các ký tự đặc biệt, số hoặc emoji
  const cleaned = fullName
    .trim()
    .replace(/[\d+!@#$%^&*()_=+~`{}[\]:;"'<>,.?/\\|-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!cleaned) {
    return { gender: 'UNKNOWN', callName: '' };
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

  // 1. Kiểm tra tên đệm "Thị" (chắc chắn 100% Nữ)
  for (let i = 1; i < normTokens.length - 1; i++) {
    if (FEMALE_MIDDLE_NAMES.has(normTokens[i])) {
      return { gender: 'FEMALE', callName };
    }
  }

  // 2. Kiểm tra tên chính (given name)
  const givenNameNorm = removeVietnameseTones(callName).toLowerCase();
  const isFemaleGiven = FEMALE_FIRST_NAMES.has(givenNameNorm);
  const isMaleGiven = MALE_FIRST_NAMES.has(givenNameNorm);

  if (isFemaleGiven && !isMaleGiven) {
    return { gender: 'FEMALE', callName };
  }
  if (isMaleGiven && !isFemaleGiven) {
    return { gender: 'MALE', callName };
  }

  // 3. Kiểm tra tên đệm nam (Văn, Hữu, Đình, Đức, Công,...)
  for (let i = 1; i < normTokens.length - 1; i++) {
    if (MALE_MIDDLE_NAMES.has(normTokens[i])) {
      return { gender: 'MALE', callName };
    }
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
  customerName: string | null | undefined
): string {
  if (!template) return '';

  const { gender, callName } = analyzeVietnameseName(customerName);

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
  } else {
    // UNKNOWN: Điền thẳng tên khách vào nếu có tên
    if (callName) {
      pronounLower = callName;
      pronounCap = callName;
      pronounTitle = callName;
    } else {
      return template;
    }
  }

  return template
    .replace(/Anh\/Chị/g, pronounTitle)
    .replace(/Anh\/chị/g, pronounCap)
    .replace(/anh\/chị/g, pronounLower)
    .replace(/anh chị/g, pronounLower);
}
