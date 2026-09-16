import garuda15mm from '../assets/saraban/garuda-1.5cm.png';
import garuda3cm from '../assets/saraban/garuda-3cm.png';

export interface ProcurementDocData {
  school_name: string;
  department: string;
  pcid: string;
  title: string;
  policy_code: string;
  memo_number: string;
  request_date: string;
  pr_number: string;
  pr_date: string;
  order_number: string;
  order_date: string;
  po_number: string;
  po_date: string;
  delivery_due_date: string;
  actual_delivery_date: string;
  inspection_number: string;
  inspection_date: string;
  disbursement_date: string;
  estimated_amount: number;
  final_amount: number;
  requester_name: string;
  requester_position: string;
  officer_name: string;
  officer_position: string;
  head_officer_name: string;
  head_officer_position: string;
  director_name: string;
  director_position: string;
  director_signature_url?: string;
  school_stamp_url?: string;
  vendor_info: {
    name: string;
    tax_id: string;
    address: string;
    phone: string;
    bank_name?: string;
    bank_account?: string;
    receipt_no?: string;
    receipt_date?: string;
  };
  committee_members: {
    teacher_id?: string;
    name: string;
    role: string;
    position?: string;
  }[];
  items: {
    item_name: string;
    specification?: string;
    quantity: number;
    unit: string;
    unit_price: number;
    total_price: number;
  }[];
  custom_clauses?: string;
  director_opinion?: string;
  include_signatures?: boolean;
}

/**
 * ฟังก์ชันแปลงตัวเลขจำนวนเงินเป็นภาษาไทย (Thai Baht Text)
 */
export function thaiBahtText(num: number): string {
  if (isNaN(num) || num === 0) return 'ศูนย์บาทถ้วน';
  const numStr = num.toFixed(2);
  const [bahtStr, satangStr] = numStr.split('.');

  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertGroup(nStr: string): string {
    let result = '';
    const len = nStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(nStr[i], 10);
      const unit = units[len - i - 1];
      if (digit !== 0) {
        if (len - i === 1 && digit === 1 && len > 1 && nStr[len - 2] !== '0') {
          result += 'เอ็ด';
        } else if (len - i === 2 && digit === 2) {
          result += 'ยี่' + unit;
        } else if (len - i === 2 && digit === 1) {
          result += 'สิบ';
        } else {
          result += digits[digit] + unit;
        }
      }
    }
    return result;
  }

  let bahtText = '';
  if (bahtStr.length > 6) {
    const milPart = bahtStr.slice(0, -6);
    const restPart = bahtStr.slice(-6);
    bahtText = convertGroup(milPart) + 'ล้าน' + convertGroup(restPart);
  } else {
    bahtText = convertGroup(bahtStr);
  }

  let satangText = '';
  const satangVal = parseInt(satangStr, 10);
  if (satangVal > 0) {
    satangText = convertGroup(satangStr) + 'สตางค์';
  } else {
    satangText = 'ถ้วน';
  }

  return (bahtText ? bahtText + 'บาท' : '') + satangText;
}

/**
 * รูปแบบวันที่ไทยแบบทางการ (เช่น ๑๖ กันยายน ๒๕๖๙ หรือ 16 กันยายน 2569)
 */
