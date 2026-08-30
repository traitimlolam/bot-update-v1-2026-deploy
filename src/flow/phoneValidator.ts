export type PhoneErrorType = 'missing' | 'excess' | 'invalidPrefix';

export interface PhoneCheckResult {
  valid: boolean;
  normalizedPhone: string | null;
  errorType: PhoneErrorType | null;
}

const VALID_PHONE_REGEX = /^0(3|5|7|8|9)\d{8}$/;
/**
 * Chuỗi số ứng viên là 1 trong 2 dạng: (a) các nhóm 2-4 chữ số nối bằng ĐÚNG 1 ký tự phân cách
 * (space/dấu chấm/gạch ngang) mỗi lần — đúng cách viết số điện thoại có định dạng thật (vd
 * "091 234 5678", "0912.345.678"); hoặc (b) 1 chuỗi số liền không dấu cách, ≥ 8 ký tự (mục 7 điểm 5).
 * Cố tình KHÔNG cho phép khoảng trắng nối 2 nhóm số dài tuỳ ý — nếu không, 2 chuỗi số ĐỘC LẬP đứng
 * cạnh nhau chỉ cách nhau 1 dấu cách (vd "mã căn 20345678 sđt 0912345678") sẽ bị regex tham lam gộp
 * nhầm thành 1 chuỗi số vô nghĩa duy nhất, khiến số điện thoại thật không được nhận diện đúng.
 */
const DIGIT_RUN_REGEX = /\d{2,4}(?:[\s.-]\d{2,4}){1,4}|\d{8,}/g;

/**
 * Trả về TẤT CẢ chuỗi số ứng viên (mục 7 điểm 5) trong văn bản, theo đúng thứ tự xuất hiện — không
 * chỉ chuỗi đầu tiên. Cần thiết vì 1 tin nhắn/comment có thể chứa nhiều chuỗi số (vd "toà B, mã căn
 * 20345678, sđt 0912345678") — nếu chỉ lấy chuỗi đầu tiên, số điện thoại thật đứng sau có thể bị bỏ
 * qua hoàn toàn, hoặc tệ hơn, chuỗi không phải điện thoại đứng trước bị hiểu nhầm thành số điện
 * thoại. `.match()` với regex có cờ `g` tự quản lý việc lặp qua toàn bộ chuỗi, không có rủi ro rò rỉ
 * trạng thái `lastIndex` giữa các lần gọi khác nhau tới hàm này.
 */
function extractDigitRuns(text: string): string[] {
  return text.match(DIGIT_RUN_REGEX) ?? [];
}

function stripSeparators(raw: string): string {
  return raw.replace(/[\s.-]/g, '');
}

/**
 * DIGIT_RUN_REGEX chỉ khớp chuỗi số thuần (bắt đầu/kết thúc bằng chữ số) nên dấu "+" của "+84"
 * đã bị loại ngay từ bước extractDigitRuns — tới đây `digits` không bao giờ chứa "+", chỉ cần
 * kiểm tra tiền tố "84" thuần là đủ để xử lý cả 2 dạng nhập "+84..." lẫn "84...".
 */
function normalizeCountryCode(digits: string): string {
  if (digits.startsWith('84') && digits.length > 10) {
    return '0' + digits.slice(2);
  }
  return digits;
}

const NOT_A_PHONE: PhoneCheckResult = { valid: false, normalizedPhone: null, errorType: null };

/**
 * Chuẩn hoá & xác thực số điện thoại theo mục 7 CLAUDE.md.
 * Chỉ chạy khi có chuỗi số liên tiếp >= 8 ký tự trong văn bản (mục 7.5),
 * tránh nhận nhầm câu chat thường có vài chữ số.
 *
 * Nguyên tắc bắt buộc (mục 7 điểm 6): `valid === true` khi và chỉ khi số đúng cả độ dài
 * lẫn đầu số hợp lệ. Mọi trường hợp khác (`valid === false`) đều phải dừng ở M6,
 * tuyệt đối không được dùng để gọi `sheetsService.appendLead()`.
 *
 * Nếu văn bản có NHIỀU chuỗi số ứng viên, ưu tiên chuỗi nào chuẩn hoá ra đúng 1 số điện thoại hợp
 * lệ (dù không phải chuỗi xuất hiện đầu tiên) — tránh bỏ sót số điện thoại thật đứng sau 1 chuỗi số
 * không liên quan (địa chỉ, mã căn hộ...). Khi KHÔNG có chuỗi nào hợp lệ, phân loại lỗi (thiếu/thừa/
 * sai đầu số) dựa theo chuỗi xuất hiện đầu tiên — giữ nguyên hành vi cũ cho trường hợp phổ biến chỉ
 * có đúng 1 chuỗi số trong tin nhắn.
 */
export function checkPhone(text: string): PhoneCheckResult {
  const candidates = extractDigitRuns(text)
    .map((raw) => normalizeCountryCode(stripSeparators(raw)))
    .filter((normalized) => /^\d+$/.test(normalized));

  if (candidates.length === 0) {
    return NOT_A_PHONE;
  }

  const validCandidate = candidates.find((normalized) => VALID_PHONE_REGEX.test(normalized));
  if (validCandidate) {
    return { valid: true, normalizedPhone: validCandidate, errorType: null };
  }

  const normalized = candidates[0];

  if (normalized.length < 10) {
    return { valid: false, normalizedPhone: normalized, errorType: 'missing' };
  }

  if (normalized.length > 10) {
    return { valid: false, normalizedPhone: normalized, errorType: 'excess' };
  }

  // đúng 10 số nhưng sai đầu số
  return { valid: false, normalizedPhone: normalized, errorType: 'invalidPrefix' };
}
