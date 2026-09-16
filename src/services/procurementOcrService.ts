import { callGeminiAPI } from '../lib/aiService';
import { supabase } from '../lib/supabase';

export interface ExtractedProcurementDoc {
  vendor_name: string;
  tax_id: string;
  address: string;
  phone: string;
  receipt_no: string;
  receipt_date: string;
  total_amount: number;
  items: {
    item_name: string;
    quantity: number;
    unit: string;
    unit_price: number;
    total_price: number;
  }[];
}

/**
 * บริการสแกนเอกสารและ AI OCR สกัดข้อมูลใบเสร็จ/ใบเสนอราคา/ใบส่งของ
 * สำหรับระบบสำนวนจัดซื้อจัดจ้างอิเล็กทรอนิกส์โรงเรียน (Clean Architecture 2026)
 */
export class ProcurementOcrService {

  /**
   * ดึง API Key ของ Gemini จากตาราง settings
   */
  private static async getGeminiApiKey(): Promise<string> {
    try {
      const { data } = await supabase.from('settings').select('gemini_api_key').limit(1).maybeSingle();
      return data?.gemini_api_key || '';
    } catch {
      return '';
    }
  }

  /**
   * แปลง File เป็น Base64 String
   */
  private static fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const res = reader.result as string;
        const base64Data = res.split(',')[1] || res;
        resolve(base64Data);
      };
      reader.onerror = error => reject(error);
    });
  }

  /**
   * สแกนภาพใบเสร็จรับเงิน หรือใบเสนอราคา แล้วสกัดโครงสร้างข้อมูล JSON
   */
  static async parseReceiptOrQuotation(file: File): Promise<ExtractedProcurementDoc | null> {
    try {
      const apiKey = await this.getGeminiApiKey();
      if (!apiKey) {
        console.warn('Procurement OCR: No Gemini API key found in settings.');
        return null;
      }

      const base64 = await this.fileToBase64(file);
      const mimeType = file.type || 'image/jpeg';

      const prompt = `คุณคือระบบ AI OCR อัจฉริยะสำหรับงานพัสดุโรงเรียนไทย
จงอ่านภาพเอกสารนี้ (ซึ่งอาจเป็น ใบเสร็จรับเงิน, ใบกำกับภาษี, ใบเสนอราคา หรือ บิลเงินสด)
แล้วสกัดข้อมูลส่งกลับมาเป็นรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "vendor_name": "ชื่อร้านค้า หรือ บริษัท หรือ ผู้ขาย",
  "tax_id": "เลขประจำตัวผู้เสียภาษี 13 หลัก (ถ้ามี)",
  "address": "ที่อยู่ร้านค้า (ถ้ามี)",
  "phone": "เบอร์โทรศัพท์ (ถ้ามี)",
  "receipt_no": "เลขที่ใบเสร็จ หรือ เล่มที่/เลขที่ หรือ เลขที่ใบเสนอราคา",
  "receipt_date": "วันที่ในเอกสาร รูปแบบ YYYY-MM-DD (เช่น 2569-02-15 แปลงเป็น ค.ศ. เช่น 2026-02-15)",
  "total_amount": 0.00,
  "items": [
    {
      "item_name": "ชื่อรายการสินค้าหรือบริการ",
      "quantity": 1,
      "unit": "หน่วยนับ เช่น เล่ม, กล่อง, รายการ",
      "unit_price": 0.00,
      "total_price": 0.00
    }
  ]
}
ตอบเฉพาะ JSON เท่านั้น ไม่ต้องมีคำอธิบายเพิ่มเติม`;

      // ยิงตรงไปที่ Gemini Vision API
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.split(',')[0].trim()}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        console.error('OCR fetch failed:', resp.status, await resp.text());
        return null;
      }

      const json = await resp.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;

      const parsed: ExtractedProcurementDoc = JSON.parse(rawText);
      return parsed;
    } catch (err) {
      console.error('Error in parseReceiptOrQuotation:', err);
      return null;
    }
  }

  /**
   * อัปโหลดไฟล์สแกนขึ้น Supabase Storage และคืนค่า Public URL
   */
  static async uploadScanAttachment(file: File, caseId: string): Promise<string | null> {
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const cleanName = `${caseId}_${Date.now()}.${ext}`;
      const filePath = `procurement_scans/${cleanName}`;

      const { data, error } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { upsert: true });

      if (error) {
        console.error('Storage upload error:', error);
        return null;
      }

      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      return publicUrlData?.publicUrl || null;
    } catch (e) {
      console.error('Failed to upload scan attachment:', e);
      return null;
    }
  }
}
