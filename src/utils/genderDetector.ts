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
  'dao', 'ha', 'ma', 'ho', 'trinh', 'luong', 'thai', 'luu', 'ta',
  'phung', 'trieu', 'dam', 'chu', 'lam', 'to', 'cao', 'tong', 'khuong',
  'quach', 'la', 'nham', 'nghiem', 'luc', 'khong', 'trac'
]);

/**
 * Tên đệm đặc trưng 100% của NỮ trong tiếng Việt.
 */
const FEMALE_MIDDLE_NAMES = new Set(['thi', 'nu']);

/**
 * Tên đệm phổ biến truyền thống của NAM trong tiếng Việt.
 */
const MALE_MIDDLE_NAMES = new Set([
  'van', 'huu', 'dinh', 'duc', 'cong', 'ba', 'trong', 'viet', 'dang',
  'khac', 'the', 'quoc', 'quang', 'manh', 'duy', 'tien', 'xuan', 'phu'
]);

/**
 * Danh sách tên trung tính (dùng cho cả nam và nữ):
 * Khi tên khách thuộc danh sách này và không có tên đệm rõ ràng (Thị/Văn/Tuấn Anh/Ngọc Anh...),
 * tuyệt đối không đoán mò mà phải soi avatar hoặc giữ đại từ lịch sự anh/chị.
 */
export const NEUTRAL_FIRST_NAMES = new Set([
  'anh', 'binh', 'ha', 'giang', 'khanh', 'minh', 'thanh', 'duong', 'tu',
  'an', 'quy', 'linh', 'ngoc', 'chau', 'phuong', 'tam', 'xuan', 'bac',
  'lam', 'hien', 'thuong', 'hoai', 'kha', 'phuc', 'thien', 'tue', 'thao'
]);

/**
 * Các tổ hợp Tên đệm + Tên trung tính đặc trưng của NAM (ví dụ: Tuấn Anh, Quang Minh, Trường Giang...).
 */
export const MALE_COMPOUND_NAMES = new Set([
  // Tổ hợp với Anh (Nam)
  'tuan anh', 'duc anh', 'hai anh', 'quang anh', 'viet anh', 'hoang anh', 'nhat anh',
  'tien anh', 'duy anh', 'quoc anh', 'hung anh', 'the anh', 'trong anh', 'van anh',
  'manh anh', 'cong anh', 'ba anh', 'khac anh', 'nguyen anh', 'gia anh', 'trung anh',
  'dinh anh', 'huu anh', 'nam anh', 'kien anh', 'phu anh', 'thanh anh', 'hiep anh',
  'truong anh', 'phuc anh', 'long anh', 'son anh', 'loc anh', 'quan anh', 'dat anh',
  'chi anh', 'hieu anh', 'dong anh', 'lam anh', 'bao anh',
  // Tổ hợp với Minh (Nam)
  'quang minh', 'van minh', 'tien minh', 'duc minh', 'hai minh', 'tuan minh', 'nhat minh',
  'binh minh', 'hoang minh', 'trong minh', 'khac minh', 'gia minh', 'cong minh', 'tri minh',
  'hieu minh', 'dinh minh', 'thanh minh', 'chinh minh', 'huu minh', 'khang minh', 'quoc minh', 'anh minh',
  // Tổ hợp với Bình (Nam)
  'van binh', 'hai binh', 'quang binh', 'duc binh', 'quoc binh', 'trong binh', 'xuan binh',
  'huu binh', 'the binh', 'tien binh', 'hoang binh', 'tuan binh', 'thai binh', 'thanh binh',
  // Tổ hợp với Hà (Nam)
  'van ha', 'quang ha', 'duc ha', 'tien ha', 'manh ha', 'viet ha', 'trong ha', 'hoang ha', 'hai ha',
  // Tổ hợp với Giang (Nam)
  'truong giang', 'hoang giang', 'duc giang', 'hai giang', 'van giang', 'quang giang', 'huu giang', 'viet giang', 'long giang', 'chi giang', 'nam giang',
  // Tổ hợp với Khánh (Nam)
  'quoc khanh', 'duy khanh', 'gia khanh', 'trong khanh', 'duc khanh', 'van khanh', 'tuan khanh', 'tien khanh', 'hoang khanh', 'nam khanh', 'quang khanh', 'huy khanh', 'dang khanh', 'bao khanh',
  // Tổ hợp với Thanh (Nam)
  'van thanh', 'duc thanh', 'tien thanh', 'quang thanh', 'quoc thanh', 'cong thanh', 'huu thanh', 'trung thanh', 'xuan thanh', 'chi thanh', 'duy thanh', 'nam thanh', 'hai thanh',
  // Tổ hợp với Dương (Nam)
  'hai duong', 'tung duong', 'dai duong', 'bach duong', 'quang duong', 'thai duong', 'nam duong', 'hoang duong', 'viet duong',
  // Tổ hợp với Tú (Nam)
  'tuan tu', 'minh tu', 'quang tu', 'duc tu', 'anh tu', 'hoang tu', 'thanh tu', 'huu tu', 'trong tu', 'xuan tu', 'quoc tu', 'thien tu', 'dai tu',
  // Tổ hợp với An (Nam)
  'van an', 'quoc an', 'trong an', 'hoang an', 'duc an', 'bao an', 'truong an', 'thanh an', 'quang an', 'huu an', 'hai an', 'nhat an', 'duy an', 'viet an', 'thien an', 'vinh an',
  // Tổ hợp với Quý (Nam)
  'phu quy', 'duc quy', 'van quy', 'xuan quy', 'trong quy', 'quoc quy', 'huu quy', 'quang quy', 'tien quy',
  // Tổ hợp với Linh (Nam)
  'tuan linh', 'duc linh', 'quang linh', 'hai linh', 'hoang linh', 'van linh', 'tien linh', 'nhat linh', 'xuan linh',
  // Tổ hợp với Phương (Nam)
  'nam phuong', 'viet phuong', 'hoang phuong', 'van phuong', 'duc phuong', 'hai phuong', 'tien phuong',
  // Tổ hợp với Ngọc (Nam)
  'dai ngoc', 'van ngoc', 'quang ngoc'
]);

