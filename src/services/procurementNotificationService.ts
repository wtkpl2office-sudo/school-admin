import { supabase } from '../lib/supabase';
import { sendTelegramNotification, escapeHtml } from '../lib/telegramNotify';

/**
 * Interface สำหรับข้อมูลสำนวนจัดซื้อจัดจ้าง
 */
export interface ProcurementCaseData {
  id: string;
  pcid: string;
  title: string;
  category?: string;
  policy_code?: string;
  fiscal_year?: string;
  estimated_amount?: number;
  final_amount?: number;
  current_gate?: number;
  status?: string;
  requester_id?: string;
  officer_id?: string;
  head_officer_id?: string;
  inspector_type?: string;
  committee_members?: any[];
  vendor_info?: any;
  order_number?: string;
  po_number?: string;
  inspection_number?: string;
  delivery_due_date?: string;
  actual_delivery_date?: string;
  approval_signatures?: any;
}

export class ProcurementNotificationService {

  /**
   * แปลงรหัสระเบียบเป็นชื่อภาษาไทยที่เข้าใจง่าย
   */
  static getPolicyName(code?: string): string {
    switch (code) {
      case 'W119_10K': return 'ว.119 ไม่เกิน 10,000 บาท (วิธีตกลงราคา)';
      case 'W119_100K': return 'ว.119 ไม่เกิน 100,000 บาท (วิธีเฉพาะเจาะจง)';
      case 'W089': return 'ว.89 ระบบ e-GP สพฐ.';
      case 'W877': return 'ว.877 จ้างเหมาบริการ 12 เดือน';
      case 'W523': return 'ว.523 จ้างปรับปรุงซ่อมแซมอาคาร';
      case 'LUNCH': return 'โครงการอาหารกลางวันนักเรียน';
      default: return code || 'จัดซื้อจัดจ้างทั่วไป';
    }
  }

