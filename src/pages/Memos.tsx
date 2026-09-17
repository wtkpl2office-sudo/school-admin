import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { uploadFile, deleteFileFromDrive } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import { sendLineNotification, sendInteractiveFlexMessage } from '../lib/lineNotify';
import { sendTelegramNotification, escapeHtml } from '../lib/telegramNotify';
import { generateAIDraft } from '../lib/aiService';
import { formatDateDMY } from '../lib/dateUtils';
import Modal from '../components/Modal';
import { DocVerificationBadge, DocVerificationCard } from '../components/DocVerificationCard';
import { DocumentNumberingService } from '../services/documentNumberingService';

import { 
  Search, 
  ExternalLink,
  Loader2,
  Save,
  MessageSquare,
  Trash2,
  Printer,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Bot,
  Paperclip
} from 'lucide-react';
import garuda15mm from '../assets/saraban/garuda-1.5cm.png';

export default function Memos() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const currentYearBE = new Date().getFullYear() + 543;
  const [selectedYear, setSelectedYear] = useState<number | null>(currentYearBE);
  const [latestNumber, setLatestNumber] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [selectedMemoForApproval, setSelectedMemoForApproval] = useState<any>(null);
  const [directorDecision, setDirectorDecision] = useState<'อนุมัติ' | 'ทราบ'>('อนุมัติ');
  const [directorOpinion, setDirectorOpinion] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<any>(null);

  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [selectedDocForAttach, setSelectedDocForAttach] = useState<any>(null);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const [formData, setFormData] = useState({
    memo_number: '',
    subject: '',
    requester: '',
    department: '',
    memo_date: new Date().toISOString().split('T')[0],
    to_person: 'ผู้อำนวยการโรงเรียนบ้านควนโคกยา',
    content: '',
    closing_phrase: 'จึงเรียนมาเพื่อทราบ',
    sign_name: '',
    sign_position: '',
    online_submit: true,
    ai_key_points: '',
    show_director_opinion: false
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(() => { 
    fetchDocs(); 
    fetchSettings();
  }, []);

  async function fetchSettings() {
    const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
    if (data) {
      setSettings(data);
      setFormData(prev => ({
        ...prev,
        department: data.school_name || 'โรงเรียนบ้านควนโคกยา',
        sign_name: '',
        sign_position: 'ครูโรงเรียนบ้านควนโคกยา',
        to_person: `ผู้อำนวยการ${data.school_name || 'โรงเรียนบ้านควนโคกยา'}`
      }));
    }
  }

  async function fetchDocs(yearToFetch = selectedYear) {
    setLoading(true);
    try {
      let query = supabase.from('memos').select('*');
      if (yearToFetch) {
        query = query.eq('doc_year', yearToFetch);
      }
      const { data } = await query.order('created_at', { ascending: false });
      setDocs(data || []);
      
      if (yearToFetch) {
        const { data: latestSeqDoc } = await supabase
          .from('memos')
          .select('memo_number')
          .eq('doc_year', yearToFetch)
          .order('doc_sequence', { ascending: false })
          .limit(1);
        if (latestSeqDoc && latestSeqDoc.length > 0) {
          setLatestNumber(latestSeqDoc[0].memo_number);
        } else {
          setLatestNumber('');
        }
      } else if (data && data.length > 0) {
        setLatestNumber(data[0].memo_number);
      } else {
        setLatestNumber('');
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const isDirector = profile?.role === 'director' || profile?.role === 'admin';

  const getNextMemoNumber = (customDate = formData.memo_date) => {
    const docDateObj = new Date(customDate || new Date());
    const targetYear = docDateObj.getFullYear() + 543;
    
    let maxNum = 0;
    docs.forEach(d => {
      if (!d.doc_year || Number(d.doc_year) === Number(targetYear)) {
        if (d.doc_sequence && Number(d.doc_sequence) > maxNum) {
          maxNum = Number(d.doc_sequence);
        } else if (d.memo_number) {
          const match = d.memo_number.match(/^(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) {
              maxNum = num;
            }
          }
        }
      }
    });
    const startSeq = settings?.start_memo_seq || 1;
    const finalNext = Math.max(maxNum + 1, startSeq);
    return `${finalNext}/${targetYear}`;
  };

  async function handleStatusUpdate(id: string, newStatus: string) {
    try {
      const { error } = await supabase.from('memos').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      alert(`อัปเดตสถานะเป็น ${newStatus === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'} เรียบร้อยแล้ว`);
      fetchDocs();
    } catch (err: any) {
      alert('ไม่สามารถอัปเดตสถานะได้: ' + err.message);
    }
  }

  async function handleApprovalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMemoForApproval) return;
    setIsSaving(true);
    try {
      let extraData: any = {};
      try {
        if (selectedMemoForApproval.remark && selectedMemoForApproval.remark.startsWith('{')) {
          extraData = JSON.parse(selectedMemoForApproval.remark);
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
        show_director_opinion: true
      };

      const { error } = await supabase.from('memos').update({ 
        status: 'approved',
        remark: JSON.stringify(updatedExtraData)
      }).eq('id', selectedMemoForApproval.id);

      if (error) throw error;

      // ดึง line_user_id ของครูผู้เสนอ
      let requesterLineUserId = '';
      if (selectedMemoForApproval.created_by) {
        const { data: reqProfile } = await supabase
          .from('profiles')
          .select('line_user_id')
          .eq('id', selectedMemoForApproval.created_by)
          .maybeSingle();
        requesterLineUserId = reqProfile?.line_user_id || '';
      }

      // ส่ง LINE แจ้งเตือนครูผู้เสนอ
      const lineMessage = `\n✅ บันทึกข้อความได้รับการอนุมัติแล้ว\nเรื่อง: ${selectedMemoForApproval.subject}\nผลการพิจารณา: ${directorDecision}\nความเห็น ผอ.: ${directorOpinion || '-'}\n\nครูผู้เสนอสามารถพิมพ์เอกสารใบจริงที่มีลายเซ็น ผอ. ได้ในระบบ`;
      if (requesterLineUserId) {
        await sendLineNotification(lineMessage, requesterLineUserId);
      } else {
        await sendLineNotification(lineMessage);
      }

      // ส่ง Telegram แจ้งเตือนการอนุมัติบันทึกข้อความ
      try {
        const safeMemoNum = escapeHtml(selectedMemoForApproval.memo_number || '-');
        const safeSubj = escapeHtml(selectedMemoForApproval.subject || '-');
        const safeReq = escapeHtml(selectedMemoForApproval.requester || '-');
        let tgApprovedMsg = `✅ <b>อนุมัติลงนามบันทึกข้อความเรียบร้อยแล้ว</b>\n\n• <b>เลขที่บันทึก</b>: <code>${safeMemoNum}</code>\n• <b>เรื่อง</b>: ${safeSubj}\n• <b>ผู้เสนอ</b>: ${safeReq}`;
        if (selectedMemoForApproval.file_url) {
          tgApprovedMsg += `\n\n📄 <a href="${selectedMemoForApproval.file_url}">เปิดดูบันทึกข้อความฉบับสมบูรณ์</a>`;
        }
        await sendTelegramNotification(tgApprovedMsg, 'central');
      } catch (tgErr) {
        console.error('[TELEGRAM NOTIFY ERROR]', tgErr);
      }

      alert('บันทึกการอนุมัติและลายเซ็นเรียบร้อยแล้ว');
      setIsApprovalModalOpen(false);
      fetchDocs();
    } catch (err: any) {
      alert('ไม่สามารถบันทึกการอนุมัติได้: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApprovalReject() {
    if (!selectedMemoForApproval) return;
    setIsSaving(true);
    try {
      let extraData: any = {};
      try {
        if (selectedMemoForApproval.remark && selectedMemoForApproval.remark.startsWith('{')) {
          extraData = JSON.parse(selectedMemoForApproval.remark);
        }
      } catch (err) {}

      const updatedExtraData = {
        ...extraData,
        director_decision: 'ส่งกลับแก้ไข',
        director_opinion: directorOpinion,
        show_director_opinion: true
      };

      const { error } = await supabase.from('memos').update({ 
        status: 'rejected',
        remark: JSON.stringify(updatedExtraData)
      }).eq('id', selectedMemoForApproval.id);

      if (error) throw error;

      // ดึง line_user_id ของครูผู้เสนอ
      let requesterLineUserId = '';
      if (selectedMemoForApproval.created_by) {
        const { data: reqProfile } = await supabase
          .from('profiles')
          .select('line_user_id')
          .eq('id', selectedMemoForApproval.created_by)
          .maybeSingle();
        requesterLineUserId = reqProfile?.line_user_id || '';
      }

      // ส่ง LINE แจ้งเตือนไม่อนุมัติ
      const lineMessage = `\n❌ บันทึกข้อความ "ส่งกลับแก้ไข/ไม่อนุมัติ"\nเรื่อง: ${selectedMemoForApproval.subject}\nหมายเหตุ ผอ.: ${directorOpinion || '-'}\n\nกรุณาเข้าตรวจสอบและแก้ไขในระบบ`;
      if (requesterLineUserId) {
        await sendLineNotification(lineMessage, requesterLineUserId);
      } else {
        await sendLineNotification(lineMessage);
      }

      alert('บันทึกข้อมูลส่งกลับแก้ไขเรียบร้อยแล้ว');
      setIsApprovalModalOpen(false);
      fetchDocs();
    } catch (err: any) {
      alert('ล้มเหลว: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  const handleAIDraft = async () => {
    if (!formData.subject) {
      alert('กรุณาระบุชื่อเรื่องก่อนให้ AI ร่างข้อความครับ');
      return;
    }
    setIsDrafting(true);
    try {
      const prompt = `เขียนเนื้อหาบันทึกข้อความราชการ เรื่อง "${formData.subject}" โดยส่งถึง "${formData.to_person}" ${formData.ai_key_points ? `โดยมีใจความสำคัญคือ: "${formData.ai_key_points}"` : ''} ให้เขียนด้วยภาษาทางการ สละสลวย ตามระเบียบงานสารบรรณไทย เน้นเนื้อหาที่กระชับ ชัดเจน และเป็นมืออาชีพ โดยเน้นการบรรยายเนื้อหาใจความสำคัญ ห้ามมีคำลงท้าย (เช่น จึงเรียนมาเพื่อโปรดทราบ/พิจารณา) และห้ามใส่ส่วนลงลายมือชื่อ (ลงชื่อ/ตำแหน่ง) ท้ายข้อความเด็ดขาด เนื่องจากระบบจัดทำส่วนนี้แยกไว้แล้ว และห้ามใส่หัวเรื่อง เช่น 'บันทึกข้อความ', 'ส่วนราชการ', 'ที่', 'วันที่', 'เรื่อง', 'เรียน' มาในผลลัพธ์เด็ดขาด ให้เริ่มเนื้อความบรรยายโดยตรง`;
      const draft = await generateAIDraft(prompt);
      if (draft) {
        let cleanDraft = draft;
        // ทำความสะอาดหัวกระดาษบันทึกข้อความที่ AI อาจจะแถมมา
        cleanDraft = cleanDraft.replace(/^(บันทึกข้อความ|ส่วนราชการ|ที่|วันที่|เรื่อง|เรียน).*\n?/gim, '');

        // ทำความสะอาดคำลงท้ายและลายเซ็นที่ AI อาจแถมมา
        cleanDraft = cleanDraft.replace(/จึงเรียนมาเพื่อ.*/g, '');
        cleanDraft = cleanDraft.replace(/จึงเรียนเสนอมาเพื่อ.*/g, '');
        cleanDraft = cleanDraft.replace(/จึงเสนอมาเพื่อ.*/g, '');
        
        const sigIndex = cleanDraft.indexOf('(ลงชื่อ)');
        if (sigIndex !== -1) cleanDraft = cleanDraft.substring(0, sigIndex);
        
        const sigIndex2 = cleanDraft.indexOf('ลงชื่อ...');
        if (sigIndex2 !== -1) cleanDraft = cleanDraft.substring(0, sigIndex2);
        
        const sigIndex3 = cleanDraft.indexOf('ลงชื่อ .');
        if (sigIndex3 !== -1) cleanDraft = cleanDraft.substring(0, sigIndex3);

        cleanDraft = cleanDraft.replace(/จึงเรียนมาเพื่อทราบ/g, '');
        cleanDraft = cleanDraft.replace(/จึงเรียนมาเพื่อโปรดทราบ/g, '');
        cleanDraft = cleanDraft.replace(/จึงเรียนมาเพื่อพิจารณา/g, '');
        cleanDraft = cleanDraft.replace(/จึงเรียนมาเพื่อโปรดพิจารณา/g, '');
        cleanDraft = cleanDraft.trim();
        
        setFormData(prev => ({ ...prev, content: cleanDraft }));
      }
    } catch (err: any) {
      alert('AI Draft Error: ' + err.message);
    } finally {
      setIsDrafting(false);
    }
  };

  const printMemo = (doc: any) => {
    let extraData: any = {};
    try {
      if (doc.remark && doc.remark.startsWith('{')) {
        extraData = JSON.parse(doc.remark);
      }
    } catch (e) {}

    const data = { ...doc, ...extraData };
    const date = new Date(data.memo_date).toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const html = `
      <html>
        <head>
          <title>บันทึกข้อความ - ${data.memo_number}</title>
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
            }
            .memo-header {
              display: flex;
              align-items: flex-end;
              border-bottom: 2px solid black;
              padding-bottom: 5px;
              margin-bottom: 10px;
            }
            .garuda {
              width: 1.5cm;
              height: auto;
              margin-right: 10px;
            }
            .header-title {
              font-size: 29pt;
              font-weight: bold;
              line-height: 1;
            }
            .info-line {
              margin: 5px 0;
              display: flex;
            }
            .info-label {
              font-weight: bold;
              margin-right: 5px;
            }
            .info-date {
              position: absolute;
              left: 10.0cm;
              display: flex;
            }
            .content-text {
              margin-top: 0.4cm;
              line-height: 1.15;
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
              margin-top: 0.5cm;
              text-indent: 2.5cm;
              text-align: justify;
              font-size: 16pt;
            }
            .sig-block {
              margin-top: 1.5cm;
              margin-left: 7.8cm;
              width: 8cm;
            }
            .sig-name-block {
              text-align: center;
              margin-left: -4.8cm;
              line-height: 1.5;
            }
            @media print {
              body { background: white; }
              .page { margin: 0; box-shadow: none; width: 100%; height: 100%; }
              .no-print { display: none; }
            }
            .no-print-btn {
              position: fixed; top: 20px; right: 20px;
              background: #2563eb; color: white; border: none;
              padding: 12px 24px; border-radius: 12px; cursor: pointer;
              font-weight: bold; z-index: 9999;
            }
          </style>
        </head>
        <body>
          <button class="no-print-btn no-print" onclick="window.print()">🖨️ พิมพ์บันทึกข้อความ</button>
          <div class="page">
            <div class="memo-header" style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px solid black; padding-bottom: 5px; margin-bottom: 10px; height: 1.8cm;">
              <img src="${garuda15mm}" class="garuda" style="position: absolute; left: 0; bottom: 5px; width: 1.5cm; height: auto;" />
              <div class="header-title" style="font-size: 29pt; font-weight: bold; line-height: 1.8cm;">บันทึกข้อความ</div>
            </div>
            <div class="info-line">
              <div style="flex: 1; display: flex;"><span class="info-label">ส่วนราชการ</span> ${data.department || ''}</div>
            </div>
            <div class="info-line">
              <div style="flex: 1; display: flex;"><span class="info-label">ที่</span> ${data.memo_number || ''}</div>
              <div class="info-date"><span class="info-label">วันที่</span> ${date}</div>
            </div>
            <div class="info-line">
              <div style="flex: 1; display: flex;"><span class="info-label">เรื่อง</span> ${data.subject || ''}</div>
            </div>
            <div style="margin-top: 0.5cm;">
              <span class="info-label">เรียน</span> ${data.to_person || ''}
            </div>
            <div class="content-text">
              ${(data.content || '').split('\n').filter((p: string) => p.trim() !== '').map((p: string) => `<p>${p}</p>`).join('')}
            </div>

            ${data.closing_phrase ? `<div class="closing-phrase">${data.closing_phrase}</div>` : ''}
            
            <div class="sig-block">
              <div class="sig-name-block" style="position: relative;">
                ${(data.requester_signature_url || profile?.signature_url) ? `
                  <div style="position: absolute; left: calc(50% + 0.5cm); transform: translateX(-50%); top: -1.0cm; width: 3.5cm; height: 1.2cm; z-index: 10; pointer-events: none;">
                    <img src="${data.requester_signature_url || profile?.signature_url}" style="width: 100%; height: 100%; object-fit: contain;" />
                  </div>
                ` : ''}
                (ลงชื่อ)......................................................<br/>
                ( ${data.sign_name || data.requester || '................................................'} )<br/>
                ตำแหน่ง ${data.sign_position || '................................................'}
              </div>
            </div>

            ${data.show_director_opinion ? `
            <div style="margin-top: 1.5cm; display: flex; justify-content: flex-end; page-break-inside: avoid;">
              <div style="width: 10cm; font-size: 16pt; line-height: 1.6; box-sizing: border-box;">
                <div style="font-weight: bold; margin-bottom: 8px;">ความเห็น/คำสั่งผู้อำนวยการ</div>
                [ ${data.director_decision === 'ทราบ' ? '✓' : '&nbsp;'} ] ทราบ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; [ ${data.director_decision === 'อนุมัติ' ? '✓' : '&nbsp;'} ] อนุมัติ<br/>
                ความเห็นเพิ่มเติม ${data.director_opinion ? `<span style="font-family: 'THSarabunIT๙', 'TH Sarabun New', sans-serif;">${data.director_opinion}</span>` : '..........................................................................'}<br/>
                ${!data.director_opinion ? '......................................................................................................<br/>' : ''}
                <div style="text-align: center; margin-top: 0.5cm; line-height: 1.5; position: relative;">
                  ${(data.status === 'approved' && settings?.director_signature_url) ? `
                    <div style="position: absolute; left: calc(50% + 0.5cm); transform: translateX(-50%); top: -0.9cm; width: 3.5cm; height: 1.2cm; z-index: 10; pointer-events: none;">
                      <img src="${settings.director_signature_url}" style="width: 100%; height: 100%; object-fit: contain;" />
                    </div>
                  ` : ''}
                  (ลงชื่อ).......................................................<br/>
                  ( ${settings?.director_name || '................................................'} )<br/>
                  ผู้อำนวยการ${settings?.school_name || 'โรงเรียนบ้านควนโคกยา'}<br/>
                  วันที่ ${data.approved_date ? `<span style="font-family: 'THSarabunIT๙', 'TH Sarabun New', sans-serif;">${data.approved_date}</span>` : '......./......./.......'}
                </div>
              </div>
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
      const { data: doc } = await supabase.from('memos').select('file_url').eq('id', id).single();
      if (doc?.file_url) {
        await deleteFileFromDrive(doc.file_url);
      }
      const { error } = await supabase.from('memos').delete().eq('id', id);
      if (error) throw error;
      alert('ลบข้อมูลและไฟล์เรียบร้อยแล้ว');
      fetchDocs();
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  }

  async function handleAttachReservedFile(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDocForAttach || !attachFile) return;

    setIsAttaching(true);
    try {
      const sanitized = (selectedDocForAttach.subject || 'บันทึกข้อความ').replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
      const fileName = `บันทึกข้อความ_${selectedDocForAttach.memo_number}_เรื่อง_${sanitized}.pdf`;
      const fileUrl = await uploadFile(attachFile, 'memos', fileName.replace('.pdf', ''));

      const { error } = await supabase
        .from('memos')
        .update({
          file_url: fileUrl,
          is_reserved: false,
          status: 'pending'
        })
        .eq('id', selectedDocForAttach.id);

      if (error) throw error;

      alert('แนบไฟล์บันทึกข้อความย้อนหลังสำเร็จ!');
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
          file_url = await uploadFile(selectedFile, 'documents', 'memos');
        } catch (uploadErr: any) {
          throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ: ${uploadErr.message}`);
        }
      }

      const extraData = {
        to_person: formData.to_person,
        content: formData.content,
        closing_phrase: formData.closing_phrase,
        sign_name: formData.sign_name,
        sign_position: formData.sign_position,
        online_submit: formData.online_submit,
        show_director_opinion: formData.show_director_opinion,
        requester_signature_url: profile?.signature_url || ''
      };

      const docDateObj = new Date(formData.memo_date);
      const docYear = docDateObj.getFullYear() + 543;

      let docSeq: number;
      let finalMemoNumber = formData.memo_number.trim();
      let allocId: string | undefined;

      if (!finalMemoNumber) {
        // ขอเลขจากระบบออกเลขรวมศูนย์ (Unified Numbering Architecture) ป้องกันเลขชนกัน 100%
        const numRes = await DocumentNumberingService.reserveNumber({
          seriesCode: 'MEMO',
          docYear,
          title: formData.subject,
          requestedBy: user?.id,
          requestedByName: formData.requester || profile?.display_name,
          channel: 'web',
          autoIssue: true
        });
        docSeq = numRes.sequenceNumber;
        finalMemoNumber = numRes.formattedNumber;
        allocId = numRes.allocationId;
      } else {
        const { data: seqData } = await supabase
          .from('memos')
          .select('doc_sequence')
          .eq('doc_year', docYear)
          .order('doc_sequence', { ascending: false })
          .limit(1);
        const startSeq = settings?.start_memo_seq || 1;
        docSeq = (seqData && seqData.length > 0) ? Math.max(Number(seqData[0].doc_sequence) + 1, startSeq) : startSeq;
      }

      const { data: insertedDocs, error } = await supabase.from('memos').insert([{ 
        memo_number: finalMemoNumber,
        subject: formData.subject,
        requester: formData.requester,
        department: formData.department,
        memo_date: formData.memo_date,
        remark: JSON.stringify(extraData),
        file_url, 
        status: formData.online_submit ? 'pending' : 'approved',
        created_by: user?.id,
        doc_year: docYear,
        doc_sequence: docSeq
      }]).select();

      if (error) throw new Error(`บันทึกข้อมูลไม่สำเร็จ: ${error.message}`);
      const insertedDoc = insertedDocs?.[0];

      // ยืนยันการผูกเลขเอกสารกับตาราง memos
      if (allocId && insertedDoc?.id) {
        DocumentNumberingService.confirmNumber(allocId, 'memos', insertedDoc.id).catch(() => {});
      }

      // ดึงไลน์ ผอ. เพื่อเสนอตรง
      const { data: dirProfile } = await supabase
        .from('profiles')
        .select('line_user_id')
        .eq('role', 'director')
        .maybeSingle();

      if (formData.online_submit) {
        const lineMessage = `เรื่อง: ${formData.subject}\nผู้เสนอ: ${formData.requester}\nหน่วยงาน: ${formData.department}`;
        const lineActions: any[] = [
          { label: '✅ อนุมัติลงนาม', type: 'postback', data: `action=approve_doc&type=memo&id=${insertedDoc?.id || ''}`, color: '#1DB446' },
          { label: '❌ ส่งกลับแก้ไข', type: 'postback', data: `action=reject_doc&type=memo&id=${insertedDoc?.id || ''}`, color: '#FF3B30' }
        ];
        if (file_url) {
          lineActions.unshift({ label: '📄 ดูร่างบันทึก', type: 'uri', uri: file_url });
        }
        await sendInteractiveFlexMessage(
          dirProfile?.line_user_id || undefined,
          '⏳ เสนออนุมัติบันทึกข้อความ',
          lineMessage,
          lineActions
        );

        // ส่งการแจ้งเตือนทาง Telegram เข้ากลุ่มเสนอ / ผอ.
        try {
          const safeSubj = escapeHtml(formData.subject || '-');
          const safeReq = escapeHtml(formData.requester || '-');
          const safeDept = escapeHtml(formData.department || '-');
          const safeMemoNum = escapeHtml(finalMemoNumber || '-');

          const tgMsg = `📝 <b>เสนออนุมัติบันทึกข้อความเข้าใหม่</b>\n\n• <b>เรื่อง</b>: ${safeSubj}\n• <b>ผู้เสนอ</b>: ${safeReq}\n• <b>หน่วยงาน</b>: ${safeDept}\n• <b>เลขที่บันทึก</b>: <code>${safeMemoNum}</code>\n\n📄 <a href="${file_url || '#'}">เปิดดูร่างบันทึกข้อความ</a>`;
          const tgReplyMarkup = {
            inline_keyboard: [[
              { text: '✅ อนุมัติลงนาม (Telegram)', callback_data: `action=approve_doc&type=memo&id=${insertedDoc?.id || ''}` }
            ]]
          };
          await sendTelegramNotification(tgMsg, 'proposal', tgReplyMarkup);
        } catch (tgErr) {
          console.error('[TELEGRAM NOTIFY ERROR]', tgErr);
        }
      } else {
        const lineMessage = `เลขที่บันทึก: ${finalMemoNumber}\nเรื่อง: ${formData.subject}\nผู้เสนอ: ${formData.requester}`;
        const lineActions = file_url ? [{ label: '📄 ดูเอกสาร', type: 'uri' as const, uri: file_url }] : [];
        await sendInteractiveFlexMessage(
          undefined, // ส่งเข้ากลุ่ม
          '📝 บันทึกข้อความใหม่ (ลงทะเบียนตรง)',
          lineMessage,
          lineActions
        );

        try {
          const safeSubj = escapeHtml(formData.subject || '-');
          const safeReq = escapeHtml(formData.requester || '-');
          const safeMemoNum = escapeHtml(finalMemoNumber || '-');

          const tgMsg = `📝 <b>บันทึกข้อความใหม่ (ลงทะเบียนตรง)</b>\n\n• <b>เลขที่บันทึก</b>: <code>${safeMemoNum}</code>\n• <b>เรื่อง</b>: ${safeSubj}\n• <b>ผู้เสนอ</b>: ${safeReq}`;
          await sendTelegramNotification(tgMsg, 'central');
        } catch (tgErr) {
          console.error('[TELEGRAM NOTIFY ERROR]', tgErr);
        }
      }

      setIsModalOpen(false);
      resetForm();
      fetchDocs();
      alert('บันทึกบันทึกข้อความเรียบร้อยแล้ว');
    } catch (err: any) {
      console.error(err);
      alert(`ไม่สามารถบันทึกได้: ${err.message}`);
    } finally { setIsSaving(false); }
  }

  function resetForm() {
    setFormData({ 
      memo_number: getNextMemoNumber(), 
      subject: '', 
      requester: profile?.display_name || '', 
      department: settings?.school_name || 'โรงเรียน', 
      memo_date: new Date().toISOString().split('T')[0],
      to_person: `ผู้อำนวยการ${settings?.school_name || 'โรงเรียน'}`,
      content: '',
      closing_phrase: 'จึงเรียนมาเพื่อโปรดทราบและพิจารณาอนุมัติ',
      sign_name: profile?.display_name || '',
      sign_position: 'ครู',
      online_submit: true,
      ai_key_points: '',
      show_director_opinion: false
    });
    setSelectedFile(null);
    setIsDrafting(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-2xl flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
            <input type="text" placeholder="ค้นหาบันทึกข้อความ..." className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-hidden shadow-xs" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
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
            <div className="shrink-0 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-1.5 whitespace-nowrap shadow-xs h-[48px] flex items-center">
              <span className="text-[10px] font-black text-blue-500 uppercase tracking-tighter mr-1">ล่าสุด:</span>
              <span className="text-xs font-black text-blue-600 tracking-tight">{latestNumber}</span>
            </div>
          )}
        </div>
        <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="bg-brand-primary text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg active:scale-95 transition-all">
          <MessageSquare size={20} /> ออกเลขบันทึกข้อความ
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เลขที่ / วันที่</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เรื่อง</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">สถานะ</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={4} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-brand-primary" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={4} className="py-20 text-center text-slate-400 italic">ไม่พบข้อมูลบันทึกข้อความ</td></tr>
            ) : (
              docs.filter(d => d.subject.includes(searchTerm)).map(doc => (
                <tr key={doc.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-800 text-sm">{doc.memo_number}</div>
                    <div className="text-[10px] text-slate-400">{formatDateDMY(doc.memo_date)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-700">{doc.subject}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {doc.status === 'reserved' || doc.is_reserved ? `จองโดย: ${doc.reserved_by_name || doc.requester || '-'}` : `โดย: ${doc.requester || '-'}`}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {doc.status === 'reserved' || doc.is_reserved ? (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1">🟡 จองเลขแล้ว (รอไฟล์)</span>
                      ) : doc.status === 'approved' ? (
                        <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1"><CheckCircle size={12} /> อนุมัติแล้ว</span>
                      ) : doc.status === 'rejected' ? (
                        <span className="px-3 py-1 bg-red-50 text-red-600 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1"><XCircle size={12} /> ไม่อนุมัติ</span>
                      ) : (
                        <span className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase inline-flex items-center gap-1"><Clock size={12} /> รออนุมัติ</span>
                      )}
                      <DocVerificationBadge doc={doc} />
                    </div>
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
                        <>
                          <button onClick={() => { setSelectedMemoForApproval(doc); setDirectorDecision('อนุมัติ'); setDirectorOpinion(''); setIsApprovalModalOpen(true); }} className="p-2 text-green-500 hover:bg-green-50 rounded-lg transition-colors" title="พิจารณาอนุมัติ"><CheckCircle size={18} /></button>
                        </>
                      )}
                      <button onClick={() => printMemo(doc)} className="p-2 text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors" title="พิมพ์บันทึก"><Printer size={18} /></button>
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

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="ออกเลขบันทึกข้อความและสร้างเอกสาร">
        <form onSubmit={handleSave} className="space-y-4 max-h-[80vh] overflow-y-auto px-1 pb-4 text-slate-700">
          <div className="bg-slate-50 p-4 rounded-2xl space-y-4 border border-slate-100">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><FileText size={14} /> ข้อมูลหัวบันทึก</h4>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-10 h-6 rounded-full transition-all relative ${formData.online_submit ? 'bg-brand-primary' : 'bg-slate-200'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formData.online_submit ? 'left-5' : 'left-1'}`}></div>
                </div>
                <input type="checkbox" className="hidden" checked={formData.online_submit} onChange={e => setFormData({...formData, online_submit: e.target.checked})} />
                <span className="text-[10px] font-black text-slate-400 uppercase group-hover:text-brand-primary">เสนอออนไลน์</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">ส่วนราชการ</label>
                <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl" required value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">ที่</label>
                <input type="text" placeholder="เลขที่บันทึก" className="w-full p-3 bg-white border border-slate-200 rounded-xl" required value={formData.memo_number} onChange={e => setFormData({...formData, memo_number: e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">วันที่</label>
                <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-xl" required value={formData.memo_date} onChange={e => setFormData({...formData, memo_date: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 ml-1">เรื่อง</label>
                <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl" required value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 ml-1">เรียน</label>
              <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl" required value={formData.to_person} onChange={e => setFormData({...formData, to_person: e.target.value})} />
            </div>
          </div>

          <div className="bg-blue-50/30 p-4 rounded-2xl border border-blue-100/50 space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                <Bot size={14} /> รายละเอียดใจความสำคัญสำหรับ AI
              </label>
              <button 
                type="button" 
                onClick={handleAIDraft}
                disabled={isDrafting}
                className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 px-4 py-2 rounded-xl shadow-sm transition-all ${isDrafting ? 'bg-slate-100 text-slate-400' : 'bg-brand-primary text-white hover:bg-green-700 active:scale-95'}`}
              >
                {isDrafting ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                {isDrafting ? 'กำลังร่าง...' : 'สั่ง AI ร่างข้อความ'}
              </button>
            </div>
            <input 
              type="text" 
              placeholder="ระบุสิ่งที่ต้องการให้ AI เขียนเพิ่ม (เช่น แจ้งผลการแข่งขันทักษะวิชาการ ได้รับรางวัลระดับเหรียญทอง)" 
              className="w-full p-3 bg-white border border-blue-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-200 outline-hidden transition-all placeholder:text-slate-300"
              value={formData.ai_key_points}
              onChange={e => setFormData({...formData, ai_key_points: e.target.value})}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 ml-1 tracking-widest uppercase">เนื้อหาข้อความจริง</label>
            <textarea placeholder="เนื้อหาที่ AI ร่างจะปรากฏที่นี่..." className="w-full p-4 bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-brand-primary/10 outline-hidden transition-all" rows={8} value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} />
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl space-y-4 border border-slate-100">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><MessageSquare size={14} /> คำลงท้าย</h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                'จึงเรียนมาเพื่อทราบ',
                'จึงเรียนมาเพื่อโปรดทราบ',
                'จึงเรียนมาเพื่อพิจารณา',
                'จึงเรียนมาเพื่อโปรดพิจารณา'
              ].map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => setFormData({ ...formData, closing_phrase: phrase })}
                  className={`p-3 text-sm font-bold rounded-xl border-2 transition-all ${
                    formData.closing_phrase === phrase 
                      ? 'bg-brand-primary border-brand-primary text-white' 
                      : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                  }`}
                >
                  {phrase}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-50/50 p-4 rounded-2xl space-y-4 border border-blue-100/50">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2"><Save size={14} /> ข้อมูลผู้เสนอและลงนาม</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-blue-500 ml-1">ชื่อผู้เสนอ/ลงนาม</label>
                <input type="text" placeholder="เช่น นายสมชาย ใจดี" className="w-full p-3 bg-white border border-blue-200 rounded-xl" required value={formData.requester} onChange={e => {
                  setFormData({...formData, requester: e.target.value, sign_name: e.target.value});
                }} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-blue-500 ml-1">ตำแหน่ง</label>
                <input type="text" className="w-full p-3 bg-white border border-blue-200 rounded-xl" value={formData.sign_position} onChange={e => setFormData({...formData, sign_position: e.target.value})} />
              </div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl flex items-center justify-between border border-slate-100">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-slate-700">แสดงส่วนความเห็น/คำสั่ง ผอ. ท้ายเอกสาร</h4>
              <p className="text-[10px] text-slate-400">แสดงกล่องเสนอความเห็นและอนุมัติของผู้อำนวยการท้ายบันทึกข้อความ</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-10 h-6 rounded-full transition-all relative ${formData.show_director_opinion ? 'bg-brand-primary' : 'bg-slate-200'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formData.show_director_opinion ? 'left-5' : 'left-1'}`}></div>
              </div>
              <input type="checkbox" className="hidden" checked={formData.show_director_opinion} onChange={e => setFormData({...formData, show_director_opinion: e.target.checked})} />
            </label>
          </div>

          <div className="flex items-center gap-4">
             <label className="flex-1 p-4 bg-white border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer text-center text-slate-400 hover:border-brand-primary hover:text-brand-primary transition-all">
                <input type="file" className="hidden" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
                <div className="text-sm font-bold">{selectedFile ? selectedFile.name : 'แนบไฟล์ฉบับที่มีลายเซ็น (ถ้ามี)'}</div>
                <div className="text-[10px] opacity-60">รองรับ PDF, JPG, PNG</div>
             </label>
             <button type="button" onClick={() => printMemo(formData)} className="p-4 bg-slate-100 text-slate-600 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-200 transition-all">
                <Printer size={20} /> ดูตัวอย่าง
             </button>
          </div>

          <button type="submit" disabled={isSaving} className="w-full bg-brand-primary text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-xl shadow-green-100 hover:scale-[1.02] active:scale-95 transition-all">
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />} บันทึกข้อมูลและออกเลข
          </button>
        </form>
      </Modal>

      {/* ผอ. Approval Modal */}
      <Modal isOpen={isApprovalModalOpen} onClose={() => setIsApprovalModalOpen(false)} title="พิจารณาลงความเห็นและอนุมัติบันทึกข้อความ">
        <form onSubmit={handleApprovalSubmit} className="space-y-6">
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileText className="text-brand-primary" size={18} />
              ข้อมูลเอกสารที่เสนอ: {selectedMemoForApproval?.subject}
            </h4>
            <div className="text-xs font-bold text-slate-500 ml-1">
              ผู้เสนอ: {selectedMemoForApproval?.requester} ({selectedMemoForApproval?.department}) | เลขที่บันทึก: {selectedMemoForApproval?.memo_number}
            </div>
          </div>

          {selectedMemoForApproval && <DocVerificationCard doc={selectedMemoForApproval} compact={false} />}


          <div className="bg-slate-50 p-5 rounded-3xl space-y-4 border border-slate-100">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><MessageSquare size={14} /> การตัดสินใจของ ผอ.</h4>
            <div className="grid grid-cols-2 gap-3">
              {(['อนุมัติ', 'ทราบ'] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => setDirectorDecision(decision)}
                  className={`p-4 text-sm font-black rounded-2xl border-2 transition-all ${
                    directorDecision === decision 
                      ? 'bg-brand-primary border-brand-primary text-white shadow-lg shadow-green-100' 
                      : 'bg-white border-slate-100 text-slate-500 hover:border-slate-200'
                  }`}
                >
                  {decision === 'อนุมัติ' ? '✓ อนุมัติ' : '✓ ทราบ (แจ้งเพื่อทราบ)'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ความเห็นเพิ่มเติม / สั่งการ ผอ.</label>
            <textarea 
              placeholder="ระบุข้อความสั่งการหรือความเห็นเพิ่มเติมสำหรับพิมพ์ลงท้ายเอกสาร (เช่น อนุมัติให้ดำเนินการได้, มอบหมายงานการเงินเบิกจ่ายให้ถูกต้อง)..." 
              className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-brand-primary/10 outline-none transition-all" 
              rows={4} 
              value={directorOpinion} 
              onChange={e => setDirectorOpinion(e.target.value)} 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              type="button" 
              onClick={handleApprovalReject} 
              disabled={isSaving}
              className="w-full bg-red-50 text-red-500 py-4 rounded-2xl font-black text-sm hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              ✕ ส่งกลับแก้ไข / ไม่อนุมัติ
            </button>
            <button 
              type="submit" 
              disabled={isSaving}
              className="w-full bg-brand-primary text-white py-4 rounded-2xl font-black text-sm hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 shadow-xl shadow-green-100"
            >
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} ยืนยันการอนุมัติ
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal สำหรับอัปโหลดแนบไฟล์ย้อนหลัง */}
      <Modal isOpen={isAttachModalOpen} onClose={() => setIsAttachModalOpen(false)} title="📎 แนบไฟล์บันทึกข้อความย้อนหลัง (รายการจองเลข)">
        <form onSubmit={handleAttachReservedFile} className="space-y-4">
          {selectedDocForAttach && (
            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-xs space-y-1">
              <p className="font-bold text-amber-900">📌 เลขที่บันทึก: <span className="text-brand-primary">{selectedDocForAttach.memo_number}</span></p>
              <p className="font-bold text-slate-700">📄 เรื่อง: {selectedDocForAttach.subject}</p>
              <p className="text-slate-500">👤 ผู้เสนอ: {selectedDocForAttach.requester || '-'}</p>
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