/**
 * Các tổ hợp Tên đệm + Tên trung tính đặc trưng của NỮ (ví dụ: Ngọc Anh, Thu Hà, Hương Giang...).
 */
export const FEMALE_COMPOUND_NAMES = new Set([
  // Tổ hợp với Anh (Nữ)
  'ngoc anh', 'mai anh', 'hong anh', 'quynh anh', 'thuy anh', 'dieu anh', 'huyen anh',
  'kim anh', 'my anh', 'lan anh', 'kieu anh', 'phuong anh', 'ha anh', 'thao anh',
  'van anh', 'bich anh', 'yen anh', 'tuyet anh', 'tram anh', 'hoai anh', 'nha anh',
  'nhu anh', 'thuc anh', 'le anh', 'khuc anh', 'nga anh', 'huong anh', 'minh anh',
  // Tổ hợp với Bình (Nữ)
  'thi binh', 'nhu binh', 'thuy binh', 'ngoc binh', 'thu binh', 'hoa binh',
  // Tổ hợp với Hà (Nữ)
  'thu ha', 'ngoc ha', 'thanh ha', 'thuy ha', 'mai ha', 'bich ha', 'hong ha', 'ngan ha',
  'cam ha', 'diep ha', 'lan ha', 'quynh ha', 'phuong ha',
  // Tổ hợp với Giang (Nữ)
  'huong giang', 'thu giang', 'tra giang', 'thanh giang', 'quynh giang', 'lam giang', 'ngoc giang', 'mai giang', 'cam giang',
  // Tổ hợp với Khánh (Nữ)
  'ngoc khanh', 'mai khanh', 'van khanh', 'thao khanh', 'kim khanh', 'huyen khanh', 'phuong khanh', 'nhu khanh', 'le khanh', 'thu khanh',
  // Tổ hợp với Minh (Nữ)
  'nguyet minh', 'thu minh', 'hong minh', 'thao minh', 'ha minh', 'tue minh', 'uyen minh', 'ngoc minh', 'thuy minh', 'huyen minh',
  // Tổ hợp với Thanh (Nữ)
  'thanh thanh', 'phuong thanh', 'ngoc thanh', 'mai thanh', 'thu thanh', 'ha thanh', 'kim thanh', 'nhu thanh', 'le thanh', 'thao thanh',
  // Tổ hợp với Dương (Nữ)
  'thuy duong', 'anh duong', 'hong duong', 'ngoc duong', 'thu duong', 'mai duong',
  // Tổ hợp với Tú (Nữ)
  'cam tu', 'thanh tu', 'khanh tu', 'ngoc tu', 'my tu', 'mai tu', 'quynh tu',
  // Tổ hợp với An (Nữ)
  'thu an', 'hoai an', 'binh an', 'khanh an', 'tue an', 'thuy an', 'my an', 'ngoc an', 'phuong an', 'thao an', 'nha an',
  // Tổ hợp với Quý (Nữ)
  'ngoc quy', 'nhu quy', 'thao quy', 'mai quy',
  // Tổ hợp với Linh (Nữ)
  'thuy linh', 'my linh', 'khanh linh', 'ngoc linh', 'mai linh', 'phuong linh', 'ha linh', 'dieu linh', 'truc linh', 'cam linh',
  // Tổ hợp với Phương (Nữ)
  'mai phuong', 'thu phuong', 'bich phuong', 'lan phuong', 'ngoc phuong', 'thao phuong', 'anh phuong',
  // Tổ hợp với Ngọc (Nữ)
  'nhu ngoc', 'bich ngoc', 'kim ngoc', 'mai ngoc', 'lan ngoc', 'anh ngoc', 'hong ngoc'
]);

