import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { uploadFile, deleteFileFromDrive } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import { sendLineNotification, sendInteractiveFlexMessage } from '../lib/lineNotify';
import Modal from '../components/Modal';
import { 
  Search, 
  ExternalLink,
  Loader2,
  Save,
  Send,
  Trash2,
  Printer,
  FileText,
  Plus,
  X,
  Sparkles,
  CheckCircle,
  Paperclip,
  Inbox
} from 'lucide-react';
import garuda3cm from '../assets/saraban/garuda-3cm.png';
import { generateAIDraft } from '../lib/aiService';
import { formatDateDMY } from '../lib/dateUtils';

export default function OutgoingDocs() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const currentYearBE = new Date().getFullYear() + 543;
  const [selectedYear, setSelectedYear] = useState<number | null>(currentYearBE);
  const [latestNumber, setLatestNumber] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [incomingDocs, setIncomingDocs] = useState<any[]>([]);
  const [aiIncomingSearch, setAiIncomingSearch] = useState('');

  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [selectedDocForApproval, setSelectedDocForApproval] = useState<any>(null);
  const [directorDecision, setDirectorDecision] = useState('ลงนามอนุมัติ');
  const [directorOpinion, setDirectorOpinion] = useState('');

  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [selectedDocForAttach, setSelectedDocForAttach] = useState<any>(null);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const isDirector = profile?.role === 'director' || profile?.role === 'admin';

  const [formData, setFormData] = useState({
    doc_number: '',
    from_agency: 'โรงเรียนบ้านควนโคกยา',
    to_agency: '',
    subject: '',
    doc_date: new Date().toISOString().split('T')[0],
    urgency: 'ปกติ',
    sender_name: '',
    reference: '',
    closing_phrase: 'จึงเรียนมาเพื่อโปรดทราบ',
    sign_name: '',
    sign_position: 'ผู้อำนวยการโรงเรียนบ้านควนโคกยา',
    contact_phone: '',
    footer_text: '',
    online_submit: true,
  });

  const [content, setContent] = useState('');
  const [attachmentsList, setAttachmentsList] = useState<string[]>(['']);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => { 
    fetchDocs(); 
    fetchSettings();
    fetchIncomingDocs();
  }, []);

  async function fetchSettings() {
    const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
    if (data) {
      setSettings(data);
      setFormData(prev => ({
        ...prev,
        from_agency: data.school_name || 'โรงเรียนบ้านควนโคกยา',
        sign_name: data.director_name || '',
        sign_position: `ผู้อำนวยการ${data.school_name || 'โรงเรียนบ้านควนโคกยา'}`,
        contact_phone: data.phone_number || ''
      }));
    }
  }

  async function fetchIncomingDocs() {
    try {
      const { data, error } = await supabase
        .from('incoming_docs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (!error && data) {
        setIncomingDocs(data);
      }
    } catch (err) {
      console.error('Error fetching incoming docs for AI draft:', err);
    }
  }

  async function fetchDocs(yearToFetch = selectedYear) {
    setLoading(true);
    try {
      let query = supabase.from('outgoing_docs').select('*');
      if (yearToFetch) {
        query = query.eq('doc_year', yearToFetch);
      }
      const { data } = await query.order('created_at', { ascending: false });
      setDocs(data || []);
      
      if (yearToFetch) {
        const { data: latestSeqDoc } = await supabase
          .from('outgoing_docs')
          .select('doc_number')
          .eq('doc_year', yearToFetch)
          .order('doc_sequence', { ascending: false })
          .limit(1);
        if (latestSeqDoc && latestSeqDoc.length > 0) {
          setLatestNumber(latestSeqDoc[0].doc_number);
        } else {
          setLatestNumber('');
        }
      } else if (data && data.length > 0) {
        setLatestNumber(data[0].doc_number);
      } else {
        setLatestNumber('');
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const toThaiNumerals = (text: string) => {
    return text?.toString().replace(/[0-9]/g, (digit) => '๐๑๒๓๔๕๖๗๘๙'[parseInt(digit)]) || '';
  };

  const formatThaiFullDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][date.getMonth()];
    const year = date.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  };

  const [aiPurpose, setAiPurpose] = useState('');

  const getNextDocNumber = (customDate = formData.doc_date) => {
    const prefix = settings?.school_doc_prefix || 'ศธ 04225.016/';
    const docDateObj = new Date(customDate);
    const targetYear = docDateObj.getFullYear() + 543;
    
    const yearDocs = docs.filter(d => d.doc_year === targetYear);
    if (yearDocs.length === 0) {
      return `${prefix}1`;
    }
    
    const validDocs = yearDocs.filter(d => d.doc_number && d.doc_number.startsWith(prefix));
    if (validDocs.length === 0) {
      return `${prefix}1`;
    }
    
    let maxNum = 0;
    validDocs.forEach(d => {
      if (d.doc_sequence && d.doc_sequence > maxNum) {
        maxNum = d.doc_sequence;
      } else {
        const match = d.doc_number.match(/\/(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxNum) {
            maxNum = num;
          }
        }
      }
    });
    
    const startSeq = settings?.start_outgoing_seq || 1;
    const finalNext = Math.max(maxNum + 1, startSeq);
    return `${prefix}${finalNext}`;
  };

  const handleAiDraft = async (incoming: any = null) => {
    if (!incoming && !aiPurpose.trim()) {
      alert('กรุณาระบุรายละเอียดหรือความต้องการในการร่างหนังสือ');
      return;
    }
    
    setIsSaving(true);
    try {
      const { data: sets } = await supabase.from('settings').select('gemini_api_key, ai_cowork_api_key').limit(1).maybeSingle();
      const apiKey = sets?.ai_cowork_api_key || sets?.gemini_api_key;

      if (!apiKey) {
        throw new Error('ไม่พบ API Key ของ Gemini ในหน้าตั้งค่าระบบ');
      }

      // ดึงข้อมูลใน remark ที่บันทึกไว้เป็น JSON สำหรับจดหมายรับ
      let incomingExtra: any = {};
      let remarkStr = '';
      if (incoming && incoming.remark) {
        remarkStr = incoming.remark;
        try {
          if (typeof incoming.remark === 'object') {
            incomingExtra = incoming.remark;
          } else if (typeof incoming.remark === 'string') {
            const trimmed = incoming.remark.trim();
            incomingExtra = JSON.parse(trimmed);
          }
        } catch (e) {
          console.warn('Failed to parse incoming.remark as JSON directly, attempting cleanup:', e);
          try {
            let cleanStr = incoming.remark.trim();
            if (cleanStr.startsWith('"') && cleanStr.endsWith('"')) {
              cleanStr = cleanStr.substring(1, cleanStr.length - 1).replace(/\\"/g, '"');
            }
            incomingExtra = JSON.parse(cleanStr);
          } catch (e2) {
            console.error('Robust parse incoming remark failed:', e2);
          }
        }
      }

      // ดึงเลขที่จดหมายจริงและวันที่จดหมายจริงของต้นทาง (หากไม่มี ค่อยใช้เลขทะเบียนรับ/วันที่รับ เป็นตัวสำรอง)
      let senderDocNo = incomingExtra.sender_doc_number || incomingExtra.sender_doc_no || incoming?.sender_doc_number || incoming?.sender_doc_no || '';
      let senderDocDate = incomingExtra.sender_doc_date || incomingExtra.sender_date || incoming?.sender_doc_date || incoming?.sender_date || '';

      // แผนสำรอง (Fallback) หากยังไม่ได้ค่า: ใช้ Regex ค้นหาจาก remarkStr หรือข้อมูลอื่นๆ
      if (!senderDocNo && remarkStr) {
        const docNumMatch = remarkStr.match(/"sender_doc_number"\s*:\s*"([^"]+)"/) || 
                            remarkStr.match(/"doc_number"\s*:\s*"([^"]+)"/) ||
                            remarkStr.match(/(?:ที่|เลขที่)\s*([A-Za-z0-9ก-ฮ.\/-]+)/);
        if (docNumMatch) {
          senderDocNo = docNumMatch[1];
        }
      }

      if (!senderDocDate && remarkStr) {
        const dateMatch = remarkStr.match(/"sender_doc_date"\s*:\s*"([^"]+)"/) || 
                          remarkStr.match(/"doc_date"\s*:\s*"([^"]+)"/) ||
                          remarkStr.match(/\d{4}-\d{2}-\d{2}/) ||
                          remarkStr.match(/(?:วันที่|ลงวันที่)\s*([A-Za-z0-9ก-ฮ.\/ -]+)/);
        if (dateMatch) {
          senderDocDate = dateMatch[1];
        }
      }

      // ป้องกันการแสดงคำว่า "ที่" ซ้ำซ้อน (เช่น "ที่ ที่ ศธ...")
      let displayDocNo = senderDocNo || '';
      if (displayDocNo.startsWith('ที่')) {
        displayDocNo = displayDocNo.replace(/^ที่\s*/, '');
      }

      const referenceContext = incoming ? `
บริบทสำหรับอ้างอิง:
- เรื่อง: ${incoming.subject}
- จาก (หน่วยงานต้นทาง): ${incoming.from_agency}
- เลขที่หนังสือต้นทางจริง (ใช้สิ่งนี้อ้างอิงเท่านั้น): ${senderDocNo || 'ไม่มี'}
- ลงวันที่บนหนังสือต้นทางจริง (ใช้สิ่งนี้อ้างอิงเท่านั้น): ${senderDocDate || 'ไม่มี'}
- เลขทะเบียนรับในระบบโรงเรียน (ห้ามใช้อ้างอิงในหนังสือส่งออก): ${incoming.doc_number || 'ไม่มี'}
- วันที่ลงทะเบียนรับในระบบโรงเรียน (ห้ามใช้อ้างอิงในหนังสือส่งออก): ${incoming.doc_date || 'ไม่มี'}
- สิ่งที่ต้องดำเนินการ/รายละเอียด: ${incoming.action_required || 'ไม่มี'}
- ข้อสรุป/ข้อมูล AI: ${incoming.ai_suggestion || 'ไม่มี'}
- หมายเหตุ/ข้อความเพิ่มเติม: ${remarkStr || 'ไม่มี'}` : 'เป็นการร่างหนังสือใหม่โดยตรง (ไม่มีการอ้างถึงหนังสือรับ)';

      const userDetail = aiPurpose.trim() ? `ความต้องการหรือรายละเอียดเพิ่มเติมที่ผู้ใช้ระบุ: "${aiPurpose}"` : 'กรุณาร่างจดหมายตอบกลับที่เหมาะสม';

      const prompt = `คุณคือผู้ช่วยส่วนตัว AI ระดับเชี่ยวชาญด้านงานสารบรรณโรงเรียนบ้านควนโคกยา
กรุณาช่วยร่างจดหมายราชการไทย (หนังสือส่งออก) ตามข้อมูลบริบทด้านล่างนี้:

บริบทหนังสือรับ:
${referenceContext}

ความต้องการของผู้ใช้:
${userDetail}

เงื่อนไขและแนวทางการร่าง:
1. ใช้ภาษาราชการระดับทางการ ถูกต้อง สละสลวย และเป็นไปตามธรรมเนียมปฏิบัติของงานสารบรรณ
2. ร่างเรื่อง (Subject) และ เรียน (To Agency) ให้เหมาะสมกับผู้รับและบริบทของเรื่อง
3. ร่างเนื้อหาหลัก (Content) แบ่งออกเป็นย่อหน้าอย่างสวยงาม:
   - ย่อหน้าแรกต้องเขียนเกริ่นเหตุผลที่มาของการออกจดหมาย โดยอ้างอิงถึงหนังสือรับต้นทางในลักษณะ: "ตามหนังสือที่อ้างถึง [หน่วยงานต้นทาง] ได้แจ้ง/ขอความร่วมมือเรื่อง..." 
   - สำคัญมาก: ห้ามระบุเลขที่หนังสือต้นทาง (เช่น ศธ 04225/...) และห้ามระบุวันที่ลงบนหนังสือต้นทางซ้ำลงไปในเนื้อความย่อหน้าแรกหรือในเนื้อความส่วนอื่นๆ ของจดหมายเด็ดขาด เนื่องจากข้อมูลเหล่านี้ได้ระบุไว้ในช่อง "อ้างถึง" ด้านบนชัดเจนแล้ว (ให้เขียนเกริ่นอ้างถึงเพียงสั้นๆ เช่น "ตามหนังสือที่อ้างถึง..." หรือ "ตามหนังสือที่อ้างถึง [หน่วยงานต้นทาง]..." เท่านั้น)
   - ย่อหน้าต่อมาให้ระบุการดำเนินงานหรือผลการพิจารณาของโรงเรียนบ้านควนโคกยา
   - ย่อหน้าสุดท้ายเป็นย่อหน้าสรุปความประสงค์ เช่น "จึงเรียนมาเพื่อโปรดทราบ" หรือ "จึงเรียนมาเพื่อโปรดพิจารณา"
   - ห้ามพิมพ์คำว่า "ที่", "เรื่อง", "เรียน", "อ้างถึง" หรือ "คำลงท้าย" เข้ามาปนในเนื้อหาหลัก (Content)
4. แนะนำคำลงท้าย (Closing Phrase) ที่เหมาะสม เช่น "จึงเรียนมาเพื่อโปรดทราบ", "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ" เป็นต้น
5. แนะนำเอกสารแนบ (Attachments) ที่จำเป็นสำหรับส่งไปพร้อมกับเรื่องนี้ (ถ้ามี) หากไม่มี ให้ปล่อยเป็นค่าว่าง

กรุณาส่งผลลัพธ์กลับมาในรูปแบบ XML tags ต่อไปนี้เท่านั้น (ห้ามมีคำเกริ่นนำ ข้อความวิจารณ์ หรือพูดคุยใดๆ นอกเหนือจาก XML tag เด็ดขาด):
<subject>[พิมพ์หัวเรื่องหนังสือส่งตรงนี้ เช่น ขออนุมัติโครงการ...]</subject>
<to_agency>[พิมพ์ตำแหน่ง/หน่วยงานผู้รับตรงนี้ เช่น ผู้อำนวยการสำนักงานเขต...]</to_agency>
<content>[พิมพ์เนื้อความหนังสือแบ่งย่อหน้าอย่างสมบูรณ์ตรงนี้]</content>
<closing_phrase>[พิมพ์คำลงท้ายตรงนี้ เช่น จึงเรียนมาเพื่อโปรดพิจารณา]</closing_phrase>
<attachments>
[ระบุเอกสารแนบที่ 1 (ถ้ามี)]
[ระบุเอกสารแนบที่ 2 (ถ้ามี)]
</attachments>`;

      const draft = await generateAIDraft(prompt, apiKey);
      if (draft) {
        // แกะ XML tags
        const subjectMatch = draft.match(/<subject>([\s\S]*?)<\/subject>/i);
        const toAgencyMatch = draft.match(/<to_agency>([\s\S]*?)<\/to_agency>/i);
        const contentMatch = draft.match(/<content>([\s\S]*?)<\/content>/i);
        const closingPhraseMatch = draft.match(/<closing_phrase>([\s\S]*?)<\/closing_phrase>/i);
        const attachmentsMatch = draft.match(/<attachments>([\s\S]*?)<\/attachments>/i);

        const aiSubject = subjectMatch ? subjectMatch[1].trim() : '';
        const aiToAgency = toAgencyMatch ? toAgencyMatch[1].trim() : '';
        const aiContent = contentMatch ? contentMatch[1].trim() : draft;
        const aiClosingPhrase = closingPhraseMatch ? closingPhraseMatch[1].trim() : 'จึงเรียนมาเพื่อโปรดทราบ';
        
        let aiAttachments: string[] = [''];
        if (attachmentsMatch) {
          const lines = attachmentsMatch[1]
            .split('\n')
            .map(line => line.replace(/^[-*•\s\d.)]+\s*/, '').trim())
            .filter(line => line);
          if (lines.length > 0) {
            aiAttachments = lines;
          }
        }

        // คำนวณเลขหนังสือถัดไป
        const nextDocNum = getNextDocNumber();

        setFormData(prev => ({
          ...prev,
          doc_number: nextDocNum,
          to_agency: aiToAgency || (incoming ? incoming.from_agency : ''),
          subject: aiSubject || (incoming ? `ตอบรับเรื่อง ${incoming.subject}` : aiPurpose),
          reference: incoming ? `หนังสือ${incoming.from_agency}\nที่ ${displayDocNo || incoming.doc_number || ''} ลงวันที่ ${formatThaiFullDate(senderDocDate || incoming.doc_date || '')}` : '',
          closing_phrase: aiClosingPhrase
        }));

        setContent(aiContent);
        setAttachmentsList(aiAttachments);
        setAiPurpose(''); 
        setIsAiModalOpen(false);
        setIsModalOpen(true);
        alert('AI ได้ช่วยวิเคราะห์ร่างเอกสารตอบกลับ แนะนำผู้รับ หัวข้อ คำลงท้าย พร้อมร่างเอกสารแนบและเนื้อความป้อนลงในฟอร์มให้เรียบร้อยแล้วค่ะ! คุณสามารถตรวจสอบและปรับปรุงเพิ่มเติมได้ตามต้องการ');
      }
    } catch (err: any) {
      alert('ไม่สามารถร่างหนังสือด้วย AI ได้: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const printOutgoingDoc = (doc: any) => {
    let extraData: any = {};
    try {
      if (doc.remark && doc.remark.startsWith('{')) {
        extraData = JSON.parse(doc.remark);
      }
    } catch (e) {}

    const data = { ...doc, ...extraData };
    const dateObj = new Date(data.doc_date);
    const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    
    const day = toThaiNumerals(dateObj.getDate().toString());
    const month = thaiMonths[dateObj.getMonth()];
    const yearNum = dateObj.getFullYear() + 543;
    const year = toThaiNumerals(yearNum.toString());
    
    const fullDate = `${day} ${month} ${year}`;

    const paragraphs = (data.content || '').split('\n').filter((p: string) => p.trim() !== '');
    // กรองและล้างค่าว่างออกจากรายชื่อเอกสารแนบ เพื่อไม่ให้แสดงคำว่า "สิ่งที่ส่งมาด้วย" หากไม่มีการแนบจริง
    const attachments = (Array.isArray(data.attachments) ? data.attachments : (data.attachment ? [data.attachment] : []))
      .map((a: any) => typeof a === 'string' ? a.trim() : '')
      .filter((a: string) => a !== '');
    const referenceLines = (data.reference || '').split('\n'); 
    
    const rawAddress = settings?.school_address || '';
    const addressLines = rawAddress.split('\n').map((l: string) => l.trim());
    
    const htmlAddress = `
      <div style="font-size: 16pt; line-height: 1.1;">
        ${data.from_agency || ''} ${addressLines[0] || ''}<br/>
        ${addressLines[1] || ''}<br/>
        ${addressLines[2] || ''}
      </div>
    `;

    const html = `
      <html>
        <head>
          <title>หนังสือภายนอก - ${data.doc_number}</title>
          <style>
            @font-face {
              font-family: 'THSarabunIT๙';
              src: local('THSarabunIT๙');
            }
            body { 
              font-family: 'THSarabunIT๙', 'TH Sarabun New', sans-serif; 
              padding: 0;
              margin: 0;
              background: #f0f0f0;
            }
            .page {
              background: white;
              width: 210mm;
              height: 297mm;
              margin: 10mm auto;
              padding: 1.5cm 1cm 2cm 3cm; 
              box-sizing: border-box;
              position: relative;
              font-size: 16pt;
              line-height: 1.15;
              color: black;
            }
            .garuda {
              position: absolute;
              top: 1.5cm;
              left: 50%;
              transform: translateX(-50%);
              width: 3cm;
              height: auto;
            }
            .header-info {
              margin-top: 3cm;
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 0.2cm;
            }
            .school-address {
              width: 5.5cm;
              text-align: left;
              font-size: 16pt;
              line-height: 1.1;
            }
            .doc-date {
              margin-left: 7.8cm; 
              margin-bottom: 0.8cm;
              font-size: 16pt;
            }
            .content-section {
              margin-top: 0.5cm;
              line-height: 1.15;
            }
            .content-section div {
              margin-bottom: 0.1cm;
              font-weight: normal !important;
              font-size: 16pt;
            }
            .content-text p {
              margin-top: 0.3cm;
              margin-bottom: 0;
              text-indent: 2.5cm;
              text-align: justify;
              font-size: 16pt;
              word-break: break-word;
              overflow-wrap: break-word;
            }
            .closing-phrase {
              margin-top: 0.3cm;
              margin-bottom: 0;
              text-indent: 2.5cm;
              text-align: justify;
              font-size: 16pt;
              word-break: break-word;
              overflow-wrap: break-word;
            }
            .footer-sign {
              margin-top: 1.5cm;
              margin-left: 7.8cm; 
              width: 8cm;
              font-size: 16pt;
              line-height: 1.2;
            }
            .footer-sign p {
              margin: 0;
              text-align: left;
            }
            .sig-name-block {
              margin-top: 1.5cm;
              text-align: center;
              line-height: 1.5;
              margin-left: -4.8cm; 
            }
            .contact-info {
              position: absolute;
              bottom: 3cm;
              left: 3cm;
              font-size: 14pt;
              line-height: 1.1;
            }
            .centered-footer {
              position: absolute;
              bottom: 1.5cm;
              left: 0;
              right: 0;
              text-align: center;
              font-weight: bold;
              font-size: 16pt;
              color: #000;
            }
            @media print {
              body { background: white; }
              .page { margin: 0; box-shadow: none; width: 100%; height: 100%; }
              .no-print { display: none; }
            }
            .no-print-btn {
              position: fixed; top: 20px; right: 20px;
              background: #16a34a; color: white; border: none;
              padding: 12px 24px; border-radius: 12px; cursor: pointer;
              font-weight: bold; z-index: 9999;
            }
          </style>
        </head>
        <body>
          <button class="no-print-btn no-print" onclick="window.print()">🖨️ พิมพ์เอกสาร</button>
          <div class="page">
            <img src="${garuda3cm}" class="garuda" />
            <div class="header-info">
              <div style="width: 40%; font-size: 16pt;">ที่ ${toThaiNumerals(data.doc_number || '')}</div>
              <div class="school-address">
                ${htmlAddress}
              </div>
            </div>
            <div class="doc-date">${fullDate}</div>
            <div class="content-section">
              <div style="display: flex; font-weight: normal !important; align-items: flex-start; margin-bottom: 0.1cm;">
                <span style="white-space: nowrap; width: 1.2cm;">เรื่อง</span>
                <span style="text-align: justify; word-break: break-word; overflow-wrap: break-word; flex-grow: 1;">${toThaiNumerals(data.subject || '')}</span>
              </div>
              <div style="display: flex; font-weight: normal !important; align-items: flex-start; margin-bottom: 0.1cm;">
                <span style="white-space: nowrap; width: 1.2cm;">เรียน</span>
                <span style="flex-grow: 1;">${toThaiNumerals(data.to_agency || '')}</span>
              </div>
              ${referenceLines.filter((l: string) => l.trim() !== '').length > 0 ? `
                <div style="display: flex; font-weight: normal !important; align-items: flex-start; margin-bottom: 0.1cm;">
                  <span style="white-space: nowrap; width: 1.7cm;">อ้างถึง</span>
                  <div style="display: flex; flex-direction: column; flex-grow: 1;">
                    ${referenceLines.filter((l: string) => l.trim() !== '').map((line: string) => `
                      <span style="text-align: justify; word-break: break-word; overflow-wrap: break-word;">${toThaiNumerals(line.trim())}</span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${attachments.length > 0 ? `
                <div style="display: flex; font-weight: normal !important; align-items: flex-start; margin-bottom: 0.1cm;">
                  <span style="white-space: nowrap; width: 3.1cm;">สิ่งที่ส่งมาด้วย</span>
                  <div style="display: flex; flex-direction: column; flex-grow: 1;">
                    ${attachments.map((a: string, i: number) => `
                      <span style="text-align: justify; word-break: break-word; overflow-wrap: break-word;">
                        ${attachments.length > 1 ? toThaiNumerals((i + 1).toString()) + '. ' : ''}${toThaiNumerals(a)}
                      </span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
            <div class="content-text">
              ${paragraphs.map((p: string) => `<p>${toThaiNumerals(p)}</p>`).join('')}
            </div>
            ${data.closing_phrase ? `<div class="closing-phrase">${toThaiNumerals(data.closing_phrase)}</div>` : ''}
            <div class="footer-sign">
              <p>ขอแสดงความนับถือ</p>
              ${(data.status === 'approved' && settings?.director_signature_url) ? `
                <div style="margin-top: 0.1cm; margin-bottom: 0.1cm; text-align: center; margin-left: -4.8cm;">
                  <img src="${settings.director_signature_url}" style="height: 1.4cm; width: auto; mix-blend-mode: multiply;" />
                </div>
              ` : `
                <div style="height: 1.6cm;"></div>
              `}
              <div class="sig-name-block" style="${(data.status === 'approved' && settings?.director_signature_url) ? 'margin-top: 0.2cm;' : 'margin-top: 0cm;'}">
                ( ${data.sign_name || '................................................'} )<br/>
                ${data.sign_position || '................................................'}
              </div>
            </div>
            <div class="contact-info">
              ${data.from_agency || ''}<br/>
              โทร. ${toThaiNumerals(data.contact_phone || '-')}
            </div>
            
            ${data.footer_text ? `
              <div class="centered-footer">
                "${data.footer_text}"
              </div>
            ` : ''}
          </div>
        </body>
      </html>
    `;
    const win = window.open('', '_blank');
    win?.document.write(html);
    win?.document.close();
  };

  async function handleDelete(id: string) {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลนี้? รวมถึงไฟล์ใน Drive จะถูกลบด้วย')) return;
    try {
      const { data: doc } = await supabase.from('outgoing_docs').select('file_url').eq('id', id).single();
      if (doc?.file_url) {
        await deleteFileFromDrive(doc.file_url);
      }
      const { error } = await supabase.from('outgoing_docs').delete().eq('id', id);
      if (error) throw error;
      alert('ลบข้อมูลและไฟล์เรียบร้อยแล้ว');
      fetchDocs();
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  }

  async function handleApprovalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDocForApproval) return;
    setIsSaving(true);
    try {
      let extraData: any = {};
      try {
        if (selectedDocForApproval.remark && selectedDocForApproval.remark.startsWith('{')) {
          extraData = JSON.parse(selectedDocForApproval.remark);
        }
      } catch (err) {}

      const todayThai = new Date().toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const updatedExtraData = {
        ...extraData,
        director_decision: directorDecision,
        director_opinion: directorOpinion,
        approved_date: todayThai,
        show_director_signature: true
      };

      const { error } = await supabase.from('outgoing_docs').update({ 
        status: 'approved',
        remark: JSON.stringify(updatedExtraData)
      }).eq('id', selectedDocForApproval.id);

      if (error) throw error;

      // ดึง line_user_id ของครูผู้เสนอ
      let requesterLineUserId = '';
      if (selectedDocForApproval.created_by) {
        const { data: reqProfile } = await supabase
          .from('profiles')
          .select('line_user_id')
          .eq('id', selectedDocForApproval.created_by)
          .maybeSingle();
        requesterLineUserId = reqProfile?.line_user_id || '';
      }

      // ส่ง LINE แจ้งเตือนครูผู้เสนอ
      const lineMessage = `\n✅ หนังสือส่งได้รับการลงนามอนุมัติแล้ว\nเรื่อง: ${selectedDocForApproval.subject}\nถึง: ${selectedDocForApproval.to_agency}\nลงวันที่อนุมัติ: ${todayThai}\nความเห็น ผอ.: ${directorOpinion || '-'}\n\nครูผู้เสนอสามารถพิมพ์หนังสือส่งฉบับจริงที่มีลายเซ็น ผอ. ได้ในระบบ`;
      if (requesterLineUserId) {
        await sendLineNotification(lineMessage, requesterLineUserId);
      } else {
        await sendLineNotification(lineMessage);
      }

      alert('ลงนามอนุมัติหนังสือส่งเรียบร้อยแล้ว');
      setIsApprovalModalOpen(false);
      fetchDocs();
    } catch (err: any) {
      alert('ไม่สามารถบันทึกการอนุมัติได้: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApprovalReject() {
    if (!selectedDocForApproval) return;
    setIsSaving(true);
    try {
      let extraData: any = {};
      try {
        if (selectedDocForApproval.remark && selectedDocForApproval.remark.startsWith('{')) {
          extraData = JSON.parse(selectedDocForApproval.remark);
        }
      } catch (err) {}

      const updatedExtraData = {
        ...extraData,
        director_decision: 'ส่งกลับแก้ไข',
        director_opinion: directorOpinion,
        show_director_signature: false
      };

      const { error } = await supabase.from('outgoing_docs').update({ 
        status: 'rejected',
        remark: JSON.stringify(updatedExtraData)
      }).eq('id', selectedDocForApproval.id);

      if (error) throw error;

      // ดึง line_user_id ของครูผู้เสนอ
      let requesterLineUserId = '';
      if (selectedDocForApproval.created_by) {
        const { data: reqProfile } = await supabase
          .from('profiles')
          .select('line_user_id')
          .eq('id', selectedDocForApproval.created_by)
          .maybeSingle();
        requesterLineUserId = reqProfile?.line_user_id || '';
      }

      // ส่ง LINE แจ้งเตือนครูผู้เสนอ
      const lineMessage = `\n❌ หนังสือส่งถูกส่งกลับเพื่อแก้ไข\nเรื่อง: ${selectedDocForApproval.subject}\nถึง: ${selectedDocForApproval.to_agency}\nความเห็นข้อแนะนำ ผอ.: ${directorOpinion || '-'}`;
      if (requesterLineUserId) {
        await sendLineNotification(lineMessage, requesterLineUserId);
      } else {
        await sendLineNotification(lineMessage);
      }

      alert('ส่งกลับแก้ไขเรียบร้อยแล้ว');
      setIsApprovalModalOpen(false);
      fetchDocs();
    } catch (err: any) {
      alert('ไม่สามารถส่งกลับแก้ไขได้: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAttachReservedFile(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDocForAttach || !attachFile) return;

    setIsAttaching(true);
    try {
      const sanitized = (selectedDocForAttach.subject || 'เอกสารส่ง').replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
      const fileName = `หนังสือส่ง_${selectedDocForAttach.doc_number}_เรื่อง_${sanitized}.pdf`;
      const fileUrl = await uploadFile(attachFile, 'outgoing', fileName.replace('.pdf', ''));

      const { error } = await supabase
        .from('outgoing_docs')
        .update({
          file_url: fileUrl,
          is_reserved: false,
          status: 'pending'
        })
        .eq('id', selectedDocForAttach.id);

      if (error) throw error;

      alert('แนบไฟล์เอกสารย้อนหลังสำเร็จ!');
      setIsAttachModalOpen(false);
      setSelectedDocForAttach(null);
      setAttachFile(null);
      fetchDocs();
    } catch (err: any) {
      console.error(err);
      alert('แนบไฟล์ไม่สำเร็จ: ' + err.message);
    } finally {
      setIsAttaching(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      let file_url = '';
      if (selectedFile) {
        try {
          file_url = await uploadFile(selectedFile, 'documents', 'outgoing');
        } catch (uploadErr: any) {
          throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ: ${uploadErr.message}`);
        }
      }

      const extraData = {
        reference: formData.reference,
        attachments: attachmentsList.filter(a => a.trim() !== ''),
        content: content,
        closing_phrase: formData.closing_phrase,
        sign_name: formData.sign_name,
        sign_position: formData.sign_position,
        contact_phone: formData.contact_phone,
        footer_text: formData.footer_text
      };

      const docDateObj = new Date(formData.doc_date);
      const docYear = docDateObj.getFullYear() + 543;

      // ค้นหา sequence ถัดไปของปีนี้ ณ จังหวะเซฟจริง
      const { data: seqData } = await supabase
        .from('outgoing_docs')
        .select('doc_sequence')
        .eq('doc_year', docYear)
        .order('doc_sequence', { ascending: false })
        .limit(1);
      
      const docSeq = (seqData && seqData.length > 0) ? (Number(seqData[0].doc_sequence) + 1) : 1;
      const prefix = settings?.school_doc_prefix || 'ศธ 04225.016/';
      const finalDocNumber = formData.doc_number.trim() || `${prefix}${docSeq}`;

      const { data: insertedDocs, error } = await supabase.from('outgoing_docs').insert([{ 
        doc_number: finalDocNumber,
        from_agency: formData.from_agency,
        to_agency: formData.to_agency,
        subject: formData.subject,
        doc_date: formData.doc_date,
        urgency: formData.urgency,
        sender_name: formData.sender_name,
        remark: JSON.stringify(extraData),
        file_url, 
        status: formData.online_submit ? 'pending' : 'sent',
        created_by: user?.id,
        doc_year: docYear,
        doc_sequence: docSeq
      }]).select();

      if (error) throw new Error(`บันทึกข้อมูลไม่สำเร็จ: ${error.message}`);
      const insertedDoc = insertedDocs?.[0];

      // ดึงไลน์ ผอ. เพื่อเสนอตรง
      const { data: dirProfile } = await supabase
        .from('profiles')
        .select('line_user_id')
        .eq('role', 'director')
        .maybeSingle();

      if (formData.online_submit) {
        const lineMessage = `เรื่อง: ${formData.subject}\nถึง: ${formData.to_agency}\nผู้เสนอ: ${profile?.display_name || ''}`;
        const lineActions: any[] = [
          { label: '✅ อนุมัติลงนาม', type: 'postback', data: `action=approve_doc&type=outgoing&id=${insertedDoc?.id || ''}`, color: '#1DB446' },
          { label: '❌ ส่งกลับแก้ไข', type: 'postback', data: `action=reject_doc&type=outgoing&id=${insertedDoc?.id || ''}`, color: '#FF3B30' }
        ];
        if (file_url) {
          lineActions.unshift({ label: '📄 ดูร่างเอกสาร', type: 'uri', uri: file_url });
        }
        await sendInteractiveFlexMessage(
          dirProfile?.line_user_id || undefined,
          '⏳ เสนออนุมัติหนังสือส่ง',
          lineMessage,
          lineActions
        );
      } else {
        const lineMessage = `เลขที่ส่ง: ${finalDocNumber}\nเรื่อง: ${formData.subject}\nถึง: ${formData.to_agency}`;
        const lineActions = file_url ? [{ label: '📄 ดูเอกสาร', type: 'uri' as const, uri: file_url }] : [];
        await sendInteractiveFlexMessage(
          undefined, // ส่งเข้ากลุ่ม
          '📤 หนังสือส่งออกใหม่ (ลงทะเบียนตรง)',
          lineMessage,
          lineActions
        );
      }

      setIsModalOpen(false);
      resetForm();
      fetchDocs();
      alert('บันทึกข้อมูลเรียบร้อยแล้ว');
    } catch (err: any) {
      console.error(err);
      alert(`ไม่สามารถบันทึกได้: ${err.message}`);
    } finally { setIsSaving(false); }
  }

  function resetForm() {
    setFormData({ 
      doc_number: getNextDocNumber(), 
      from_agency: settings?.school_name || 'โรงเรียนบ้านควนโคกยา', 
      to_agency: '', 
      subject: '', 
      doc_date: new Date().toISOString().split('T')[0], 
      urgency: 'ปกติ', 
      sender_name: '',
      reference: '',
      closing_phrase: 'จึงเรียนมาเพื่อโปรดทราบ',
      sign_name: settings?.director_name || '',
      sign_position: `ผู้อำนวยการ${settings?.school_name || 'โรงเรียนบ้านควนโคกยา'}`,
      contact_phone: settings?.phone_number || '',
      footer_text: '',
      online_submit: true,
    });
    setContent('');
    setAttachmentsList(['']);
    setSelectedFile(null);
  }

  const addAttachmentRow = () => setAttachmentsList([...attachmentsList, '']);
  const updateAttachment = (val: string, index: number) => {
    const newList = [...attachmentsList];
    newList[index] = val;
    setAttachmentsList(newList);
  };

  // กรองรายการหนังสือรับสำหรับโมดัล AI Draft
  const filteredIncomingForAi = incomingDocs.filter(inc => {
    if (!aiIncomingSearch.trim()) return true;
    const q = aiIncomingSearch.toLowerCase().trim();
    const docNo = String(inc.doc_number || inc.doc_sequence || '').toLowerCase();
    const subject = String(inc.subject || '').toLowerCase();
    const agency = String(inc.from_agency || '').toLowerCase();
    let senderDocNo = '';
    if (inc.remark) {
      try {
        const p = typeof inc.remark === 'string' ? JSON.parse(inc.remark) : inc.remark;
        senderDocNo = String(p.sender_doc_number || p.sender_doc_no || '').toLowerCase();
      } catch {}
    }
    return docNo.includes(q) || subject.includes(q) || agency.includes(q) || senderDocNo.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-2xl flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
            <input type="text" placeholder="ค้นหาหนังสือส่ง..." className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-hidden shadow-xs" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          
          <select 
            value={selectedYear || ''} 
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value) : null;
              setSelectedYear(val);
              fetchDocs(val);
            }}
            className="p-3 bg-white border border-slate-200 rounded-2xl outline-hidden shadow-xs font-bold text-slate-700 text-sm h-[48px]"
          >
            <option value="">ดูทั้งหมด</option>
            <option value={currentYearBE}>{currentYearBE}</option>
            <option value={currentYearBE - 1}>{currentYearBE - 1}</option>
            <option value={currentYearBE - 2}>{currentYearBE - 2}</option>
          </select>

          {latestNumber && (
            <div className="shrink-0 px-3 py-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-xl flex items-center gap-1.5 whitespace-nowrap shadow-xs h-[48px] flex items-center">
              <span className="text-[10px] font-black text-brand-primary uppercase tracking-tighter mr-1">ล่าสุด:</span>
              <span className="text-xs font-black text-brand-primary tracking-tight">{latestNumber}</span>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setIsAiModalOpen(true)} className="bg-white text-brand-primary border-2 border-brand-primary/20 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand-primary/5 active:scale-95 transition-all">
            <Sparkles size={20} /> ร่างด้วย AI
          </button>
          <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="bg-brand-primary text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg active:scale-95 transition-all">
            <Send size={20} /> ออกเลขหนังสือส่ง
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เลขที่ส่ง / วันที่</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เรื่อง</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">ถึงหน่วยงาน</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">สถานะ</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={5} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-brand-primary" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={5} className="py-20 text-center text-slate-400 italic">ไม่พบข้อมูลหนังสือส่ง</td></tr>
            ) : (
              docs.filter(d => d.subject.includes(searchTerm)).map(doc => (
                <tr key={doc.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-800 text-sm">{doc.doc_number}</div>
                    <div className="text-[10px] text-slate-400">{formatDateDMY(doc.doc_date)}</div>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-700">
                    <div>{doc.subject}</div>
                    {(doc.reserved_by_name || doc.sender_name) && (
                      <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                        {doc.status === 'reserved' || doc.is_reserved ? `จองโดย: ${doc.reserved_by_name || '-'}` : `ผู้ส่ง: ${doc.sender_name || '-'}`}
                      </div>
                    )}
                    {doc.status === 'rejected' && (
                      <div className="text-xs font-semibold text-red-500 mt-1">
                        ⚠️ ส่งกลับแก้ไข: {(() => {
                          try {
                            if (doc.remark && doc.remark.startsWith('{')) {
                              const r = JSON.parse(doc.remark);
                              return r.director_opinion || 'ไม่ระบุสาเหตุ';
                            }
                          } catch(e) {}
                          return 'ไม่ระบุสาเหตุ';
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{doc.to_agency}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      doc.status === 'reserved' || doc.is_reserved ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                      doc.status === 'approved' ? 'bg-green-100 text-green-700' :
                      doc.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      doc.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {doc.status === 'reserved' || doc.is_reserved ? '🟡 จองเลขแล้ว (รอไฟล์)' :
                       doc.status === 'approved' ? 'ลงนามแล้ว' :
                       doc.status === 'rejected' ? 'ส่งกลับแก้ไข' :
                       doc.status === 'sent' ? 'ส่งแล้ว' :
                       'รอลงนาม'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1 items-center">
                      {(doc.status === 'reserved' || doc.is_reserved) && (
                        <button 
                          onClick={() => {
                            setSelectedDocForAttach(doc);
                            setAttachFile(null);
                            setIsAttachModalOpen(true);
                          }}
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-1 font-bold text-xs shadow-xs"
                          title="แนบไฟล์เอกสารย้อนหลัง"
                        >
                          <Paperclip size={14} /> แนบไฟล์
                        </button>
                      )}

                      {isDirector && doc.status === 'pending' && (
                        <button 
                          onClick={() => {
                            setSelectedDocForApproval(doc);
                            setDirectorOpinion('');
                            setDirectorDecision('ลงนามอนุมัติ');
                            setIsApprovalModalOpen(true);
                          }} 
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-1 font-bold text-xs shadow-xs" 
                          title="ลงนามและอนุมัติออนไลน์"
                        >
                          ✍️ ลงนาม
                        </button>
                      )}
                      
                      <button onClick={() => printOutgoingDoc(doc)} className="p-2 text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors" title="พิมพ์หนังสือ"><Printer size={18} /></button>
                      {doc.file_url && <a href={doc.file_url} target="_blank" className="p-2 text-slate-400 hover:text-brand-primary"><ExternalLink size={18} /></a>}
                      <button onClick={() => handleDelete(doc.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="ลบข้อมูล"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} title="ร่างหนังสือส่งด้วย AI (เลือกจากหนังสือรับ)">
        <div className="space-y-6">
          <div className="bg-brand-primary/5 p-4 rounded-2xl border border-brand-primary/10 space-y-3">
             <label className="text-xs font-black text-brand-primary uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={14} /> สิ่งที่ต้องการให้ AI ร่าง (รายละเอียดเพิ่มเติม)
             </label>
             <textarea 
                className="w-full p-4 bg-white border border-brand-primary/20 rounded-xl font-bold text-slate-700 outline-hidden focus:ring-2 ring-brand-primary/20"
                placeholder="เช่น แจ้งผลการดำเนินงานจัดซื้อพัสดุ หรือ ร่างหนังสือเชิญประชุมคณะกรรมการสถานศึกษา..."
                rows={3}
                value={aiPurpose}
                onChange={e => setAiPurpose(e.target.value)}
             />
             <div className="flex justify-between items-center gap-4">
                <p className="text-[10px] text-slate-400 font-bold italic flex-1">* ระบุรายละเอียดที่ต้องการ แล้วเลือกหนังสือรับด้านล่าง หรือกดปุ่มร่างใหม่โดยตรง</p>
                <button 
                  onClick={() => handleAiDraft(null)}
                  disabled={isSaving || !aiPurpose.trim()}
                  className="shrink-0 px-4 py-2 bg-brand-primary text-white rounded-xl font-bold text-xs shadow-lg shadow-green-100 hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  ร่างหนังสือใหม่โดยตรง
                </button>
             </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest px-1 flex items-center gap-1.5">
                <Inbox size={14} className="text-brand-primary" /> เลือกหนังสือรับอ้างถึง:
              </p>
              <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                พบ {filteredIncomingForAi.length} จาก {incomingDocs.length} เรื่อง
              </span>
            </div>

            {/* ช่องค้นหาหนังสือรับ */}
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text"
                value={aiIncomingSearch}
                onChange={e => setAiIncomingSearch(e.target.value)}
                placeholder="ค้นหาจากเลขที่รับ, เลขหนังสือผู้ส่ง, ชื่อเรื่อง, หรือหน่วยงาน..."
                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-brand-primary/20 focus:bg-white transition-all"
              />
              {aiIncomingSearch && (
                <button 
                  onClick={() => setAiIncomingSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* รายการหนังสือรับ */}
            <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {filteredIncomingForAi.length === 0 ? (
                <div className="py-10 text-center text-slate-400 italic bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  {aiIncomingSearch ? `ไม่พบข้อมูลหนังสือรับที่ตรงกับคำค้นหา "${aiIncomingSearch}"` : 'ไม่พบข้อมูลหนังสือรับ'}
                </div>
              ) : (
                filteredIncomingForAi.map(inc => {
                  let senderDocNo = '';
                  if (inc.remark) {
                    try {
                      const p = typeof inc.remark === 'string' ? JSON.parse(inc.remark) : inc.remark;
                      senderDocNo = p.sender_doc_number || p.sender_doc_no || '';
                    } catch {}
                  }

                  return (
                    <button 
                      key={inc.id}
                      onClick={() => handleAiDraft(inc)}
                      className="w-full text-left p-4 bg-slate-50 hover:bg-brand-primary/5 hover:border-brand-primary/30 border border-slate-200/80 rounded-2xl transition-all group cursor-pointer"
                    >
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-brand-primary uppercase tracking-widest bg-brand-primary/10 px-2 py-0.5 rounded-md">
                            เลขที่รับ: {inc.doc_number || inc.doc_sequence}
                          </span>
                          {senderDocNo && (
                            <span className="text-[10px] font-bold text-slate-600 bg-slate-200/70 px-2 py-0.5 rounded-md">
                              ที่: {senderDocNo}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 shrink-0">{formatDateDMY(inc.doc_date || inc.created_at)}</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 group-hover:text-brand-primary transition-colors line-clamp-2">
                        {inc.subject}
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-1.5 font-medium flex items-center gap-1">
                        <span className="font-bold text-slate-400">จาก:</span> {inc.from_agency || '-'}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="ออกเลขหนังสือส่งและสร้างเอกสาร">
        <form onSubmit={handleSave} className="space-y-4 max-h-[80vh] overflow-y-auto px-1 pb-4 text-slate-700">
          <div className="bg-slate-50 p-4 rounded-2xl space-y-4 border border-slate-100">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><FileText size={14} /> ข้อมูลหัวหนังสือ</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">เลขที่หนังสือส่ง</label>
                <input type="text" placeholder="เช่น ศธ 04225.016/..." className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" required value={formData.doc_number} onChange={e => setFormData({...formData, doc_number: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">ลงวันที่</label>
                <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" required value={formData.doc_date} onChange={e => setFormData({...formData, doc_date: e.target.value})} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 ml-1">เรื่อง</label>
              <input type="text" placeholder="ระบุชื่อเรื่อง" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" required value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 ml-1">เรียน (ผู้รับ)</label>
              <input type="text" placeholder="เช่น ผู้อำนวยการสำนักงานเขต..." className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" required value={formData.to_agency} onChange={e => setFormData({...formData, to_agency: e.target.value})} />
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">อ้างถึง (ถ้ามี)</label>
                <input type="text" placeholder="หนังสือที่อ้างถึง" className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" value={formData.reference} onChange={e => setFormData({...formData, reference: e.target.value})} />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-slate-500 ml-1">สิ่งที่ส่งมาด้วย (ถ้ามี)</label>
                  <button type="button" onClick={addAttachmentRow} className="p-1.5 bg-brand-primary/10 text-brand-primary rounded-lg hover:bg-brand-primary/20 transition-all"><Plus size={14} /></button>
                </div>
                {attachmentsList.map((item, idx) => (
                  <div key={idx} className="flex gap-2 animate-in slide-in-from-left-2">
                    <input 
                      type="text" 
                      placeholder={`รายการเอกสารแนบที่ ${idx + 1}`} 
                      className="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700" 
                      value={item} 
                      onChange={e => updateAttachment(e.target.value, idx)} 
                    />
                    {attachmentsList.length > 1 && (
                      <button type="button" onClick={() => setAttachmentsList(attachmentsList.filter((_, i) => i !== idx))} className="p-3 text-red-400 hover:text-red-500"><X size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 ml-1">เนื้อหาข้อความ (กด Enter เพื่อขึ้นย่อหน้าใหม่)</label>
            <textarea placeholder="พิมพ์เนื้อหาของหนังสือที่นี่..." className="w-full p-4 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" rows={6} value={content} onChange={e => setContent(e.target.value)} />
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl space-y-4 border border-slate-100">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Send size={14} /> คำลงท้าย</h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                'จึงเรียนมาเพื่อทราบ',
                'จึงเรียนมาเพื่อโปรดทราบ',
                'จึงเรียนมาเพื่อพิจารณา',
                'จึงเรียนมาเพื่อโปรดพิจารณา',
                'ไม่ระบุ / ใช้ตามเนื้อหา AI'
              ].map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => setFormData({ ...formData, closing_phrase: phrase.includes('ไม่ระบุ') ? '' : phrase })}
                  className={`p-3 text-[11px] font-bold rounded-xl border-2 transition-all ${
                    (formData.closing_phrase === phrase || (phrase.includes('ไม่ระบุ') && !formData.closing_phrase))
                      ? 'bg-brand-primary border-brand-primary text-white shadow-md' 
                      : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                  }`}
                >
                  {phrase}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-50/50 p-4 rounded-2xl space-y-4 border border-blue-100/50">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2"><Save size={14} /> ข้อมูลการลงนามและติดต่อ</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-blue-500 ml-1">ชื่อผู้ลงนาม</label>
                <input type="text" className="w-full p-3 bg-white border border-blue-200 rounded-xl font-bold text-slate-700" value={formData.sign_name} onChange={e => setFormData({...formData, sign_name: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-blue-500 ml-1">ตำแหน่ง</label>
                <input type="text" className="w-full p-3 bg-white border border-blue-200 rounded-xl font-bold text-slate-700" value={formData.sign_position} onChange={e => setFormData({...formData, sign_position: e.target.value})} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-blue-500 ml-1 text-slate-500 uppercase tracking-tighter">ข้อความส่วนท้ายกระดาษ (จะแสดงในเครื่องหมาย " ")</label>
              <input type="text" placeholder="เช่น เรียนดีมีคุณธรรม" className="w-full p-3 bg-white border border-blue-200 rounded-xl font-black text-slate-800" value={formData.footer_text} onChange={e => setFormData({...formData, footer_text: e.target.value})} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-blue-500 ml-1">เบอร์โทรศัพท์ติดต่อ</label>
              <input type="text" className="w-full p-3 bg-white border border-blue-200 rounded-xl font-bold text-slate-700" value={formData.contact_phone} onChange={e => setFormData({...formData, contact_phone: e.target.value})} />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <label className="flex-1 p-4 bg-white border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer text-center text-slate-400 hover:border-brand-primary hover:text-brand-primary transition-all">
                <input type="file" className="hidden" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
                <div className="text-sm font-bold">{selectedFile ? selectedFile.name : 'แนบไฟล์ฉบับจริง (ถ้ามีอัปโหลดแล้ว)'}</div>
                <div className="text-[10px] opacity-60">รองรับ PDF, JPG, PNG</div>
             </label>
             <button type="button" onClick={() => printOutgoingDoc({...formData, content, attachments: attachmentsList.filter(a => a.trim() !== '')})} className="p-4 bg-slate-100 text-slate-600 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-200 transition-all">
                <Printer size={20} /> ดูตัวอย่าง
             </button>
          </div>

          {/* สวิตช์เสนอออนไลน์ */}
          <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 flex items-center justify-between">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-amber-800 uppercase tracking-widest flex items-center gap-1.5"><Send size={14} /> เสนอหนังสือส่งออนไลน์</h4>
              <p className="text-[10px] text-slate-500 font-medium">ส่งให้ผู้อำนวยการลงนามอนุมัติออนไลน์ผ่านระบบและแจ้งเตือนผ่าน LINE</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={formData.online_submit}
                onChange={e => setFormData({ ...formData, online_submit: e.target.checked })} 
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <button type="submit" disabled={isSaving} className="w-full bg-brand-primary text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-xl shadow-green-100 hover:scale-[1.02] active:scale-95 transition-all">
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />} บันทึกข้อมูลและออกเลข
          </button>
        </form>
      </Modal>

      {/* โมดอลพิจารณาลงนามอนุมัติหนังสือส่งออนไลน์สำหรับ ผอ. */}
      <Modal isOpen={isApprovalModalOpen} onClose={() => setIsApprovalModalOpen(false)} title="ลงนามอนุมัติหนังสือส่งออนไลน์">
        <form onSubmit={handleApprovalSubmit} className="space-y-4 text-slate-700">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">รายละเอียดหนังสือส่ง</p>
            <div className="space-y-1">
              <div className="text-sm font-black text-slate-800">เรื่อง: {selectedDocForApproval?.subject}</div>
              <div className="text-xs font-bold text-slate-500">ถึง: {selectedDocForApproval?.to_agency}</div>
              <div className="text-xs font-bold text-slate-500">เลขที่หนังสือส่ง: {selectedDocForApproval?.doc_number}</div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 ml-1">ผลการพิจารณา</label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                type="button" 
                onClick={() => setDirectorDecision('ลงนามอนุมัติ')}
                className={`p-3 rounded-xl font-bold border-2 transition-all text-xs ${directorDecision === 'ลงนามอนุมัติ' ? 'bg-brand-primary border-brand-primary text-white' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                ✍️ อนุมัติและลงนามอิเล็กทรอนิกส์
              </button>
              <button 
                type="button" 
                onClick={() => setDirectorDecision('ส่งกลับแก้ไข')}
                className={`p-3 rounded-xl font-bold border-2 transition-all text-xs ${directorDecision === 'ส่งกลับแก้ไข' ? 'bg-red-500 border-red-500 text-white' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                ❌ ส่งกลับแก้ไข
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 ml-1">ความคิดเห็นเพิ่มเติม / คำแนะนำในการแก้ไข</label>
            <textarea 
              placeholder="พิมพ์ข้อความความคิดเห็นของ ผอ. ที่นี่..." 
              className="w-full p-4 bg-white border border-slate-200 rounded-xl font-bold text-slate-700" 
              rows={3} 
              value={directorOpinion} 
              onChange={e => setDirectorOpinion(e.target.value)} 
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button 
              type="button" 
              onClick={() => setIsApprovalModalOpen(false)} 
              className="w-full bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm"
            >
              ยกเลิก
            </button>
            {directorDecision === 'ลงนามอนุมัติ' ? (
              <button 
                type="submit" 
                disabled={isSaving} 
                className="w-full bg-brand-primary text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-all text-sm flex items-center justify-center gap-1.5"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                ยืนยันการอนุมัติและลงนาม
              </button>
            ) : (
              <button 
                type="button" 
                onClick={handleApprovalReject} 
                disabled={isSaving} 
                className="w-full bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition-all text-sm flex items-center justify-center gap-1.5"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                ส่งกลับแก้ไข
              </button>
            )}
          </div>
        </form>
      </Modal>

      {/* Modal สำหรับอัปโหลดแนบไฟล์ย้อนหลัง */}
      <Modal isOpen={isAttachModalOpen} onClose={() => setIsAttachModalOpen(false)} title="📎 แนบไฟล์เอกสารย้อนหลัง (รายการจองเลข)">
        <form onSubmit={handleAttachReservedFile} className="space-y-4">
          {selectedDocForAttach && (
            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-xs space-y-1">
              <p className="font-bold text-amber-900">📌 เลขที่จอง: <span className="text-brand-primary">{selectedDocForAttach.doc_number}</span></p>
              <p className="font-bold text-slate-700">📄 เรื่อง: {selectedDocForAttach.subject}</p>
              <p className="text-slate-500">🏢 ถึง: {selectedDocForAttach.to_agency || '-'}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">เลือกไฟล์ PDF หรือรูปภาพฉบับสมบูรณ์:</label>
            <input 
              type="file" 
              accept=".pdf,image/*" 
              onChange={e => setAttachFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-brand-primary/10 file:text-brand-primary hover:file:bg-brand-primary/20 cursor-pointer"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button 
              type="button" 
              onClick={() => setIsAttachModalOpen(false)} 
              className="w-full bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm"
            >
              ยกเลิก
            </button>
            <button 
              type="submit" 
              disabled={isAttaching || !attachFile} 
              className="w-full bg-brand-primary text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-all text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isAttaching ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              ยืนยันการแนบไฟล์
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
