import {
  findLastValidAssignment,
  findNextEmptyRowByColumnB,
  pickNextStaff,
  previousMonthTabName,
  resolveTargetSheetName,
} from '../src/services/sheetsService';

describe('sheetsService.resolveTargetSheetName (mục 8 mở rộng — chọn tab theo tháng)', () => {
  it('routes August leads to "Tháng 9" (giai đoạn chuyển đổi khi bot mới chạy)', () => {
    expect(resolveTargetSheetName(new Date(2026, 7, 15))).toBe('Tháng 9'); // month index 7 = tháng 8
  });

  it('routes September leads to "Tháng 9"', () => {
    expect(resolveTargetSheetName(new Date(2026, 8, 1))).toBe('Tháng 9'); // month index 8 = tháng 9
  });

  it('routes October leads to "Tháng 10"', () => {
    expect(resolveTargetSheetName(new Date(2026, 9, 5))).toBe('Tháng 10'); // month index 9 = tháng 10
  });

  it('routes November leads to "Tháng 11" (tự tạo tab mới)', () => {
    expect(resolveTargetSheetName(new Date(2026, 10, 1))).toBe('Tháng 11');
  });

  it('routes December and next January by month number, không phân biệt năm', () => {
    expect(resolveTargetSheetName(new Date(2026, 11, 31))).toBe('Tháng 12');
    expect(resolveTargetSheetName(new Date(2027, 0, 1))).toBe('Tháng 1');
  });
});

describe('sheetsService.previousMonthTabName (mục 8b/9/14 — lùi tab tháng liền trước, kể cả vòng qua năm mới)', () => {
  it('"Tháng 10" -> "Tháng 9", "Tháng 11" -> "Tháng 10", "Tháng 12" -> "Tháng 11"', () => {
    expect(previousMonthTabName('Tháng 10')).toBe('Tháng 9');
    expect(previousMonthTabName('Tháng 11')).toBe('Tháng 10');
    expect(previousMonthTabName('Tháng 12')).toBe('Tháng 11');
  });

  it('"Tháng 9" là tab gốc, không có tab nào trước đó -> null', () => {
    expect(previousMonthTabName('Tháng 9')).toBeNull();
  });

  it('vòng qua năm mới: "Tháng 1" -> "Tháng 12", không bị coi nhầm là tab gốc', () => {
    expect(previousMonthTabName('Tháng 1')).toBe('Tháng 12');
  });

  it('các tháng 2-8 (năm mới, sau khi đã vòng qua "Tháng 1") vẫn lùi tiếp bình thường, không dừng sớm', () => {
    expect(previousMonthTabName('Tháng 2')).toBe('Tháng 1');
    expect(previousMonthTabName('Tháng 7')).toBe('Tháng 6');
  });

  it('tên tab không đúng định dạng "Tháng {N}" -> null', () => {
    expect(previousMonthTabName('Hỏi lại')).toBeNull();
    expect(previousMonthTabName('Tháng chín')).toBeNull();
  });
});

describe('sheetsService.pickNextStaff (mục 9 — round-robin tiếp nối theo dropdown live)', () => {
  const dropdown = ['Lê Cường', 'Trọng Hiếu', 'Sơn San', 'Thao', 'Tuấn'];

  it('trả về người đầu tiên trong dropdown khi chưa có ai được ghi trước đó', () => {
    expect(pickNextStaff(dropdown, null)).toBe('Lê Cường');
  });

  it('trả về người kế tiếp ngay sau người được ghi gần nhất', () => {
    expect(pickNextStaff(dropdown, 'Lê Cường')).toBe('Trọng Hiếu');
    expect(pickNextStaff(dropdown, 'Sơn San')).toBe('Thao');
  });

  it('quay lại người đầu tiên khi người trước đó là người cuối danh sách (wraparound, AC7)', () => {
    expect(pickNextStaff(dropdown, 'Tuấn')).toBe('Lê Cường');
  });

  it('tự thích ứng khi danh sách dropdown thêm người mới', () => {
    const expanded = [...dropdown, 'Minh Anh'];
    expect(pickNextStaff(expanded, 'Tuấn')).toBe('Minh Anh');
  });

  it('quay lại từ đầu khi người được ghi gần nhất đã bị xoá khỏi dropdown', () => {
    const shrunk = ['Trọng Hiếu', 'Sơn San', 'Thao', 'Tuấn']; // đã xoá "Lê Cường"
    expect(pickNextStaff(shrunk, 'Lê Cường')).toBe('Trọng Hiếu');
  });

  it('tự thích ứng khi danh sách dropdown bớt người ở giữa', () => {
    const shrunk = ['Lê Cường', 'Sơn San', 'Thao', 'Tuấn']; // đã xoá "Trọng Hiếu"
    expect(pickNextStaff(shrunk, 'Lê Cường')).toBe('Sơn San');
  });

  it('throw khi dropdown rỗng', () => {
    expect(() => pickNextStaff([], null)).toThrow();
  });
});