/**
 * Từ điển tên chính (given name) phổ biến của NỮ (mở rộng hơn 120 tên).
 */
const FEMALE_FIRST_NAMES = new Set([
  'huong', 'hang', 'lan', 'mai', 'trang', 'thao', 'linh', 'hoa', 'nga', 'tuyet',
  'loan', 'oanh', 'yen', 'nhung', 'hanh', 'diep', 'thuy', 'ngan', 'ly', 'huyen',
  'tram', 'phuong', 'trinh', 'chau', 'quyen', 'dung', 'quynh', 'giang', 'hien',
  'my', 'chi', 'van', 'thu', 'dao', 'khiem', 'cuc', 'sen', 'thom', 'gam', 'lua',
  'mo', 'thoa', 'hoi', 'tuoi', 'anh', 'bich', 'dieu', 'duyen', 'hue', 'khanh',
  'le', 'lieu', 'man', 'men', 'mi', 'net', 'nguyet', 'nhan', 'nuong',
  'que', 'sinh', 'tam', 'tham', 'thuc', 'thuong', 'tien', 'truc', 'uyen', 'xuyen',
  'xoan', 'cam', 'nu', 'no', 'mui', 'tho', 'giao', 'nhi', 'nhu', 'ngat', 'lanh',
  'vui', 'kieu', 'thuan', 'lai', 'bup', 'bong', 'diem', 'doan', 'dan', 'giau',
  'han', 'khuyen', 'mong', 'ngon', 'nhien', 'nho', 'phan', 'phung', 'sa',
  'san', 'sim', 'suong', 'thoa', 'thuyen', 'tiep', 'to', 'tra', 'vy',
  'khue', 'sao', 'tue', 'y'
]);

/**
 * Từ điển tên chính (given name) phổ biến của NAM (mở rộng hơn 150 tên).
 */
const MALE_FIRST_NAMES = new Set([
  'cuong', 'hieu', 'tuan', 'hung', 'thang', 'nam', 'long', 'quan', 'huy', 'phong',
  'hai', 'hoang', 'tung', 'son', 'san', 'thanh', 'dat', 'trung', 'kien', 'bach',
  'phuc', 'quang', 'trong', 'thieu', 'minh', 'viet', 'duc', 'nghia', 'khang',
  'khoa', 'vu', 'tien', 'toan', 'lam', 'chien', 'trieu', 'thinh', 'kha', 'khoi',
  'luan', 'bao', 'tan', 'loc', 'sang', 'quy', 'vinh', 'phat', 'tai', 'chinh',
  'truc', 'hau', 'duong', 'quyen', 'thai', 'canh', 'con', 'dien',
  'dinh', 'don', 'giap', 'hao', 'hiep', 'hoan', 'huan', 'huynh', 'kinh',
  'liem', 'luat', 'luong', 'mau', 'nghi', 'nguyen', 'nhuan', 'niem', 'phu',
  'phung', 'quyet', 'si', 'song', 'tin', 'truong', 'tuong', 'uy', 'vuong',
  'yen', 'luc', 'khoat', 'tu', 'ba', 'bang', 'bien', 'can', 'cong',
  'chuan', 'chuyen', 'chuc', 'chuong', 'danh', 'doan', 'du', 'duan', 'due',
  'dung', 'duoc', 'duy', 'dac', 'dang', 'dai', 'dao', 'dong', 'han',
  'hoat', 'hoc', 'hoi', 'huu', 'khai', 'khac', 'khiet', 'khoe', 'khuong',
  'kiem', 'kiet', 'ky', 'lap', 'loi', 'luu', 'manh', 'nghiem', 'nien',
  'ninh', 'phiet', 'phuoc', 'quat', 'sam', 'sy', 'soan', 'sung', 'su',
  'suc', 'tao', 'tang', 'tat', 'te', 'thach', 'than', 'thien', 'thiet',
  'thong', 'thoi', 'thuc', 'thuong', 'thuyen', 'tich', 'tiep', 'tieu', 'tinh',
  'tong', 'tot', 'trac', 'trach', 'tri', 'triet', 'tuc', 'tuyen', 'vien'
]);

/**
 * Phát hiện đại từ xưng hô khách tự xưng trong nội dung tin nhắn/comment
 * (Hợp lệ 100% theo chính sách Meta, độ chính xác tuyệt đối do khách tự nhận).
 */