export function formatThaiDate(dateStr?: string): string {
  if (!dateStr) return '........................................';
  try {
    const d = new Date(dateStr);
    const day = d.getDate();
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const month = months[d.getMonth()];
    const year = d.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * เครื่องกำเนิดเอกสารราชการชุดสมบูรณ์ (Procurement Document Generator)
 * สร้างแบบฟอร์มตามระเบียบสารบรรณและมาตรฐาน สพป.พัทลุง เขต 2 เป๊ะ 100%
 */
export class ProcurementDocGenerator {

  /**
   * สไตล์ CSS ราชการสำหรับงานพิมพ์ A4
   */
  private static getOfficialCss(): string {
    return `
      @page {
        size: A4;
        margin: 2.5cm 2cm 2cm 3cm;
      }
      * {
        box-sizing: border-box;
      }
      body {
        font-family: 'THSarabunIT๙', 'TH Sarabun New', 'TH SarabunPSK', 'Sarabun', sans-serif;
        font-size: 16pt;
        line-height: 1.25;
        color: #000;
        margin: 0;
        padding: 0;
        background: #fff;
      }
      .page {
        page-break-after: always;
        position: relative;
        min-height: 25cm;
      }
      .page:last-child {
        page-break-after: avoid;
      }
      .no-print-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 50px;
        background: #1e293b;
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        z-index: 9999;
      }
      .print-btn {
        background: #22c55e;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
        font-size: 14px;
      }
      .memo-header {
        position: relative;
        height: 1.8cm;
        display: flex;
        align-items: center;
        justify-content: center;
        border-bottom: 2px solid #000;
        margin-bottom: 8px;
      }
      .garuda-15 {
        position: absolute;
        left: 0;
        bottom: 5px;
        width: 1.5cm;
        height: auto;
      }
      .garuda-30 {
        display: block;
        margin: 0 auto 10px auto;
        width: 3cm;
        height: auto;
      }
      .header-title {
        font-size: 29pt;
        font-weight: bold;
      }
      .order-title {
        text-align: center;
        font-size: 18pt;
        font-weight: bold;
        margin-bottom: 15px;
      }
      .info-row {
        display: flex;
        margin-bottom: 4px;
      }
      .info-label {
        font-weight: bold;
        margin-right: 8px;
      }
      .content-p {
        text-indent: 2.5cm;
        text-align: justify;
        margin: 6px 0;
      }
      table.doc-table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0;
        font-size: 15pt;
      }
      table.doc-table th, table.doc-table td {
        border: 1px solid #000;
        padding: 4px 6px;
        vertical-align: top;
      }
      table.doc-table th {
        background: #f1f5f9;
        font-weight: bold;
        text-align: center;
      }
      .sig-section {
        margin-top: 20px;
        display: flex;
        justify-content: flex-end;
        page-break-inside: avoid;
      }
      .sig-box {
        width: 9.5cm;
        text-align: center;
        position: relative;
      }
      .sig-img {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        top: -20px;
        width: 3.5cm;
        height: 1.2cm;
        object-fit: contain;
        pointer-events: none;
      }
      .stamp-img {
        position: absolute;
        right: 10px;
        top: -15px;
        width: 2.5cm;
        height: 2.5cm;
        opacity: 0.85;
        pointer-events: none;
      }
      @media print {
        .no-print-bar {
          display: none !important;
        }
        body {
          margin: 0;
        }
      }
    `;
  }

  /**
   * 1. บันทึกข้อความขออนุมัติซื้อ/จ้าง (สำหรับครูผู้ขอเสนอ ผอ.)
   */
  static renderRequestMemo(data: ProcurementDocData): string {
    const totalText = thaiBahtText(data.estimated_amount);
    return `
      <div class="page">
        <div class="memo-header">
          <img src="${garuda15mm}" class="garuda-15" />
          <div class="header-title">บันทึกข้อความ</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ส่วนราชการ</span> ${data.school_name} (${data.department})</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ที่</span> ${data.memo_number || '...............'}</div>
          <div style="width: 7cm;"><span class="info-label">วันที่</span> ${formatThaiDate(data.request_date)}</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">เรื่อง</span> ขออนุมัติจัดซื้อจัดจ้าง: ${data.title}</div>
        </div>
        <div style="margin-top: 10px;">
          <span class="info-label">เรียน</span> ผู้อำนวยการ${data.school_name}
        </div>
        <div class="content-p">
          ด้วยข้าพเจ้า ${data.requester_name} ตำแหน่ง ${data.requester_position} มีความประสงค์จะขออนุมัติจัดซื้อจัดจ้าง รายการ <b>${data.title}</b> เพื่อใช้ในการจัดการเรียนการสอนและการบริหารงานของโรงเรียนให้เกิดประสิทธิภาพสูงสุด โดยมีรายละเอียดตามรายการดังต่อไปนี้
        </div>

        <table class="doc-table">
          <thead>
            <tr>
              <th style="width: 8%;">ลำดับ</th>
              <th>รายการ / คุณลักษณะเฉพาะ</th>
              <th style="width: 12%;">จำนวน</th>
              <th style="width: 12%;">หน่วย</th>
              <th style="width: 16%;">ราคาต่อหน่วย</th>
              <th style="width: 18%;">จำนวนเงิน (บาท)</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map((it, idx) => `
              <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td>${it.item_name} ${it.specification ? `<br/><small style="color: #444;">${it.specification}</small>` : ''}</td>
                <td style="text-align: center;">${it.quantity}</td>
                <td style="text-align: center;">${it.unit}</td>
                <td style="text-align: right;">${Number(it.unit_price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right;">${Number(it.total_price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
            <tr>
              <td colspan="5" style="text-align: center; font-weight: bold;">รวมเป็นเงินทั้งสิ้น (${totalText})</td>
              <td style="text-align: right; font-weight: bold;">${Number(data.estimated_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div class="content-p">
          ในการนี้ ขอเสนอแต่งตั้งผู้ตรวจรับพัสดุ ได้แก่:
          ${data.committee_members.map(m => `<b>${m.name}</b> (${m.role})`).join(', ')}
        </div>

        <div class="content-p">
          จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติหลักการ
        </div>

        <div class="sig-section">
          <div class="sig-box">
            (ลงชื่อ)......................................................<br/>
            ( ${data.requester_name} )<br/>
            ตำแหน่ง ${data.requester_position}
          </div>
        </div>

        <div style="margin-top: 25px; border-top: 1px dashed #666; padding-top: 10px;">
          <div style="font-weight: bold;">คำสั่ง / การสั่งการผู้อำนวยการ:</div>
          <div style="margin-top: 5px;">
            [ &nbsp; ] อนุมัติ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; [ &nbsp; ] มอบเจ้าหน้าที่ดำเนินการตามระเบียบต่อไป
          </div>
          <div class="sig-section" style="margin-top: 15px;">
            <div class="sig-box">
              ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
              (ลงชื่อ)......................................................<br/>
              ( ${data.director_name} )<br/>
              ผู้อำนวยการ${data.school_name}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 2. รายงานขอซื้อขอจ้าง ตามระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 22
   */
  static renderReportClause22(data: ProcurementDocData): string {
    const totalText = thaiBahtText(data.final_amount || data.estimated_amount);
    return `
      <div class="page">
        <div class="memo-header">
          <img src="${garuda15mm}" class="garuda-15" />
          <div class="header-title">บันทึกข้อความ</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ส่วนราชการ</span> งานพัสดุ ${data.school_name}</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ที่</span> ${data.pr_number || '...............'}</div>
          <div style="width: 7cm;"><span class="info-label">วันที่</span> ${formatThaiDate(data.pr_date)}</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">เรื่อง</span> รายงานขอซื้อขอจ้าง: ${data.title}</div>
        </div>
        <div style="margin-top: 10px;">
          <span class="info-label">เรียน</span> ผู้อำนวยการ${data.school_name}
        </div>
        <div class="content-p">
          ด้วย งานพัสดุ ${data.school_name} มีความประสงค์จะดำเนินการจัดซื้อจัดจ้าง รายการ <b>${data.title}</b> ตามที่ได้รับอนุมัติหลักการไว้แล้วนั้น เจ้าหน้าที่ได้ตรวจสอบความพร้อมแล้ว จึงขอรายงานขอซื้อขอจ้างตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ข้อ 22 ดังนี้:
        </div>

        <div style="margin-left: 1cm; line-height: 1.5;">
          1. <b>เหตุผลและความจำเป็น</b>: เพื่อใช้ในกิจกรรมการเรียนรู้และการดำเนินงานของสถานศึกษา<br/>
          2. <b>รายละเอียดพัสดุ</b>: ตามรายการแนบท้ายจำนวน ${data.items.length} รายการ<br/>
          3. <b>ราคากลางและวงเงินงบประมาณ</b>: เป็นเงิน ${Number(data.final_amount || data.estimated_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (${totalText})<br/>
          4. <b>กำหนดเวลาส่งมอบ</b>: กำหนดส่งมอบภายใน ${formatThaiDate(data.delivery_due_date)} หรือภายใน 15 วันทำการ<br/>
          5. <b>วิธีที่จะจัดซื้อจัดจ้าง</b>: ดำเนินการโดยวิธีเฉพาะเจาะจง ตาม พ.ร.บ. จัดซื้อจัดจ้าง พ.ศ. 2560 มาตรา 56 (2) (ข)<br/>
          6. <b>คณะกรรมการตรวจรับพัสดุ</b>: ขอเสนอแต่งตั้งผู้ตรวจรับพัสดุดังนี้:
          <ul style="margin: 4px 0 8px 1cm; padding: 0;">
            ${data.committee_members.map(m => `<li>${m.name} ตำแหน่ง ${m.position || 'ครู'} ทำหน้าที่ ${m.role}</li>`).join('')}
          </ul>
        </div>

        <div class="content-p">
          จึงเรียนมาเพื่อโปรดพิจารณาให้ความเห็นชอบรายงานขอซื้อขอจ้างดังกล่าว และอนุมัติให้แต่งตั้งคณะกรรมการตรวจรับพัสดุ
        </div>

        <div class="sig-section">
          <div class="sig-box">
            (ลงชื่อ)...................................................... เจ้าหน้าที่<br/>
            ( ${data.officer_name} )
          </div>
        </div>

        <div style="margin-top: 15px; display: flex; justify-content: space-between;">
          <div class="sig-box" style="width: 8cm; text-align: left;">
            <b>ความเห็นหัวหน้าเจ้าหน้าที่:</b><br/>
            เห็นชอบตามที่เสนอ<br/><br/>
            (ลงชื่อ)......................................................<br/>
            ( ${data.head_officer_name} )<br/>
            หัวหน้าเจ้าหน้าที่
          </div>
          <div class="sig-box" style="width: 8cm; text-align: left;">
            <b>คำสั่งผู้อำนวยการ:</b><br/>
            เห็นชอบและอนุมัติตามเสนอ<br/><br/>
            ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
            (ลงชื่อ)......................................................<br/>
            ( ${data.director_name} )<br/>
            ผู้อำนวยการ${data.school_name}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 3. คำสั่งแต่งตั้งคณะกรรมการตรวจรับพัสดุ
   */
  static renderAppointmentOrder(data: ProcurementDocData): string {
    return `
      <div class="page">
        <img src="${garuda3cm}" class="garuda-30" />
        <div class="order-title">
          คำสั่ง${data.school_name}<br/>
          ${data.order_number || 'ที่ .....................'}<br/>
          เรื่อง แต่งตั้งคณะกรรมการตรวจรับพัสดุ สำหรับการจัดซื้อจัดจ้าง: ${data.title}
        </div>

        <div class="content-p">
          ด้วย ${data.school_name} จะดำเนินการจัดซื้อจัดจ้าง รายการ <b>${data.title}</b> โดยวิธีเฉพาะเจาะจง ตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560
        </div>
        <div class="content-p">
          เพื่อให้การตรวจรับพัสดุเป็นไปด้วยความเรียบร้อย ถูกต้องตามระเบียบของทางราชการ อาศัยอำนาจตามคำสั่งสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน เรื่อง มอบอำนาจการจัดซื้อจัดจ้างและการบริหารพัสดุ จึงแต่งตั้งผู้มีรายนามต่อไปนี้เป็น <b>คณะกรรมการตรวจรับพัสดุ</b>:
        </div>

        <div style="margin-left: 2.5cm; margin-top: 10px; line-height: 1.6;">
          ${data.committee_members.map((m, idx) => `
            ${idx + 1}. ${m.name} &nbsp; &nbsp; ตำแหน่ง ${m.position || 'ครู'} &nbsp; &nbsp; ปฏิบัติหน้าที่ ${m.role}<br/>
          `).join('')}
        </div>

        <div class="content-p" style="margin-top: 15px;">
          ให้คณะกรรมการที่ได้รับการแต่งตั้ง ปฏิบัติหน้าที่ตรวจรับพัสดุให้ถูกต้อง ครบถ้วนตามรูปแบบรายการ คุณลักษณะเฉพาะ และสัญญาหรือข้อตกลง โดยเคร่งครัดตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ทุกประการ
        </div>

        <div style="margin-top: 25px; text-align: center;">
          สั่ง ณ วันที่ ${formatThaiDate(data.order_date)}
        </div>

        <div class="sig-section" style="margin-top: 25px;">
          <div class="sig-box">
            ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
            (ลงชื่อ)......................................................<br/>
            ( ${data.director_name} )<br/>
            ผู้อำนวยการ${data.school_name}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 4. ใบสั่งซื้อ / ใบสั่งจ้าง (Purchase Order - PO)
   */
  static renderPO(data: ProcurementDocData): string {
    const totalText = thaiBahtText(data.final_amount || data.estimated_amount);
    return `
      <div class="page">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px;">
          <div style="display: flex; align-items: center;">
            <img src="${garuda15mm}" style="width: 1.5cm; margin-right: 15px;" />
            <div>
              <div style="font-size: 20pt; font-weight: bold;">ใบสั่งซื้อ / ใบสั่งจ้าง</div>
              <div style="font-size: 14pt;">${data.school_name}</div>
            </div>
          </div>
          <div style="text-align: right; font-size: 14pt;">
            <b>เลขที่ใบสั่งซื้อ:</b> ${data.po_number || 'PO-.........'}<br/>
            <b>วันที่:</b> ${formatThaiDate(data.po_date)}<br/>
            <b>รหัสสำนวน:</b> ${data.pcid}
          </div>
        </div>

        <div style="display: flex; margin-top: 12px; border: 1px solid #000; padding: 8px;">
          <div style="flex: 1;">
            <b>ผู้สั่งซื้อ:</b> ${data.school_name}<br/>
            <b>ที่อยู่:</b> สำนักงานเขตพื้นที่การศึกษาประถมศึกษาพัทลุง เขต 2
          </div>
          <div style="flex: 1; border-left: 1px solid #000; padding-left: 10px;">
            <b>ผู้ขาย/ผู้รับจ้าง:</b> ${data.vendor_info?.name || '...........................................'}<br/>
            <b>เลขประจำตัวผู้เสียภาษี:</b> ${data.vendor_info?.tax_id || '...........................................'}<br/>
            <b>ที่อยู่:</b> ${data.vendor_info?.address || '...........................................'}<br/>
            <b>โทรศัพท์:</b> ${data.vendor_info?.phone || '...........................................'}
          </div>
        </div>

        <table class="doc-table" style="margin-top: 10px;">
          <thead>
            <tr>
              <th style="width: 8%;">ลำดับ</th>
              <th>รายการสินค้า / รายละเอียด</th>
              <th style="width: 12%;">จำนวน</th>
              <th style="width: 12%;">หน่วย</th>
              <th style="width: 16%;">ราคาต่อหน่วย</th>
              <th style="width: 18%;">จำนวนเงิน (บาท)</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map((it, idx) => `
              <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td>${it.item_name}</td>
                <td style="text-align: center;">${it.quantity}</td>
                <td style="text-align: center;">${it.unit}</td>
                <td style="text-align: right;">${Number(it.unit_price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right;">${Number(it.total_price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
            <tr>
              <td colspan="5" style="text-align: center; font-weight: bold;">รวมเป็นเงินทั้งสิ้น (${totalText})</td>
              <td style="text-align: right; font-weight: bold;">${Number(data.final_amount || data.estimated_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div style="font-size: 14pt; line-height: 1.4; margin-top: 8px;">
          <b>ข้อตกลงการส่งมอบและค่าปรับ:</b><br/>
          1. กำหนดส่งมอบพัสดุภายในวันที่ ${formatThaiDate(data.delivery_due_date)} ณ ${data.school_name}<br/>
          2. หากส่งมอบเกินกำหนดเวลา ผู้ขายยินยอมให้ปรับเป็นรายวันในอัตราร้อยละ 0.20 ของมูลค่าพัสดุที่ยังไม่ได้รับมอบ<br/>
          3. การจ่ายเงินจะจ่ายเมื่อคณะกรรมการตรวจรับพัสดุได้ตรวจรับถูกต้องครบถ้วนแล้ว
          ${data.custom_clauses ? `<br/>4. <b>เงื่อนไขพิเศษเพิ่มเติม:</b> ${data.custom_clauses}` : ''}
        </div>

        <div style="display: flex; justify-content: space-between; margin-top: 20px;">
          <div class="sig-box" style="width: 8cm;">
            (ลงชื่อ)...................................................... ผู้สั่งซื้อ<br/>
            ( ${data.director_name} )<br/>
            ผู้อำนวยการ${data.school_name}
          </div>
          <div class="sig-box" style="width: 8cm;">
            (ลงชื่อ)...................................................... ผู้ขาย/ผู้รับจ้าง<br/>
            ( ${data.vendor_info?.name || '...........................................'} )<br/>
            วันที่ ......./......./.......
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 5. ใบตรวจรับพัสดุของคณะกรรมการตรวจรับ
   */
  static renderInspectionCertificate(data: ProcurementDocData): string {
    return `
      <div class="page">
        <div class="memo-header">
          <img src="${garuda15mm}" class="garuda-15" />
          <div class="header-title" style="font-size: 26pt;">ใบตรวจรับพัสดุ</div>
        </div>
        <div style="text-align: right; margin-bottom: 10px;">
          <b>เลขที่:</b> ${data.inspection_number || '...............'}<br/>
          <b>วันที่ตรวจรับ:</b> ${formatThaiDate(data.inspection_date)}
        </div>

        <div class="content-p">
          ตามที่ ${data.school_name} ได้ตกลงจัดซื้อจัดจ้าง รายการ <b>${data.title}</b> จาก <b>${data.vendor_info?.name || 'ผู้ขาย'}</b> ตามใบสั่งซื้อ/สัญญา เลขที่ ${data.po_number || 'PO-.........'} ลงวันที่ ${formatThaiDate(data.po_date)} จำนวนเงิน ${Number(data.final_amount || data.estimated_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท นั้น
        </div>

        <div class="content-p">
          บัดนี้ ผู้ขายได้ส่งมอบพัสดุดังกล่าวเรียบร้อยแล้ว เมื่อวันที่ ${formatThaiDate(data.actual_delivery_date || data.inspection_date)} คณะกรรมการตรวจรับพัสดุได้ร่วมกันตรวจรับพัสดุ ณ ${data.school_name} ปรากฏผลการตรวจรับดังนี้:
        </div>

        <div style="margin-left: 1.5cm; margin-top: 10px; line-height: 1.6;">
          [ ✓ ] พัสดุถูกต้อง ครบถ้วน ตรงตามคุณลักษณะเฉพาะและเงื่อนไขในใบสั่งซื้อ/สัญญา ทุกประการ<br/>
          [ ✓ ] ส่งมอบภายในกำหนดเวลา ไม่มีค่าปรับ<br/>
          [ ✓ ] เห็นควรรับมอบพัสดุไว้ และส่งมอบให้เจ้าหน้าที่ลงทะเบียนคุม พร้อมขออนุมัติเบิกจ่ายเงินให้แก่ผู้ขายต่อไป
        </div>

        <div style="margin-top: 30px;">
          จึงขอลงลายมือชื่อไว้เป็นหลักฐาน
        </div>

        <div style="margin-top: 20px; display: flex; flex-direction: column; align-items: flex-end;">
          ${data.committee_members.map(m => `
            <div class="sig-box" style="margin-bottom: 15px;">
              (ลงชื่อ)...................................................... ${m.role}<br/>
              ( ${m.name} )
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * 6. ชุดจัดซื้อจัดจ้างวงเงินเล็กน้อยตาม ว.119 (ไม่เกิน 10,000 บาท ซื้อก่อนเบิกทีหลัง)
   */
  static renderW119FastTrackMemo(data: ProcurementDocData): string {
    const totalText = thaiBahtText(data.final_amount || data.estimated_amount);
    return `
      <div class="page">
        <div class="memo-header">
          <img src="${garuda15mm}" class="garuda-15" />
          <div class="header-title" style="font-size: 24pt;">บันทึกข้อความ (ตาม ว.119)</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ส่วนราชการ</span> ${data.school_name} (${data.department})</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">ที่</span> ${data.memo_number || '...............'}</div>
          <div style="width: 7cm;"><span class="info-label">วันที่</span> ${formatThaiDate(data.request_date)}</div>
        </div>
        <div class="info-row">
          <div style="flex: 1;"><span class="info-label">เรื่อง</span> รายงานขอความเห็นชอบจัดซื้อจัดจ้างและขออนุมัติเบิกจ่ายเงินตาม ว.119</div>
        </div>
        <div style="margin-top: 10px;">
          <span class="info-label">เรียน</span> ผู้อำนวยการ${data.school_name}
        </div>

        <div class="content-p">
          ด้วย ข้าพเจ้า ${data.requester_name} มีความจำเป็นเร่งด่วนในการจัดซื้อจัดจ้าง รายการ <b>${data.title}</b> เพื่อใช้ในกิจกรรมของโรงเรียน และได้ดำเนินการจัดซื้อจัดจ้างไปก่อนแล้ว ตามนัยหนังสือคณะกรรมการวินิจฉัยปัญหาการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ ด่วนที่สุด ที่ กค (กวจ) 0405.2/ว 119 ลงวันที่ 9 มีนาคม 2561 ข้อ 1 วงเงินไม่เกิน 10,000 บาท
        </div>

        <div class="content-p">
          การจัดซื้อดังกล่าวได้เสร็จสิ้นเรียบร้อยแล้ว โดยได้รับมอบพัสดุถูกต้องครบถ้วน ตามใบเสร็จรับเงิน/บิลเงินสด เล่มที่/เลขที่ <b>${data.vendor_info?.receipt_no || '..........'}</b> ลงวันที่ <b>${formatThaiDate(data.vendor_info?.receipt_date)}</b> จากร้าน <b>${data.vendor_info?.name || 'ผู้ขาย'}</b> เป็นจำนวนเงินทั้งสิ้น <b>${Number(data.final_amount || data.estimated_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (${totalText})</b> เอกสารหลักฐานแนบท้ายนี้
        </div>

        <div class="content-p">
          จึงเรียนมาเพื่อโปรดให้ความเห็นชอบการจัดซื้อจัดจ้างดังกล่าว และขออนุมัติเบิกจ่ายเงินให้แก่ผู้สำรองจ่ายต่อไป
        </div>

        <div class="sig-section" style="margin-top: 20px;">
          <div class="sig-box">
            (ลงชื่อ)...................................................... ผู้ขอเบิก/สำรองจ่าย<br/>
            ( ${data.requester_name} )<br/>
            ตำแหน่ง ${data.requester_position}
          </div>
        </div>

        <div style="margin-top: 20px; border-top: 1px dashed #000; padding-top: 10px;">
          <div style="font-weight: bold;">ความเห็นของหัวหน้าเจ้าหน้าที่:</div>
          <div style="margin-top: 4px;">เห็นชอบตามนัย ว.119 รายการพัสดุถูกต้องและเอกสารใบเสร็จครบถ้วน</div>
          <div class="sig-section" style="margin-top: 10px;">
            <div class="sig-box">
              (ลงชื่อ)......................................................<br/>
              ( ${data.head_officer_name} )<br/>
              หัวหน้าเจ้าหน้าที่
            </div>
          </div>
        </div>

        <div style="margin-top: 15px; border-top: 1px dashed #000; padding-top: 10px;">
          <div style="font-weight: bold;">คำสั่งผู้อำนวยการ:</div>
          <div style="margin-top: 4px;">[ ✓ ] เห็นชอบ และอนุมัติจ่ายเงินได้</div>
          <div class="sig-section" style="margin-top: 10px;">
            <div class="sig-box">
              ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
              (ลงชื่อ)......................................................<br/>
              ( ${data.director_name} )<br/>
              ผู้อำนวยการ${data.school_name}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 4.1 ข้อตกลงจ้างเหมาบริการ 12 เดือน (ว.877 บุคคลธรรมดา: ธุรการโรงเรียน / นักการภารโรง / ครูอัตราจ้าง)
   * อ้างอิงตามแบบมาตรฐาน สพป.พัทลุง เขต 2 และคำสั่ง สพฐ. ที่ 2493/2566 และ 215/2567
   */
  static renderW877Agreement(data: ProcurementDocData): string {
    const totalAmount = data.final_amount || data.estimated_amount;
    const monthlyAmount = totalAmount > 0 ? Math.round(totalAmount / 12) : 0;
    const totalText = thaiBahtText(totalAmount);
    const monthlyText = thaiBahtText(monthlyAmount);

    return `
      <div class="page">
        <div style="text-align: center; margin-bottom: 12px;">
          <img src="${garuda3cm}" class="garuda-30" />
          <div style="font-size: 20pt; font-weight: bold; margin-top: 5px;">ข้อตกลงจ้างเหมาบริการ</div>
          <div style="font-size: 13pt; color: #444;">(ตามหนังสือคณะกรรมการวินิจฉัยปัญหาการจัดซื้อจัดจ้างฯ ด่วนที่สุด ที่ กค (กวจ) 0405.2/ว 877)</div>
          <div style="font-size: 15pt; font-weight: bold; margin-top: 4px;">เลขที่ ${data.po_number || '............../' + (data.memo_number?.split('/')[1] || '2569')}</div>
        </div>

        <div class="content-p">
          ข้อตกลงฉบับนี้ทำขึ้น ณ <b>${data.school_name}</b> ตำบลควนโคกยา อำเภอเขาชัยสน จังหวัดพัทลุง เมื่อวันที่ ${formatThaiDate(data.po_date || data.request_date)} ระหว่าง <b>${data.school_name}</b> โดย <b>${data.director_name}</b> ตำแหน่ง ${data.director_position} ผู้ได้รับมอบอำนาจตามคำสั่งสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน ที่ ๒๔๙๓/๒๕๖๖ ลงวันที่ ๑๕ พฤศจิกายน ๒๕๖๖ และคำสั่งแก้ไขเพิ่มเติม ที่ ๒๑๕/๒๕๖๗ ลงวันที่ ๒๖ มกราคม ๒๕๖๗ ซึ่งต่อไปในข้อตกลงนี้เรียกว่า <b>“ผู้ว่าจ้าง”</b> ฝ่ายหนึ่ง กับ <b>${data.vendor_info?.name || '..........................................................'}</b> เลขประจำตัวประชาชน <b>${data.vendor_info?.tax_id || '..........................................................'}</b> อยู่บ้านเลขที่ ${data.vendor_info?.address || '..........................................................'} โทรศัพท์ ${data.vendor_info?.phone || '......................'} ซึ่งต่อไปในข้อตกลงนี้เรียกว่า <b>“ผู้รับจ้าง”</b> อีกฝ่ายหนึ่ง
        </div>

        <div class="content-p">
          คู่ข้อตกลงทั้งสองฝ่ายได้ตกลงทำข้อตกลงจ้างเหมาบริการ โดยมีข้อความดังต่อไปนี้:
        </div>

        <div class="content-p">
          <b>ข้อ ๑. ข้อตกลงจ้างและระยะเวลาการจ้าง</b><br/>
          ผู้ว่าจ้างตกลงจ้างเหมา และผู้รับจ้างตกลงรับจ้างเหมาทำงานบริการ รายการ <b>${data.title}</b> ณ ${data.school_name} มีกำหนดระยะเวลาจ้างเหมาบริการทำงานทั้งสิ้น ๑๒ งวด (๑๒ เดือน) โดยผู้รับจ้างรับรองว่ามีคุณสมบัติครบถ้วนตามหลักเกณฑ์ของทางราชการ และไม่เป็นผู้ทิ้งงานของรัฐ
        </div>

        <div class="content-p">
          <b>ข้อ ๒. ขอบเขตของงานจ้างเหมาบริการ (TOR)</b><br/>
          ผู้รับจ้างตกลงจะปฏิบัติงานตามขอบเขตภารกิจและหน้าที่ความรับผิดชอบอย่างเคร่งครัด ดังนี้:
          <div style="margin-left: 20px; margin-top: 5px; font-size: 14pt; line-height: 1.5; white-space: pre-wrap; background-color: #fafafa; border-left: 3px solid #666; padding: 6px 12px;">${data.custom_clauses || `๑. ปฏิบัติงานด้านธุรการ สารบรรณ ลงทะเบียนรับ-ส่ง และจัดเก็บเอกสารหนังสือราชการ
๒. งานจัดเก็บและรายงานข้อมูลสารสนเทศทางการศึกษา (DMC, CCT ปัจจัยพื้นฐานนักเรียนยากจน)
๓. งานพัสดุ ทะเบียนคุม และการดูแลรักษาทรัพย์สินของสถานศึกษา
๔. งานสนับสนุนการบริหารจัดการศึกษาและภารกิจอื่นๆ ตามที่ผู้ว่าจ้างมอบหมาย`}</div>
        </div>

        <div class="content-p">
          <b>ข้อ ๓. ค่าจ้างเหมาบริการและการจ่ายเงิน</b><br/>
          ผู้ว่าจ้างตกลงจ่ายค่าจ้างเหมาบริการให้แก่ผู้รับจ้างเป็นรายเดือน เดือนละ <b>${monthlyAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (-${monthlyText}-)</b> จำนวน ๑๒ เดือน รวมเป็นเงินทั้งสิ้น <b>${totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (-${totalText}-)</b> ซึ่งได้รวมค่าภาษีอากรและค่าใช้จ่ายทั้งปวงไว้แล้ว โดยผู้รับจ้างต้องส่งมอบงานภายใน ๕ วันทำการของเดือนถัดไป เมื่อคณะกรรมการตรวจรับพัสดุได้ตรวจรับผลงานถูกต้องเรียบร้อยแล้ว จึงจะดำเนินการเบิกจ่ายเงินให้ต่อไป
        </div>

        <div class="content-p">
          <b>ข้อ ๔. การบอกเลิกข้อตกลง</b><br/>
          หากผู้รับจ้างไม่ปฏิบัติงานตามขอบเขตที่กำหนด ละทิ้งหน้าที่ หรือก่อให้เกิดความเสียหายแก่ทางราชการ ผู้ว่าจ้างมีสิทธิบอกเลิกข้อตกลงได้ทันทีโดยไม่ต้องจ่ายค่าชดเชยใดๆ ทั้งสิ้น
        </div>

        <div style="margin-top: 25px; line-height: 1.7;">
          <table style="width: 100%; border: none;">
            <tr>
              <td style="width: 50%; text-align: center; vertical-align: top;">
                ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
                (ลงชื่อ)...................................................... ผู้ว่าจ้าง<br/>
                ( ${data.director_name} )<br/>
                ${data.director_position}
              </td>
              <td style="width: 50%; text-align: center; vertical-align: top;">
                <br/>
                (ลงชื่อ)...................................................... ผู้รับจ้าง<br/>
                ( ${data.vendor_info?.name || '..........................................................'} )<br/>
                ผู้รับจ้างเหมาบริการ
              </td>
            </tr>
            <tr>
              <td style="width: 50%; text-align: center; vertical-align: top; padding-top: 20px;">
                (ลงชื่อ)...................................................... พยาน<br/>
                ( ${data.head_officer_name} )<br/>
                หัวหน้าเจ้าหน้าที่
              </td>
              <td style="width: 50%; text-align: center; vertical-align: top; padding-top: 20px;">
                (ลงชื่อ)...................................................... พยาน<br/>
                ( ${data.officer_name} )<br/>
                เจ้าหน้าที่
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * 4.2 ใบตรวจรับงานจ้างเหมาบริการรายเดือน ว.877 (สำหรับเบิกเงินรายเดือน)
   */
  static renderW877MonthlyInspection(data: ProcurementDocData): string {
    const totalAmount = data.final_amount || data.estimated_amount;
    const monthlyAmount = totalAmount > 0 ? Math.round(totalAmount / 12) : 0;
    const monthlyText = thaiBahtText(monthlyAmount);

    return `
      <div class="page">
        <div style="text-align: center; margin-bottom: 10px;">
          <img src="${garuda3cm}" class="garuda-30" />
          <div style="font-size: 20pt; font-weight: bold; margin-top: 5px;">ใบตรวจรับงานจ้างเหมาบริการรายเดือน</div>
          <div style="font-size: 13pt; color: #444;">ตามข้อตกลงจ้างเหมาบริการ ว.877 เลขที่ ${data.po_number || '.........'}</div>
        </div>

        <div style="text-align: right; margin-bottom: 12px; font-size: 14pt;">
          เขียนที่ ${data.school_name}<br/>
          วันที่ ${formatThaiDate(data.inspection_date || new Date().toISOString().split('T')[0])}
        </div>

        <div class="content-p">
          ตามที่ <b>${data.school_name}</b> ได้ทำข้อตกลงจ้างเหมาบริการ รายการ <b>${data.title}</b> กับ <b>${data.vendor_info?.name || 'ผู้รับจ้าง'}</b> ตามข้อตกลงจ้างเลขที่ ${data.po_number || '...........'} ลงวันที่ ${formatThaiDate(data.po_date || data.request_date)} นั้น
        </div>

        <div class="content-p">
          บัดนี้ ผู้รับจ้างได้ส่งมอบงานจ้างเหมาบริการประจำงวดเดือน เป็นที่เรียบร้อยแล้ว คณะกรรมการตรวจรับพัสดุได้ทำการตรวจสอบผลการปฏิบัติงานแล้ว ปรากฏผลดังนี้:
        </div>

        <div style="margin-left: 1.5cm; margin-top: 8px; line-height: 1.6; font-size: 15pt;">
          ๑. ผู้รับจ้างได้ปฏิบัติหน้าที่และส่งมอบผลงานตามขอบเขตของงาน (TOR) ครบถ้วนถูกต้อง<br/>
          ๒. ผลการปฏิบัติงานมีคุณภาพเรียบร้อย เป็นไปตามมาตรฐานและข้อตกลงจ้างทุกประการ<br/>
          ๓. ได้ส่งมอบงานภายในระยะเวลาที่กำหนด ไม่มีค่าปรับแต่อย่างใด<br/>
          ๔. เห็นควรอนุมัติจ่ายเงินค่าจ้างประจำงวด เป็นจำนวนเงิน <b>${monthlyAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท (-${monthlyText}-)</b>
        </div>

        <div class="content-p" style="margin-top: 15px;">
          จึงขอรายงานผลการตรวจรับต่อผู้อำนวยการสถานศึกษาเพื่อโปรดทราบและพิจารณาอนุมัติเบิกจ่ายเงินต่อไป
        </div>

        <div class="sig-section" style="margin-top: 25px;">
          <div class="sig-box">
            ${data.committee_members.map((m, idx) => `
              <div style="margin-bottom: 12px;">
                (ลงชื่อ)...................................................... ${m.role}<br/>
                ( ${m.name} )<br/>
                ตำแหน่ง ${m.position || 'ครู'}
              </div>
            `).join('')}
          </div>
        </div>

        <div style="margin-top: 20px; border-top: 1px dashed #000; padding-top: 12px;">
          <div style="font-weight: bold; font-size: 15pt;">คำสั่ง / คำอนุมัติของผู้อำนวยการ:</div>
          <div style="margin-top: 5px; font-size: 15pt;">[ ✓ ] ทราบผลการตรวจรับ และอนุมัติให้เบิกจ่ายเงินค่าจ้างได้</div>
          <div class="sig-section" style="margin-top: 15px;">
            <div class="sig-box">
              ${data.director_signature_url ? `<img src="${data.director_signature_url}" class="sig-img" />` : ''}
              (ลงชื่อ)......................................................<br/>
              ( ${data.director_name} )<br/>
              ผู้อำนวยการ${data.school_name}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * สั่งพิมพ์เอกสารไปยังหน้าต่างพิมพ์ใหม่
   */
  static printHtml(htmlContent: string, title: string = 'เอกสารจัดซื้อจัดจ้าง', initialIncludeSigs: boolean = true) {
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="th">
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>${this.getOfficialCss()}</style>
          <script>
            function toggleSignatures(show) {
              var sigs = document.querySelectorAll('.sig-img, .stamp-img');
              sigs.forEach(function(el) {
                el.style.display = show ? 'block' : 'none';
              });
            }
          </script>
        </head>
        <body>
          <div class="no-print-bar">
            <div style="display: flex; align-items: center; gap: 15px;">
              <div>📄 <b>ระบบพิมพ์เอกสารพัสดุราชการ:</b> ${title}</div>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; background: #334155; padding: 5px 12px; border-radius: 8px; user-select: none;">
                <input 
                  type="checkbox" 
                  id="sigToggle" 
                  onchange="toggleSignatures(this.checked)" 
                  ${initialIncludeSigs ? 'checked' : ''} 
                  style="width: 16px; height: 16px; cursor: pointer;" 
                />
                <span>ประทับลายเซ็น/ตราดิจิทัล (ติ๊กออก = เว้นว่างไว้เซ็นสดด้วยปากกา)</span>
              </label>
            </div>
            <button class="print-btn" onclick="window.print()">🖨️ สั่งพิมพ์เอกสาร (A4)</button>
          </div>
          <div style="padding-top: 60px;">
            ${htmlContent}
          </div>
          ${!initialIncludeSigs ? '<script>toggleSignatures(false);</script>' : ''}
        </body>
      </html>
    `;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(fullHtml);
      win.document.close();
    }
  }

  /**
   * สั่งพิมพ์ชุดเอกสารครบวงจร (1-Click Bundle Print) ตามระเบียบ ว. ที่เลือก
   */
  static printBundle(data: ProcurementDocData) {
    let bundleHtml = '';
    const showSig = data.include_signatures !== false;

    if (data.policy_code === 'W119_10K') {
      // ว.119 ไม่เกิน 1 หมื่น พิมพ์บันทึกขอความเห็นชอบ 1 ชุดจบ
      bundleHtml = this.renderW119FastTrackMemo(data);
    } else if (data.policy_code === 'W877') {
      // ว.877 จ้างเหมาบริการ 12 เดือน บุคคลธรรมดา (ธุรการโรงเรียน / นักการภารโรง / ครูอัตราจ้าง)
      bundleHtml += this.renderRequestMemo(data);
      bundleHtml += this.renderReportClause22(data);
      bundleHtml += this.renderAppointmentOrder(data);
      bundleHtml += this.renderW877Agreement(data);
      bundleHtml += this.renderW877MonthlyInspection(data);
    } else {
      // ว.89 หรือ e-GP ชุดใหญ่ พิมพ์เรียงตามลำดับ 5 ฉบับ
      bundleHtml += this.renderRequestMemo(data);
      bundleHtml += this.renderReportClause22(data);
      bundleHtml += this.renderAppointmentOrder(data);
      bundleHtml += this.renderPO(data);
      bundleHtml += this.renderInspectionCertificate(data);
    }

    this.printHtml(bundleHtml, `ชุดเอกสารพัสดุ_${data.pcid}`, showSig);
  }
}
