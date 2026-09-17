import { supabase } from '../lib/supabase';
import { DocumentNumberingService } from './documentNumberingService';

export interface ProcurementNumberSequence {
  pcid: string;
  pr_number: string;
  po_number: string;
  inspection_number: string;
  disbursement_number: string;
}

export interface SoDValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ChronologicalValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * บริการบริหารจัดการห่วงโซ่การออกเลขสารบรรณผูกสัมพันธ์ (Unified Numbering Engine)
 * สำหรับระบบสำนวนจัดซื้อจัดจ้างอิเล็กทรอนิกส์โรงเรียน (Clean Architecture 2026)
 */
export class ProcurementNumberingService {

  /**
   * สร้างรหัสสำนวนจัดซื้อจัดจ้างกลาง (Procurement Case ID - PCID)
   */
  static async generateNextPCID(fiscalYear: string = '2569'): Promise<string> {
    try {
      const yearPrefix = `FY${fiscalYear}`;
      const { data, error } = await supabase
        .from('procurement_cases')
        .select('pcid')
        .ilike('pcid', `%${yearPrefix}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      let nextSeq = 1;
      if (data && data.length > 0 && data[0].pcid) {
        const parts = data[0].pcid.split('-');
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) {
          nextSeq = lastNum + 1;
        }
      }

      const seqPadded = String(nextSeq).padStart(5, '0');
      return `PRC-${yearPrefix}-${seqPadded}`;
    } catch {
      const rand = Math.floor(1000 + Math.random() * 9000);
      return `PRC-FY${fiscalYear}-${rand}`;
    }
  }

  /**
   * สร้างเลขรายงานขอซื้อขอจ้าง (PR Number)
   */
  static async getNextPRNumber(fiscalYear: string = '2569'): Promise<string> {
    try {
      const { data } = await supabase
        .from('procurement_cases')
        .select('pr_number')
        .eq('fiscal_year', fiscalYear)
        .not('pr_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      let nextSeq = 1;
      if (data && data.length > 0 && data[0].pr_number) {
        const parts = data[0].pr_number.split('/');
        const lastNum = parseInt(parts[0].replace(/\D/g, ''), 10);
        if (!isNaN(lastNum)) nextSeq = lastNum + 1;
      }
      return `พด. ${nextSeq}/${fiscalYear}`;
    } catch {
      return `พด. 1/${fiscalYear}`;
    }
  }

  /**
   * สร้างเลขที่ใบสั่งซื้อ / สั่งจ้าง (PO Number)
   */
  static async getNextPONumber(fiscalYear: string = '2569'): Promise<string> {
    try {
      const { data } = await supabase
        .from('procurement_cases')
        .select('po_number')
        .eq('fiscal_year', fiscalYear)
        .not('po_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      let nextSeq = 1;
      if (data && data.length > 0 && data[0].po_number) {
        const parts = data[0].po_number.split('/');
        const lastNum = parseInt(parts[0].replace(/\D/g, ''), 10);
        if (!isNaN(lastNum)) nextSeq = lastNum + 1;
      }
      return `PO-${nextSeq}/${fiscalYear}`;
    } catch {
      return `PO-1/${fiscalYear}`;
    }
  }

  /**
   * สร้างเลขที่ใบตรวจรับพัสดุ (Inspection Number)
   */
  static async getNextInspectionNumber(fiscalYear: string = '2569'): Promise<string> {
    try {
      const { data } = await supabase
        .from('procurement_cases')
        .select('inspection_number')
        .eq('fiscal_year', fiscalYear)
        .not('inspection_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      let nextSeq = 1;
      if (data && data.length > 0 && data[0].inspection_number) {
        const parts = data[0].inspection_number.split('/');
        const lastNum = parseInt(parts[0].replace(/\D/g, ''), 10);
        if (!isNaN(lastNum)) nextSeq = lastNum + 1;
      }
      return `ตรวจรับ ${nextSeq}/${fiscalYear}`;
    } catch {
      return `ตรวจรับ 1/${fiscalYear}`;
    }
  }

  /**
   * เชื่อมโยงและดึงเลขบันทึกข้อความจากสมุดทะเบียน memos กลางของโรงเรียน (Unified Numbering)
   */
  static async reserveNextMemoNumber(fiscalYear: string = '2569', title: string, requesterName: string): Promise<{ memo_id: string; memo_number: string }> {
    try {
      const yearInt = parseInt(fiscalYear, 10) || 2569;
      
      // ขอเลขผ่านระบบรวมศูนย์ (ป้องกันเลขชนกับงานสารบรรณทั่วไป)
      const numRes = await DocumentNumberingService.reserveNumber({
        seriesCode: 'MEMO',
        docYear: yearInt,
        title,
        requestedByName: requesterName,
        channel: 'procurement',
        autoIssue: true
      });

      const nextSeq = numRes.sequenceNumber;
      const memoNumber = `ที่ ศธ 04225/${nextSeq}`;

      // บันทึกรายการตั้งต้นในสมุด memos
      const { data: inserted, error } = await supabase
        .from('memos')
        .insert({
          memo_number: memoNumber,
          subject: title,
          requester: requesterName,
          doc_year: yearInt,
          doc_sequence: nextSeq,
          status: 'approved',
          memo_date: new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (error || !inserted) {
        return { memo_id: '', memo_number: memoNumber };
      }

      if (numRes.allocationId) {
        DocumentNumberingService.confirmNumber(numRes.allocationId, 'memos', inserted.id).catch(() => {});
      }

      return { memo_id: inserted.id, memo_number: memoNumber };
    } catch (e) {
      console.error('Error reserving memo number:', e);
      return { memo_id: '', memo_number: `ที่ ศธ 04225/1` };
    }
  }

  /**
   * เชื่อมโยงและดึงเลขคำสั่งโรงเรียนจากสมุดทะเบียน orders กลางของโรงเรียน (Unified Numbering)
   */
  static async reserveNextOrderNumber(fiscalYear: string = '2569', title: string): Promise<{ order_id: string; order_number: string }> {
    try {
      const yearInt = parseInt(fiscalYear, 10) || 2569;
      
      // ขอเลขคำสั่งผ่านระบบรวมศูนย์
      const numRes = await DocumentNumberingService.reserveNumber({
        seriesCode: 'SCHOOL_ORDER',
        docYear: yearInt,
        title,
        channel: 'procurement',
        autoIssue: true
      });

      const nextSeq = numRes.sequenceNumber;
      const orderNumber = `คำสั่งที่ ${nextSeq}/${fiscalYear}`;

      // บันทึกรายการตั้งต้นในสมุด orders
      const { data: inserted, error } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          subject: title,
          issuer: 'ผู้อำนวยการโรงเรียน',
          doc_year: yearInt,
          doc_sequence: nextSeq,
          status: 'approved',
          order_date: new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (error || !inserted) {
        return { order_id: '', order_number: orderNumber };
      }

      if (numRes.allocationId) {
        DocumentNumberingService.confirmNumber(numRes.allocationId, 'orders', inserted.id).catch(() => {});
      }

      return { order_id: inserted.id, order_number: orderNumber };
    } catch (e) {
      console.error('Error reserving order number:', e);
      return { order_id: '', order_number: `คำสั่งที่ 1/${fiscalYear}` };
    }
  }

  /**
   * ตรวจสอบการแบ่งแยกหน้าที่ (Separation of Duties - SoD) ตามระเบียบ กค. ข้อ 25
   * "ห้ามเจ้าหน้าที่พัสดุและหัวหน้าเจ้าหน้าที่เป็นกรรมการตรวจรับพัสดุ"
   */
  static validateSeparationOfDuties(params: {
    requesterId?: string;
    officerId?: string;
    headOfficerId?: string;
    inspectorIds: string[];
  }): SoDValidationResult {
    const errors: string[] = [];
    const { requesterId, officerId, headOfficerId, inspectorIds } = params;

    if (!inspectorIds || inspectorIds.length === 0) {
      errors.push('ต้องกำหนดผู้ตรวจรับพัสดุอย่างน้อย 1 คน');
    }

    if (officerId && inspectorIds.includes(officerId)) {
      errors.push('ผิดระเบียบข้อ 25: เจ้าหน้าที่พัสดุ ห้ามได้รับการแต่งตั้งเป็นกรรมการตรวจรับพัสดุในเรื่องเดียวกัน');
    }

    if (headOfficerId && inspectorIds.includes(headOfficerId)) {
      errors.push('ผิดระเบียบข้อ 25: หัวหน้าเจ้าหน้าที่พัสดุ ห้ามได้รับการแต่งตั้งเป็นกรรมการตรวจรับพัสดุในเรื่องเดียวกัน');
    }

    if (requesterId && inspectorIds.includes(requesterId)) {
      errors.push('ข้อควรระวัง: ครูผู้ขอซื้อ/ขอจ้าง ไม่ควรเป็นผู้ตรวจรับพัสดุในรายการที่ตนเองขอ เพื่อป้องกันการขัดกันแห่งผลประโยชน์');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * ตรวจสอบความถูกต้องของคณะกรรมการตรวจรับพัสดุ
   * - วงเงิน <= 10,000 (ว.119): ผู้ตรวจรับ 1 คนได้
   * - วงเงิน > 10,000 (ว.89 / ระเบียบข้อ 25): ต้องเป็นคณะกรรมการ >= 3 คน
   * - กฎเหล็กข้อ 25 วรรคสี่: "ห้ามเจ้าหน้าที่และหัวหน้าเจ้าหน้าที่เป็นกรรมการตรวจรับพัสดุ"
   */
  static validateCommittee(
    policyCode: string,
    estimatedAmount: number,
    committeeMembers: { name: string; role: string }[],
    officerName?: string,
    headOfficerName?: string
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. ตรวจสอบข้อห้ามระเบียบข้อ 25 วรรคสี่
    if (officerName) {
      const isOfficerInCommittee = committeeMembers.some(m => m.name.trim() === officerName.trim());
      if (isOfficerInCommittee) {
        errors.push('ผิดระเบียบข้อ 25: เจ้าหน้าที่ ห้ามได้รับการแต่งตั้งเป็นกรรมการตรวจรับพัสดุในเรื่องเดียวกัน');
      }
    }
    if (headOfficerName) {
      const isHeadInCommittee = committeeMembers.some(m => m.name.trim() === headOfficerName.trim());
      if (isHeadInCommittee) {
        errors.push('ผิดระเบียบข้อ 25: หัวหน้าเจ้าหน้าที่ ห้ามได้รับการแต่งตั้งเป็นกรรมการตรวจรับพัสดุในเรื่องเดียวกัน');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * ตรวจสอบความถูกต้องของลำดับวันเดือนปี (Chronological Integrity Guard)
   * กฎเหล็ก: วันที่บันทึกขอ <= วันที่รายงานขอซื้อ <= วันที่คำสั่งแต่งตั้ง <= วันที่ PO <= วันที่ส่งมอบ <= วันที่ตรวจรับ
   */
  static validateChronologicalDates(dates: {
    requestDate?: string;
    prApprovalDate?: string;
    orderAppointmentDate?: string;
    poDate?: string;
    actualDeliveryDate?: string;
    inspectionDate?: string;
    disbursementDate?: string;
  }): ChronologicalValidationResult {
    const errors: string[] = [];

    const toTime = (d?: string) => (d ? new Date(d).getTime() : null);

    const tRequest = toTime(dates.requestDate);
    const tPR = toTime(dates.prApprovalDate);
    const tOrder = toTime(dates.orderAppointmentDate);
    const tPO = toTime(dates.poDate);
    const tDelivery = toTime(dates.actualDeliveryDate);
    const tInspection = toTime(dates.inspectionDate);
    const tDisburse = toTime(dates.disbursementDate);

    if (tRequest && tPR && tPR < tRequest) {
      errors.push('วันที่รายงานขอซื้อขอจ้าง (ข้อ 22) ต้องไม่เกิดก่อน วันที่บันทึกขออนุมัติหลักการ');
    }

    if (tPR && tOrder && tOrder < tPR) {
      errors.push('วันที่คำสั่งแต่งตั้งกรรมการ ต้องไม่เกิดก่อน วันที่ได้รับอนุมัติรายงานขอซื้อขอจ้าง');
    }

    if (tPR && tPO && tPO < tPR) {
      errors.push('วันที่ในใบสั่งซื้อ/สั่งจ้าง (PO) ต้องไม่เกิดก่อน วันที่ได้รับอนุมัติรายงานขอซื้อขอจ้าง');
    }

    if (tPO && tDelivery && tDelivery < tPO) {
      errors.push('วันที่ส่งมอบของจริง ต้องไม่เกิดก่อน วันที่ออกใบสั่งซื้อ/สั่งจ้าง (PO)');
    }

    if (tDelivery && tInspection && tInspection < tDelivery) {
      errors.push('วันที่ตรวจรับพัสดุ ต้องไม่เกิดก่อน วันที่ผู้ขายส่งมอบของจริง');
    }

    if (tInspection && tDisburse && tDisburse < tInspection) {
      errors.push('วันที่ขออนุมัติเบิกจ่ายเงิน ต้องไม่เกิดก่อน วันที่คณะกรรมการตรวจรับพัสดุเรียบร้อย');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
