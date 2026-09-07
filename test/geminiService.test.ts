/**
 * Mục 4.2/13 CLAUDE.md: `buildSystemInstruction` phải là hàm thuần (không gọi API) — chỉ kiểm tra
 * việc lắp ráp system prompt: luôn nhúng đúng knowledgeBase.ts, không nhận/không rò rỉ số điện
 * thoại khách vào prompt (hàm không có tham số nào cho phép truyền số điện thoại).
 */
import { buildSystemInstruction } from '../src/ai/geminiService';
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

  it('không tự đề nghị xin số điện thoại/zalo (CTA do code tự thêm, không giao cho AI)', () => {
    const instruction = buildSystemInstruction('Trần Thị B');
    expect(instruction).toMatch(/không.*xin số điện thoại/i);
  });

  it('khách nam -> hướng dẫn gọi "anh"', () => {
    const instruction = buildSystemInstruction('Nguyễn Văn Cường');
    expect(instruction).toContain('gọi khách là "anh"');
  });

  it('khách nữ -> hướng dẫn gọi "chị"', () => {
    const instruction = buildSystemInstruction('Trần Thị Lan');
    expect(instruction).toContain('gọi khách là "chị"');
  });

  it('không xác định được giới tính nhưng có tên -> gọi thẳng tên, không dùng anh/chị', () => {
    const instruction = buildSystemInstruction('Bay Nguyen');
    expect(instruction).toContain('gọi thẳng tên khách là "Bay"');
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
