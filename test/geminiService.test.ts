/**
 * Mục 4.2/13 CLAUDE.md: `buildSystemInstruction` phải là hàm thuần (không gọi API) — chỉ kiểm tra
 * việc lắp ráp system prompt: luôn nhúng đúng knowledgeBase.ts, không nhận/không rò rỉ số điện
 * thoại khách vào prompt (hàm không có tham số nào cho phép truyền số điện thoại).
 */
import { buildSystemInstruction, describeIntent } from '../src/ai/geminiService';
import { AREA_KNOWLEDGE_BASE } from '../src/config/knowledgeBase';

describe('geminiService.buildSystemInstruction (mục 4.2)', () => {
  it('luôn nhúng đúng nội dung knowledgeBase.ts', () => {
    const instruction = buildSystemInstruction('Nguyễn Văn A');
    expect(instruction).toContain(AREA_KNOWLEDGE_BASE);
  });

  it('cấm AI tự bịa dữ kiện ngoài knowledge base', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toMatch(/không.*bịa/i);
  });

  it('việc xin số điện thoại/Zalo phải làm đúng theo hướng dẫn "Sự kiện" ở tin nhắn cuối, không tự ý (mục 4.2)', () => {
    const instruction = buildSystemInstruction('Trần Thị B');
    expect(instruction).toMatch(/sự kiện.*yêu cầu/i);
  });

  it('khách nam -> hướng dẫn gọi "anh"', () => {
    const instruction = buildSystemInstruction('Nguyễn Văn Cường');
    expect(instruction).toContain('gọi khách là "anh"');
  });

  it('khách nữ -> hướng dẫn gọi "chị"', () => {
    const instruction = buildSystemInstruction('Trần Thị Lan');
    expect(instruction).toContain('gọi khách là "chị"');
  });

  it('không xác định được giới tính dù có tên -> vẫn gọi "anh/chị", tuyệt đối không gọi cộc lốc bằng tên riêng', () => {
    const instruction = buildSystemInstruction('Bay Nguyen');
    expect(instruction).toContain('gọi khách là "anh/chị"');
    expect(instruction).not.toContain('gọi thẳng tên khách là "Bay"');
    expect(instruction).toMatch(/không gọi cộc lốc bằng tên riêng/i);
  });

  it('không có tên khách -> gọi chung anh/chị', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toContain('gọi khách là "anh/chị"');
  });

  it('không có tham số nào để truyền số điện thoại khách vào prompt', () => {
    expect(buildSystemInstruction.length).toBe(1); // chỉ nhận customerName
  });

  it('nhúng đúng số Zalo/điện thoại liên hệ để cung cấp khi khách hỏi xin số của bên em', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toContain('0916.060.254');
  });

  it('bắt buộc trả lời ngắn gọn, súc tích (phương châm)', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toMatch(/ngắn gọn/i);
    expect(instruction).toMatch(/súc tích/i);
  });

  it('bắt buộc lịch sự dù khách nói chuyện thế nào', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toMatch(/lịch sự/i);
  });

  it('mục đích chính là gây tò mò để khách để lại số, không phải giải đáp cho hết', () => {
    const instruction = buildSystemInstruction(null);
    expect(instruction).toMatch(/tò mò/i);
    expect(instruction).toMatch(/không phải là giải đáp cho khách thật đầy đủ/i);
  });
});

/**
 * Mục 4.2 (cập nhật — không còn CTA 'M3' cố định do code tự thêm): CHÍNH AI phải tự viết câu mời để
 * lại số Zalo/điện thoại. `describeIntent` là nơi DUY NHẤT quyết định lượt nào bắt buộc phải có lời
 * mời đó (AI_TOPIC/AI_FREE_TEXT) và lượt nào tuyệt đối không được có (3 intent còn lại) — sai ở đây
 * đồng nghĩa với việc bot có thể quên xin số (mất mục tiêu chốt lead) hoặc hỏi lại số dù đã có/đã
 * đóng hội thoại (gây khó chịu cho khách).
 */
describe('geminiService.describeIntent (mục 4.2)', () => {
  it('AI_GREETING -> chào ngắn, TUYỆT ĐỐI không mời để lại số (còn quá sớm, mục 5.1)', () => {
    const instruction = describeIntent({ kind: 'AI_GREETING' }, '', false);
    expect(instruction).toMatch(/không hỏi số điện thoại/i);
    expect(instruction).not.toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_TOPIC -> bắt buộc phải có hướng dẫn mời để lại số Zalo/điện thoại', () => {
    const instruction = describeIntent({ kind: 'AI_TOPIC', topic: 'price' }, '', false);
    expect(instruction).toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_TOPIC -> KHÔNG BAO GIỜ chèn hướng dẫn chào (kể cả isNewCustomer=true), vì nút bấm luôn xảy ra SAU tin chào mở màn (mục 5.1)', () => {
    const whenNewCustomer = describeIntent({ kind: 'AI_TOPIC', topic: 'location' }, '', true);
    const whenReturning = describeIntent({ kind: 'AI_TOPIC', topic: 'location' }, '', false);
    expect(whenNewCustomer).not.toMatch(/lời chào ngắn/i);
    expect(whenReturning).not.toMatch(/lời chào ngắn/i);
  });

  it('AI_FREE_TEXT -> bắt buộc phải có hướng dẫn mời để lại số Zalo/điện thoại', () => {
    const instruction = describeIntent({ kind: 'AI_FREE_TEXT' }, 'dat o dau vay em', false);
    expect(instruction).toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_PHONE_CONFIRMED -> tuyệt đối KHÔNG được hỏi lại số (đã có số hợp lệ rồi)', () => {
    const instruction = describeIntent({ kind: 'AI_PHONE_CONFIRMED' }, '', false);
    expect(instruction).toMatch(/không hỏi lại số điện thoại/i);
    expect(instruction).not.toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_FOLLOWUP_CLOSED -> tuyệt đối KHÔNG được hỏi thêm số (đã CLOSED, đã bàn giao nhân viên)', () => {
    const instruction = describeIntent({ kind: 'AI_FOLLOWUP_CLOSED' }, '', false);
    expect(instruction).toMatch(/không hỏi thêm số điện thoại/i);
    expect(instruction).not.toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_PHONE_INVALID -> chỉ yêu cầu gửi lại đúng số, không phải lời mời để lại số kiểu mới', () => {
    const instruction = describeIntent({ kind: 'AI_PHONE_INVALID', errorType: 'missing' }, '', false);
    expect(instruction).toMatch(/gửi lại đúng số điện thoại/i);
    expect(instruction).not.toMatch(/mời khách để lại số zalo\/điện thoại/i);
  });

  it('AI_FREE_TEXT trên khách mới (isNewCustomer=true) -> có hướng dẫn chào mở đầu; khách cũ thì không', () => {
    const newCustomerInstruction = describeIntent({ kind: 'AI_FREE_TEXT' }, 'hoi gia', true);
    const returningCustomerInstruction = describeIntent({ kind: 'AI_FREE_TEXT' }, 'hoi gia', false);
    expect(newCustomerInstruction).toMatch(/lời chào ngắn/i);
    expect(returningCustomerInstruction).not.toMatch(/lời chào ngắn/i);
  });
});