  /**
   * ค้นหา Telegram Chat ID ของครูจาก teacher_id อย่างแม่นยำ
   */
  static async getTeacherTelegramChatId(teacherId?: string): Promise<{ chatId?: string; name?: string }> {
    if (!teacherId) return {};
    try {
      // 1. ค้นหาจากตาราง teachers
      const { data: teacher } = await supabase
        .from('teachers')
        .select('id, first_name, last_name, email, telegram_chat_id')
        .eq('id', teacherId)
        .maybeSingle();

      const fullName = teacher ? `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() : '';

      if (teacher?.telegram_chat_id) {
        return { chatId: teacher.telegram_chat_id, name: fullName };
      }

      // 2. ค้นหาจากตาราง profiles ด้วย email
      if (teacher?.email) {
        const { data: profByEmail } = await supabase
          .from('profiles')
          .select('telegram_chat_id, display_name')
          .eq('email', teacher.email)
          .maybeSingle();

        if (profByEmail?.telegram_chat_id) {
          return { chatId: profByEmail.telegram_chat_id, name: fullName || profByEmail.display_name };
        }
      }

      // 3. ค้นหาจากตาราง profiles ด้วย first_name
      if (teacher?.first_name) {
        const { data: profByName } = await supabase
          .from('profiles')
          .select('telegram_chat_id, display_name')
          .ilike('display_name', `%${teacher.first_name.trim()}%`)
          .maybeSingle();

        if (profByName?.telegram_chat_id) {
          return { chatId: profByName.telegram_chat_id, name: fullName || profByName.display_name };
        }
      }

      return { name: fullName };
    } catch (err) {
      console.error('[PROCUREMENT NOTIFY] Error finding teacher telegram chat ID:', err);
      return {};
    }
  }

  /**
   * ดึงรายชื่อกรรมการตรวจรับพัสดุพร้อม Chat ID
   */
  static async getCommitteeDetails(members: any[]): Promise<Array<{ name: string; role: string; chatId?: string }>> {
    if (!Array.isArray(members) || members.length === 0) return [];
    
    const results: Array<{ name: string; role: string; chatId?: string }> = [];
    for (const m of members) {
      const teacherId = m.teacher_id || m.id;
      const roleText = m.role === 'president' ? 'ประธานกรรมการ' : m.role === 'member' ? 'กรรมการ' : 'กรรมการ/เลขานุการ';
      let personName = m.name || '';
      let chatId = m.telegram_chat_id;

      if (teacherId) {
        const detail = await this.getTeacherTelegramChatId(teacherId);
        if (detail.name && !personName) personName = detail.name;
        if (detail.chatId && !chatId) chatId = detail.chatId;
      }

      results.push({
        name: personName || 'กรรมการตรวจรับ',
        role: roleText,
        chatId
      });
    }
    return results;
  }

  /**
   * 1. ส่งการ์ดแจ้งเตือนถึง "หัวหน้าเจ้าหน้าที่" เพื่อพิจารณารายงานข้อ 22 (Gate 2)
   */
  static async notifyHeadOfficerProposal(caseData: ProcurementCaseData): Promise<{ success: boolean; message: string }> {
    try {
      const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;
      const amountFmt = amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const policyStr = this.getPolicyName(caseData.policy_code);
      const vendorName = caseData.vendor_info?.name || 'ร้านค้า/ผู้รับจ้างตามใบเสนอราคา';

      const requester = await this.getTeacherTelegramChatId(caseData.requester_id);
      const headOfficer = await this.getTeacherTelegramChatId(caseData.head_officer_id);
      const committee = await this.getCommitteeDetails(caseData.committee_members || []);

      const committeeStr = committee.length > 0 
        ? committee.map(c => `• ${escapeHtml(c.name)} (${c.role})`).join('\n')
        : '• ผู้ตรวจรับพัสดุ (1 ท่าน)';

      let msg = `📋 <b>[เสนอหัวหน้าเจ้าหน้าที่] รายงานขอซื้อ/ขอจ้าง (ข้อ 22)</b>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📂 <b>เลขสำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
      msg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
      msg += `💰 <b>วงเงินจัดหา:</b> ฿${amountFmt} บาท\n`;
      msg += `📜 <b>เกณฑ์ระเบียบ:</b> ${escapeHtml(policyStr)}\n`;
      msg += `🏪 <b>ผู้เสนอราคา:</b> ${escapeHtml(vendorName)}\n`;
      msg += `👤 <b>ผู้ขอซื้อ/ขอจ้าง:</b> ${escapeHtml(requester.name || 'เจ้าหน้าที่ผู้รับผิดชอบ')}\n\n`;
      msg += `👮 <b>คณะกรรมการตรวจรับพัสดุ:</b>\n${committeeStr}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<i>เรียน หัวหน้าเจ้าหน้าที่พัสดุ เพื่อโปรดพิจารณากลั่นกรองและให้ความเห็นชอบก่อนนำเสนอ ผอ. ลงนามอนุมัติค่ะ 🌸</i>`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '🧐 เห็นชอบเสนอ ผอ.', callback_data: `action=prc_hok&id=${caseData.id}` },
            { text: '↩️ แจ้งแก้ไข', callback_data: `action=prc_rej&id=${caseData.id}` }
          ]
        ]
      };

      // ส่งหาหัวหน้าเจ้าหน้าที่ส่วนตัว (ถ้ามี) หรือส่งเข้ากลุ่มเสนอหนังสือ (proposal)
      const targetChatId = headOfficer.chatId || 'proposal';
      await sendTelegramNotification(msg, targetChatId, replyMarkup);

      return { success: true, message: 'ส่งแจ้งเตือนหัวหน้าเจ้าหน้าที่เรียบร้อยแล้ว' };
    } catch (err: any) {
      console.error('[PROCUREMENT NOTIFY] Error notifyHeadOfficerProposal:', err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 2. ส่งการ์ดแจ้งเตือนถึง "ผู้อำนวยการโรงเรียน" เพื่ออนุมัติจัดซื้อจัดจ้าง (Gate 2 -> Gate 3)
   */
  static async notifyDirectorProposal(caseData: ProcurementCaseData, approvedByName?: string): Promise<{ success: boolean; message: string }> {
    try {
      const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;
      const amountFmt = amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const policyStr = this.getPolicyName(caseData.policy_code);
      const vendorName = caseData.vendor_info?.name || 'ร้านค้า/ผู้รับจ้างตามใบเสนอราคา';
      const committee = await this.getCommitteeDetails(caseData.committee_members || []);

      const committeeStr = committee.length > 0 
        ? committee.map(c => `• ${escapeHtml(c.name)} (${c.role})`).join('\n')
        : '• ผู้ตรวจรับพัสดุ';

      let msg = `📌 <b>[เสนอ ผอ. อนุมัติจัดซื้อจัดจ้าง]</b>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📂 <b>เลขสำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
      msg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
      msg += `💰 <b>วงเงินขออนุมัติ:</b> ฿${amountFmt} บาท\n`;
      msg += `📜 <b>ระเบียบ:</b> ${escapeHtml(policyStr)}\n`;
      msg += `🏪 <b>คู่สัญญา/ผู้ขาย:</b> ${escapeHtml(vendorName)}\n`;
      if (approvedByName) {
        msg += `✅ <b>หัวหน้าเจ้าหน้าที่:</b> ${escapeHtml(approvedByName)} (เห็นชอบแล้ว)\n`;
      }
      msg += `\n👮 <b>คณะกรรมการตรวจรับพัสดุ:</b>\n${committeeStr}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<i>เรียน ผู้อำนวยการโรงเรียน เพื่อโปรดพิจารณาอนุมัติจัดซื้อจัดจ้าง และแต่งตั้งผู้ตรวจรับพัสดุค่ะ 🌸</i>`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '✍️ อนุมัติจัดซื้อ/จัดจ้าง', callback_data: `action=prc_dok&id=${caseData.id}` },
            { text: '❌ ไม่อนุมัติ', callback_data: `action=prc_rej&id=${caseData.id}` }
          ]
        ]
      };

      // ส่งเข้าห้องแชทเสนอหนังสือของ ผอ.
      await sendTelegramNotification(msg, 'proposal', replyMarkup);

      return { success: true, message: 'ส่งเสนอผู้อำนวยการเรียบร้อยแล้ว' };
    } catch (err: any) {
      console.error('[PROCUREMENT NOTIFY] Error notifyDirectorProposal:', err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 3. แจ้งเตือนผู้เกี่ยวข้องทุกคนเมื่อ "ผอ. อนุมัติแล้ว" (Gate 3 Ready)
   */
  static async notifyStakeholdersApproved(caseData: ProcurementCaseData, approvedByName?: string): Promise<void> {
    try {
      const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;
      const amountFmt = amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const vendorName = caseData.vendor_info?.name || '-';
      const orderNum = caseData.order_number || 'คำสั่งแต่งตั้ง กก.';
      const poNum = caseData.po_number || 'PO ออกใหม่';
      const dueDate = caseData.delivery_due_date ? new Date(caseData.delivery_due_date).toLocaleDateString('th-TH') : 'ภายใน 15 วันทำการ';

      // 3.1 แจ้งเตือนกลุ่มส่วนกลาง (Central Notification)
      let centralMsg = `🎉 <b>[อนุมัติแล้ว] สำนวนจัดซื้อจัดจ้าง</b>\n`;
      centralMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
      centralMsg += `📂 <b>สำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
      centralMsg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
      centralMsg += `💰 <b>วงเงิน:</b> ฿${amountFmt} บาท\n`;
      centralMsg += `🏪 <b>ผู้ขาย:</b> ${escapeHtml(vendorName)}\n`;
      centralMsg += `📋 <b>เลขที่คำสั่งแต่งตั้ง:</b> <code>${escapeHtml(orderNum)}</code>\n`;
      centralMsg += `🧾 <b>เลขที่ PO:</b> <code>${escapeHtml(poNum)}</code>\n`;
      if (approvedByName) {
        centralMsg += `✍️ <b>อนุมัติโดย:</b> ผู้อำนวยการ (${escapeHtml(approvedByName)})\n`;
      }
      centralMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
      centralMsg += `<i>ระบบได้บันทึกการอนุมัติและออกเลขที่คำสั่ง/PO ในระบบสารบรรณเรียบร้อยแล้วค่ะ 🌸</i>`;

      await sendTelegramNotification(centralMsg, 'central');

      // 3.2 แจ้งเตือนตรงถึงผู้ขอซื้อ/ขอจ้าง (Requester)
      if (caseData.requester_id) {
        const req = await this.getTeacherTelegramChatId(caseData.requester_id);
        if (req.chatId) {
          let reqMsg = `📬 <b>คำขอจัดซื้อจัดจ้างของท่านได้รับอนุมัติแล้วค่ะ</b>\n\n`;
          reqMsg += `• <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
          reqMsg += `• <b>วงเงิน:</b> ฿${amountFmt} บาท\n`;
          reqMsg += `• <b>ร้านค้า:</b> ${escapeHtml(vendorName)}\n`;
          reqMsg += `• <b>กำหนดส่งมอบ:</b> ${escapeHtml(dueDate)}\n\n`;
          reqMsg += `ขณะนี้เจ้าหน้าที่พัสดุกำลังดำเนินการประสานงานออกใบสั่งซื้อและติดตามพัสดุค่ะ 🙏`;
          await sendTelegramNotification(reqMsg, req.chatId);
        }
      }

      // 3.3 แจ้งเตือนตรงถึงคณะกรรมการตรวจรับพัสดุ (Inspectors)
      const committee = await this.getCommitteeDetails(caseData.committee_members || []);
      for (const m of committee) {
        if (m.chatId) {
          let comMsg = `📋 <b>แจ้งคำสั่งแต่งตั้งกรรมการตรวจรับพัสดุ (เฉพาะบุคคล)</b>\n`;
          comMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
          comMsg += `เรียนคุณครู <b>${escapeHtml(m.name)}</b> (${escapeHtml(m.role)})\n\n`;
          comMsg += `ท่านได้รับการแต่งตั้งตาม <b>${escapeHtml(orderNum)}</b>\n`;
          comMsg += `ให้เป็นผู้ตรวจรับพัสดุสำหรับงาน:\n`;
          comMsg += `• <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
          comMsg += `• <b>ผู้ส่งมอบ:</b> ${escapeHtml(vendorName)}\n`;
          comMsg += `• <b>กำหนดส่งมอบ:</b> ${escapeHtml(dueDate)}\n\n`;
          comMsg += `<i>เมื่อพัสดุมาส่งถึงโรงเรียน ระบบจะแจ้งเตือนให้ท่านเข้าตรวจรับอีกครั้งค่ะ 🌸</i>`;
          await sendTelegramNotification(comMsg, m.chatId);
        }
      }
    } catch (err) {
      console.error('[PROCUREMENT NOTIFY] Error notifyStakeholdersApproved:', err);
    }
  }

  /**
   * 4. แจ้งเตือนคณะกรรมการตรวจรับเมื่อ "พัสดุส่งมอบแล้ว" (Gate 4 Delivery Arrived)
   */
  static async notifyInspectorsDeliveryArrived(caseData: ProcurementCaseData): Promise<{ success: boolean; message: string }> {
    try {
      const vendorName = caseData.vendor_info?.name || 'ผู้ขาย/ผู้รับจ้าง';
      const actualDelivery = caseData.actual_delivery_date 
        ? new Date(caseData.actual_delivery_date).toLocaleDateString('th-TH') 
        : new Date().toLocaleDateString('th-TH');

      const committee = await this.getCommitteeDetails(caseData.committee_members || []);

      let sentCount = 0;
      for (const m of committee) {
        if (m.chatId) {
          let msg = `📦 <b>[แจ้งตรวจรับพัสดุ] สินค้าส่งมอบถึงโรงเรียนแล้ว</b>\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `เรียนคุณครู <b>${escapeHtml(m.name)}</b> (${escapeHtml(m.role)})\n\n`;
          msg += `• <b>สำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
          msg += `• <b>ชื่องาน:</b> ${escapeHtml(caseData.title)}\n`;
          msg += `• <b>ผู้ส่งมอบ:</b> ${escapeHtml(vendorName)}\n`;
          msg += `• <b>วันที่ส่งของ:</b> ${actualDelivery}\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `<i>ขอเชิญท่านร่วมดำเนินการตรวจนับ ตรวจสอบความถูกต้องตามใบสั่งซื้อ และลงนามในใบตรวจรับพัสดุในระบบ EPCM นะคะ 🌸</i>`;

          await sendTelegramNotification(msg, m.chatId);
          sentCount++;
        }
      }

      // หากไม่มีแชทส่วนบุคคล ให้แจ้งเข้ากลุ่มส่วนกลาง
      if (sentCount === 0) {
        let groupMsg = `📦 <b>[แจ้งตรวจรับพัสดุ] พัสดุส่งมอบถึงโรงเรียนแล้ว</b>\n`;
        groupMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
        groupMsg += `• <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
        groupMsg += `• <b>ผู้ส่งมอบ:</b> ${escapeHtml(vendorName)}\n`;
        groupMsg += `• <b>คณะกรรมการตรวจรับ:</b> ${committee.map(c => c.name).join(', ') || 'ผู้ตรวจรับพัสดุ'}\n`;
        groupMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
        groupMsg += `<i>ขอเชิญคณะกรรมการตรวจรับดำเนินการตรวจนับและลงนามตรวจรับในระบบค่ะ</i>`;
        await sendTelegramNotification(groupMsg, 'central');
      }

      return { success: true, message: `แจ้งเตือนคณะกรรมการตรวจรับแล้ว (${sentCount} ท่าน)` };
    } catch (err: any) {
      console.error('[PROCUREMENT NOTIFY] Error notifyInspectorsDeliveryArrived:', err);
      return { success: false, message: err.message };
    }
  }

  /**
   * 5. ส่งบรอดแคสต์แจ้งเตือนความคืบหน้าถึงทุกคนที่เกี่ยวข้องในสำนวน (Manual Trigger)
   */
  static async notifyAllStakeholdersCustom(caseData: ProcurementCaseData, note: string = ''): Promise<{ success: boolean; message: string }> {
    try {
      const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;
      const amountFmt = amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const gateNames = ['', 'ขั้น 1: ขอซื้อ/จ้าง', 'ขั้น 2: รายงานพัสดุ', 'ขั้น 3: สั่งซื้อ/สัญญา', 'ขั้น 4: ตรวจรับ', 'ขั้น 5: เบิกจ่ายเงิน', 'ขั้น 6: ทะเบียนคุม'];
      const currentGateName = gateNames[caseData.current_gate || 1] || `ขั้นตอนที่ ${caseData.current_gate}`;

      let msg = `📢 <b>[ความคืบหน้าสำนวนจัดซื้อจัดจ้าง]</b>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📂 <b>สำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
      msg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
      msg += `💰 <b>วงเงิน:</b> ฿${amountFmt} บาท\n`;
      msg += `📍 <b>สถานะปัจจุบัน:</b> ${escapeHtml(currentGateName)} (${escapeHtml(caseData.status || '-')})\n`;
      if (note) {
        msg += `💬 <b>หมายเหตุ:</b> ${escapeHtml(note)}\n`;
      }
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `<i>ติดตามรายละเอียดและพิมพ์เอกสารได้ในระบบ EPCM โรงเรียนค่ะ</i>`;

      await sendTelegramNotification(msg, 'proposal');
      return { success: true, message: 'ส่งแจ้งเตือนความคืบหน้าเรียบร้อยแล้ว' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
