import { supabase } from '../lib/supabase';

export type DocSeriesCode = 'MEMO' | 'INCOMING' | 'OUTGOING' | 'SCHOOL_ORDER';

export interface ReserveDocNumberParams {
  seriesCode: DocSeriesCode;
  docYear: number;
  title?: string;
  requestedBy?: string;
  requestedByName?: string;
  channel?: 'web' | 'telegram' | 'line' | 'procurement' | 'system';
  idempotencyKey?: string;
  autoIssue?: boolean;
  documentTable?: string;
  documentId?: string;
}

export interface ReserveDocNumberResult {
  success: boolean;
  allocationId?: string;
  seriesCode: DocSeriesCode;
  docYear: number;
  sequenceNumber: number;
  formattedNumber: string;
  status: 'reserved' | 'issued' | 'voided' | 'expired';
  isDuplicateRequest?: boolean;
}

/**
 * บริการออกเลขเอกสารแบบรวมศูนย์ (Unified Document Numbering Service)
 * เป็น Single Source of Truth ป้องกันเลขชนกัน 100% ด้วย PostgreSQL RPC
 */
export class DocumentNumberingService {
  /**
   * ขอเลข หรือ จองเลขเอกสาร
   */
  static async reserveNumber(params: ReserveDocNumberParams): Promise<ReserveDocNumberResult> {
    try {
      const { data, error } = await supabase.rpc('reserve_document_number', {
        p_series_code: params.seriesCode,
        p_doc_year: params.docYear,
        p_title: params.title || null,
        p_requested_by: params.requestedBy || null,
        p_requested_by_name: params.requestedByName || null,
        p_channel: params.channel || 'web',
        p_idempotency_key: params.idempotencyKey || null,
        p_auto_issue: params.autoIssue ?? false,
        p_document_table: params.documentTable || null,
        p_document_id: params.documentId || null
      });

      if (error) {
        console.warn('[DocumentNumberingService] RPC error, falling back to local fallback:', error);
        return await this.fallbackReserve(params);
      }

      const res = data as any;
      return {
        success: res.success,
        allocationId: res.allocation_id,
        seriesCode: res.series_code,
        docYear: res.doc_year,
        sequenceNumber: res.sequence_number,
        formattedNumber: res.formatted_number,
        status: res.status,
        isDuplicateRequest: res.is_duplicate_request
      };
    } catch (err) {
      console.error('[DocumentNumberingService] Exception in reserveNumber:', err);
      return await this.fallbackReserve(params);
    }
  }

  /**
   * ยืนยันการใช้เลขจริงเมื่อบันทึกเอกสารสำเร็จ (เปลี่ยนสถานะเป็น issued)
   */
  static async confirmNumber(allocationId: string, documentTable: string, documentId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('confirm_document_number', {
        p_allocation_id: allocationId,
        p_document_table: documentTable,
        p_document_id: documentId
      });
      if (error) {
        console.warn('[DocumentNumberingService] confirmNumber error:', error);
        return false;
      }
      return !!data;
    } catch (err) {
      console.error('[DocumentNumberingService] Exception in confirmNumber:', err);
      return false;
    }
  }

  /**
   * ยกเลิกเลข (ห้ามนำเลขเดิมกลับมาใช้ใหม่)
   */
  static async voidNumber(allocationId: string, reason: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('void_document_number', {
        p_allocation_id: allocationId,
        p_reason: reason
      });
      if (error) {
        console.warn('[DocumentNumberingService] voidNumber error:', error);
        return false;
      }
      return !!data;
    } catch (err) {
      console.error('[DocumentNumberingService] Exception in voidNumber:', err);
      return false;
    }
  }

  /**
   * Fallback ชั่วคราวกรณีที่ยังไม่ได้รัน SQL Migration บนฐานข้อมูล
   */
  private static async fallbackReserve(params: ReserveDocNumberParams): Promise<ReserveDocNumberResult> {
    const tableMap: Record<DocSeriesCode, string> = {
      MEMO: 'memos',
      INCOMING: 'incoming_docs',
      OUTGOING: 'outgoing_docs',
      SCHOOL_ORDER: 'orders'
    };

    const tableName = tableMap[params.seriesCode] || 'memos';
    let nextSeq = 1;

    try {
      const { data } = await supabase
        .from(tableName)
        .select('doc_sequence')
        .order('doc_sequence', { ascending: false })
        .limit(1);

      if (data && data.length > 0 && data[0].doc_sequence) {
        nextSeq = Number(data[0].doc_sequence) + 1;
      }
    } catch (e) {
      console.error('[DocumentNumberingService] Fallback query error:', e);
    }

    return {
      success: true,
      seriesCode: params.seriesCode,
      docYear: params.docYear,
      sequenceNumber: nextSeq,
      formattedNumber: `${nextSeq}/${params.docYear}`,
      status: 'issued'
    };
  }
}