describe('sheetsService.findLastValidAssignment (mục 9 — quét lịch sử, chịu được thêm/bớt người)', () => {
  it('trả về null khi chưa có lịch sử nào', () => {
    expect(findLastValidAssignment([], ['Lê Cường', 'Trọng Hiếu'])).toBeNull();
  });

  it('trả về null khi tất cả các ô đều trống', () => {
    expect(findLastValidAssignment([null, undefined, ''], ['Lê Cường'])).toBeNull();
  });

  it('trả về giá trị gần nhất khi người đó vẫn còn trong dropdown hiện tại', () => {
    const history = ['Lê Cường', 'Trọng Hiếu', 'Sơn San'];
    expect(findLastValidAssignment(history, ['Lê Cường', 'Trọng Hiếu', 'Sơn San', 'Thao', 'Tuấn'])).toBe(
      'Sơn San'
    );
  });

  it('bỏ qua người gần nhất nếu đã bị xoá khỏi dropdown, quét tiếp lên người hợp lệ trước đó', () => {
    // "Sơn San" là người được ghi gần nhất nhưng đã bị xoá khỏi dropdown hiện tại.
    const history = ['Lê Cường', 'Trọng Hiếu', 'Sơn San'];
    const currentDropdown = ['Lê Cường', 'Trọng Hiếu', 'Thao', 'Tuấn']; // đã xoá Sơn San
    expect(findLastValidAssignment(history, currentDropdown)).toBe('Trọng Hiếu');
  });

  it('bỏ qua nhiều người liên tiếp đã bị xoá, quét đủ sâu để tìm người hợp lệ', () => {
    const history = ['Lê Cường', 'Trọng Hiếu', 'Sơn San', 'Thao'];
    const currentDropdown = ['Lê Cường', 'Tuấn']; // chỉ còn 2 người, đã xoá Trọng Hiếu/Sơn San/Thao
    expect(findLastValidAssignment(history, currentDropdown)).toBe('Lê Cường');
  });

  it('trả về null nếu toàn bộ lịch sử đều là người đã bị xoá khỏi dropdown', () => {
    const history = ['Sơn San', 'Thao'];
    const currentDropdown = ['Lê Cường', 'Trọng Hiếu', 'Tuấn']; // đã xoá Sơn San, Thao
    expect(findLastValidAssignment(history, currentDropdown)).toBeNull();
  });

  it('kết hợp với pickNextStaff: người vừa gán bị xoá -> vẫn tiếp nối đúng vị trí luân phiên, không nhảy về đầu', () => {
    const history = ['Lê Cường', 'Trọng Hiếu', 'Sơn San']; // Sơn San vừa được gán gần nhất
    const currentDropdown = ['Lê Cường', 'Trọng Hiếu', 'Thao', 'Tuấn']; // Sơn San đã bị xoá
    const lastValid = findLastValidAssignment(history, currentDropdown);
    expect(lastValid).toBe('Trọng Hiếu');
    // Người tiếp theo phải là "Thao" (ngay sau Trọng Hiếu trong dropdown mới), KHÔNG phải "Lê Cường".
    expect(pickNextStaff(currentDropdown, lastValid)).toBe('Thao');
  });

  it('kết hợp với pickNextStaff: thêm người mới vào cuối danh sách vẫn nhận lượt đúng chỗ', () => {
    const history = ['Lê Cường', 'Trọng Hiếu', 'Sơn San', 'Thao', 'Tuấn'];
    const expandedDropdown = ['Lê Cường', 'Trọng Hiếu', 'Sơn San', 'Thao', 'Tuấn', 'Minh Anh'];
    const lastValid = findLastValidAssignment(history, expandedDropdown);
    expect(lastValid).toBe('Tuấn');
    expect(pickNextStaff(expandedDropdown, lastValid)).toBe('Minh Anh');
  });
});

describe('sheetsService.findNextEmptyRowByColumnB (điền lần lượt khi cột B trống, không so sánh cột A)', () => {
  it('trả về dòng 2 khi bảng rỗng (chưa có SĐT nào ở cột B)', () => {
    expect(findNextEmptyRowByColumnB([])).toBe(2);
    expect(findNextEmptyRowByColumnB([''])).toBe(2);
    expect(findNextEmptyRowByColumnB([null])).toBe(2);
    expect(findNextEmptyRowByColumnB([undefined])).toBe(2);
  });

  it('trả về dòng 3 khi dòng 2 đã có SĐT', () => {
    expect(findNextEmptyRowByColumnB(['0812995595'])).toBe(3);
  });

  it('điền lần lượt từ trên xuống dưới, dừng ở ô đầu tiên cột B trống', () => {
    const phones = [
      '0812995595', // row 2
      '0914345762', // row 3
      '0984389256', // row 4
      '0982787858', // row 5
      '0967398610', // row 6
      '0374409824', // row 7
      '0862032888', // row 8
      '0868560897', // row 9
      '0375188628', // row 10
      '0942587938', // row 11
      '0915526971', // row 12
      '0968371365', // row 13
      '0912919007', // row 14
    ];
    // Khi cả 13 dòng (row 2..14) đều có SĐT, dòng trống tiếp theo là row 15
    expect(findNextEmptyRowByColumnB(phones)).toBe(15);
  });

  it('bỏ qua khoảng trắng, xem ô chỉ toàn space là ô trống', () => {
    expect(findNextEmptyRowByColumnB(['0812995595', '   ', '0984389256'])).toBe(3);
  });
});