export function detectGenderFromText(text: string | null | undefined): Gender {
  if (!text || typeof text !== 'string') return 'UNKNOWN';

  const normalized = removeVietnameseTones(text).toLowerCase();

  // Mẫu tự xưng là Nam (Anh):
  const malePatterns = [
    /\b(anh)\s+(muon|can|hoi|quan tam|xem|tim|dang|chua|mua|thay|gui|lay|xin|inbox|nhan|alo|goi|biet|tinh)\b/,
    /\b(bao gia|gui|tu van|nhan|goi|alo|lien he|cho|bao)\s+(cho\s+)?(anh)\b/,
    /\bcho\s+anh\s+(hoi|xin|xem|biet)\b/,
    /\b(so|zalo|sdt|dien thoai)\s+(cua\s+)?(anh)\b/,
    /\b(anh)\s+(day|nhe|ha em|day em|nha em|nhe em)\b/,
    /\b(minh|toi)\s+la\s+anh\b/,
  ];

  // Mẫu tự xưng là Nữ (Chị):
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

  const cleaned = fullName
    .replace(/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    const textGender = detectGenderFromText(contextText);
    return { gender: textGender, callName: '' };
  }

  const rawTokens = cleaned.split(' ');
  const normTokens = rawTokens.map((t) => removeVietnameseTones(t).toLowerCase());

  // Mặc định tên gọi (callName) là từ cuối cùng trong chuỗi họ tên
  let callName = rawTokens[rawTokens.length - 1];

  // Phát hiện tên bị đảo ngược (First name đứng trước Họ, ví dụ: "Bay Nguyen", "Lan Nguyen")
  // Nếu chỉ có 2 từ, từ thứ 2 là họ phổ biến (Nguyen, Tran, Le...) và từ thứ nhất KHÔNG phải họ,
  // thì từ đầu tiên chính là tên gọi.
  const isReversedOrder =
    rawTokens.length === 2 &&
    COMMON_SURNAMES.has(normTokens[1]) &&
    !COMMON_SURNAMES.has(normTokens[0]);

  if (isReversedOrder) {
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

  // 1b. Kiểm tra tên đệm nam truyền thống (Văn, Hữu, Đình, Đức, Công,...)
  for (let i = 1; i < normTokens.length - 1; i++) {
    if (MALE_MIDDLE_NAMES.has(normTokens[i])) {
      return { gender: 'MALE', callName };
    }
  }

  const givenNameNorm = removeVietnameseTones(callName).toLowerCase();

  // 1c. Kiểm tra tổ hợp Đệm + Tên trung tính (vd: Tuấn Anh -> Nam, Ngọc Anh -> Nữ, Thu Hà -> Nữ, Quang Minh -> Nam)
  // Chỉ áp dụng khi có tên đệm (không phải tên đảo ngược 2 từ kiểu First name + Surname)
  if (!isReversedOrder && normTokens.length >= 2) {
    const prevToken = normTokens[normTokens.length - 2];
    const compoundName = `${prevToken} ${givenNameNorm}`;

    if (FEMALE_COMPOUND_NAMES.has(compoundName)) {
      return { gender: 'FEMALE', callName };
    }
    if (MALE_COMPOUND_NAMES.has(compoundName)) {
      return { gender: 'MALE', callName };
    }
  }

  // 2. Kiểm tra tên trung tính (Anh, Bình, Hà, Giang, Khánh, Minh, Thanh, Dương, Tú, An, Quý...):
  // Nếu không có tên đệm rõ ràng ở trên -> bắt buộc UNKNOWN để soi avatar hoặc dùng đại từ lịch sự anh/chị
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
 * - Không xác định được: giữ nguyên đại từ lịch sự mặc định "Anh/chị", "anh/chị".
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

  return template
    .replace(/Anh\/Chị/g, pronounTitle)
    .replace(/Anh\/chị/g, pronounCap)
    .replace(/anh\/chị/g, pronounLower)
    .replace(/anh chị/g, pronounLower);
}

/**
 * Nhận diện giới tính từ ảnh đại diện Facebook (profile_pic) thông qua Gemini Vision (9Router).
 * Bọc timeout 3 giây để không bao giờ làm nghẽn tiến trình webhook.
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

  const routerBaseUrl = options?.routerBaseUrl || process.env.AI_ROUTER_URL || 'http://34.124.234.83:20129/v1';
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

  // Tầng 1: bộ lọc tên xác định được rõ ràng -> dùng luôn, không cần gọi sang Tầng 2
  if (nameAnalysis.gender !== 'UNKNOWN') {
    return { gender: nameAnalysis.gender, callName, source: 'NAME' };
  }

  // Tầng 2: tên trung tính/không xác định được -> thử nhận diện qua ảnh đại diện
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
