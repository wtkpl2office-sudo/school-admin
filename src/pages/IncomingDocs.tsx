import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAccurateNextSequence } from '../lib/docSequence';
import { uploadFileToDrive, deleteFileFromDrive, uploadToSupabase, deleteFromSupabase } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import { sendLineNotification, sendInteractiveFlexMessage, sendBulkFlexCarousel } from '../lib/lineNotify';
import { sendTelegramNotification, getVercelBaseUrl, escapeHtml } from '../lib/telegramNotify';
import { applyDigitalStamps } from '../lib/pdfService';
import { summarizeDocument } from '../lib/aiService';
import { formatDateDMY } from '../lib/dateUtils';
import Modal from '../components/Modal';
import { DocVerificationBadge, DocVerificationCard } from '../components/DocVerificationCard';

import { 
  FilePlus, 
  Search, 
  FileText, 
  Loader2,
  Upload,
  Save,
  Paperclip,
  X,
  Trash2,
  UserCheck,
  Send,
  Sparkles,
  Shield
} from 'lucide-react';

const toArabic = (str: string) => {
  if (!str) return '';
  return str.replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d).toString());
};

export default function IncomingDocs() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const currentYearBE = new Date().getFullYear() + 543;
  const [selectedYear, setSelectedYear] = useState<number | null>(currentYearBE);
  const [latestNumber, setLatestNumber] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'pending' | 'deadline'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  const openNewDocModal = async () => {
    setIsModalOpen(true);
    const currentYear = new Date().getFullYear() + 543;
    try {
      const { data: setRes } = await supabase.from('settings').select('start_incoming_seq').limit(1).maybeSingle();
      const startSeq = setRes?.start_incoming_seq || 1;
      const nextSeq = await getAccurateNextSequence(supabase, 'incoming_docs', currentYear, startSeq);

      setFormData(prev => ({
        ...prev,
        doc_number: nextSeq.toString(),
        doc_date: new Date().toISOString().split('T')[0],
        stamp_page: 1
      }));
    } catch (e) {
      console.error('Failed to auto-generate doc sequence:', e);
    }
  };

  // Assignment Form State
  const [assignForm, setAssignForm] = useState({
    teacher_id: '',
    instruction: '',
    stamp_page: 1
  });

  const [formData, setFormData] = useState({
    doc_number: '',
    from_agency: '',
    subject: '',
    doc_date: new Date().toISOString().split('T')[0],
    sender_doc_number: '',
    sender_doc_date: '',
    urgency: 'ปกติ',
    action_deadline: '',
    remark: '',
    stamp_page: 1
  });

  const [proposalData, setProposalData] = useState({
    summary: '',
    proposal: 'เพื่อโปรดพิจารณา'
  });

  const [mainFile, setMainFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isHolding, setIsHolding] = useState(false);
  const [selectedHoldingIds, setSelectedHoldingIds] = useState<string[]>([]);
  const [isReserveMode, setIsReserveMode] = useState(false);
  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [selectedDocToAttach, setSelectedDocToAttach] = useState<any>(null);
  const [attachFile, setAttachFile] = useState<File | null>(null);

  // AI Auto-Scan State
  const [isScanningAI, setIsScanningAI] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<{ count: number; total: number } | null>(null);
  const [suggestedTeacherId, setSuggestedTeacherId] = useState<string>('');
  const [suggestedTeacherName, setSuggestedTeacherName] = useState<string>('');

  useEffect(() => { 
    fetchDocs(); 

    fetchTeachers();
  }, []);

  async function fetchDocs(yearToFetch = selectedYear) {
    setLoading(true);
    try {
      let query = supabase.from('incoming_docs').select('*');
      
      if (yearToFetch) {
        query = query.eq('doc_year', yearToFetch);
      }
      
      const { data } = await query.order('created_at', { ascending: false });
      setDocs(data || []);
      
      // ดึงเลขล่าสุดของปีนี้มาโชว์
      if (yearToFetch) {
        const { data: latestSeqDoc } = await supabase
          .from('incoming_docs')
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeachers() {
    const { data } = await supabase.from('teachers').select('*').order('first_name');
    setTeachers(data || []);
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.teacher_id || !selectedDoc) return;
    setIsSaving(true);

    try {
      console.log('--- START FINAL RETIREMENT PROCESS ---');
      
      // 1. Re-stamp PDF with Director's Order
      if (assignForm.instruction && selectedDoc.file_url) {
        try {
          console.log('Fetching PDF for final stamping:', selectedDoc.file_url);
          
          const response = await fetch(selectedDoc.file_url);
          if (!response.ok) throw new Error(`ไม่สามารถดาวน์โหลดไฟล์ได้ (Status: ${response.status})`);
          
          const pdfBuffer = await response.arrayBuffer();
          const { data: setts } = await supabase.from('settings').select('school_name, director_name, director_signature_url').limit(1).maybeSingle();
 
          const schoolLabel = setts?.school_name 
            ? (setts.school_name.startsWith('โรงเรียน') ? setts.school_name : `โรงเรียน${setts.school_name}`)
            : '';
          const directorPosition = schoolLabel ? `ผู้อำนวยการ${schoolLabel}` : 'ผู้อำนวยการโรงเรียน';

          console.log('Applying Director Stamp...');
          const stampedBytes = await applyDigitalStamps(
            pdfBuffer,
            undefined, // Do NOT re-stamp receipt info
            undefined, // Do NOT re-stamp proposal info
            {
              order: assignForm.instruction,
              signer: setts?.director_name || 'ผู้อำนวยการโรงเรียน',
              position: directorPosition,
              date: new Date().toISOString().split('T')[0],
              signatureUrl: setts?.director_signature_url,
              pageNumber: assignForm.stamp_page // User selected page
            }
          );

          const sanitizedSubject = selectedDoc.subject.replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
          const finalFileName = `${selectedDoc.doc_number}_เรื่อง_${sanitizedSubject}.pdf`;
          const finalFile = new File([stampedBytes as any], finalFileName, { type: 'application/pdf' });
          
          console.log('Uploading FINAL document to Google Drive...');
          const gDriveUrl = await uploadFileToDrive(finalFile, 'incoming', finalFileName.replace('.pdf', ''));
          
          console.log('Updating database with final Google Drive link and status...');
          await supabase.from('incoming_docs').update({ 
            file_url: gDriveUrl,
            status: 'assigned' 
          }).eq('id', selectedDoc.id);
          
          // If it was on Supabase, try to clean up
          if (selectedDoc.file_url.includes('supabase.co')) {
            try {
              const tempPath = selectedDoc.file_url.split('/').pop()?.split('?')[0];
              if (tempPath) await deleteFromSupabase('temp_docs', tempPath);
            } catch (de) { console.warn('Supabase cleanup failed:', de); }
          }
          
          selectedDoc.file_url = gDriveUrl;
          console.log('FINAL ARCHIVING SUCCESS');
        } catch (pdfErr: any) {
          console.error('FINAL STAMP FAILED:', pdfErr);
          await supabase.from('incoming_docs').update({ status: 'assigned' }).eq('id', selectedDoc.id);
          alert('แจ้งเตือน: ไม่สามารถประทับตรา ผอ. ได้ (สาเหตุ: ' + pdfErr.message + ') ระบบจะบันทึกเฉพาะข้อมูลการมอบหมาย');
        }
      } else {
        await supabase.from('incoming_docs').update({ status: 'assigned' }).eq('id', selectedDoc.id);
      }

      // 2. Insert Assignment
      const { data: insertedAssigns, error } = await supabase.from('doc_assignments').insert([{
        doc_id: selectedDoc.id,
        assignee_id: assignForm.teacher_id,
        instruction: assignForm.instruction,
        status: 'pending'
      }]).select();

      if (error) throw error;
      const insertedAssign = insertedAssigns?.[0];

      // Notify Teacher via LINE (with Fallback to Group)
      const teacher = teachers.find(t => t.id === assignForm.teacher_id);
      const teacherName = teacher ? `${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name}` : 'ครูผู้รับผิดชอบ';
      
      const lineActions = [
        { label: '📄 ดูเอกสารสั่งการ', type: 'uri' as const, uri: selectedDoc.file_url },
        { label: '✅ รับทราบงาน', type: 'postback' as const, data: `action=acknowledge&id=${insertedAssign?.id || ''}`, color: '#007AFF' }
      ];
      
      if (Array.isArray(selectedDoc.attachment_urls)) {
        selectedDoc.attachment_urls.forEach((url: string, i: number) => {
          if (lineActions.length < 10) {
            lineActions.push({ label: `📎 แนบ ${i + 1}`, type: 'uri' as const, uri: url });
          }
        });
      }

      let lineNotifyStatus = '';
      try {
        if (teacher?.line_user_id) {
          // ส่งตรงถึงครูผู้รับมอบหมาย
          const personalMsg = `เรื่อง: ${selectedDoc.subject}\nเลขที่: ${selectedDoc.doc_number}\nคำสั่งการ: ${assignForm.instruction || 'โปรดดำเนินการตามหนังสือฉบับนี้'}`;
          console.log(`[LINE NOTIFY] Sending to teacher: ${teacherName} (ID: ${teacher.line_user_id})`);
          const result = await sendInteractiveFlexMessage(teacher.line_user_id, '📌 มีงานมอบหมายถึงคุณครู', personalMsg, lineActions);
          if (result) {
            lineNotifyStatus = `✅ แจ้งเตือน LINE ถึง${teacherName}แล้ว`;
          } else {
            // ถ้าส่งตรงไม่สำเร็จ → Fallback ไปกลุ่ม
            console.warn('[LINE NOTIFY] Personal push failed, falling back to group...');
            const groupMsg = `ถึง: ${teacherName}\nเรื่อง: ${selectedDoc.subject}\nเลขที่: ${selectedDoc.doc_number}\nคำสั่งการ: ${assignForm.instruction || 'โปรดดำเนินการตามหนังสือฉบับนี้'}`;
            await sendInteractiveFlexMessage(undefined, '📢 มอบหมายงานใหม่', groupMsg, lineActions);
            lineNotifyStatus = `⚠️ ส่ง LINE ตรงไม่สำเร็จ → แจ้งผ่านกลุ่มแทนแล้ว`;
          }
        } else {
          // ครูไม่มี line_user_id → Fallback ส่งไปกลุ่มเลย
          console.warn(`[LINE NOTIFY] Teacher ${teacherName} has no line_user_id. Sending to group instead.`);
          const groupMsg = `ถึง: ${teacherName}\nเรื่อง: ${selectedDoc.subject}\nเลขที่: ${selectedDoc.doc_number}\nคำสั่งการ: ${assignForm.instruction || 'โปรดดำเนินการตามหนังสือฉบับนี้'}`;
          const result = await sendInteractiveFlexMessage(undefined, '📢 มอบหมายงานใหม่', groupMsg, lineActions);
          if (result) {
            lineNotifyStatus = `📣 ${teacherName}ยังไม่ผูก LINE → แจ้งผ่านกลุ่มแทนแล้ว`;
          } else {
            lineNotifyStatus = `❌ ไม่สามารถส่งแจ้งเตือน LINE ได้ (ไม่มี Group ID)`;
          }
        }
      } catch (lineErr: any) {
        console.error('[LINE NOTIFY ERROR]', lineErr);
        lineNotifyStatus = `❌ เกิดข้อผิดพลาดในการส่ง LINE: ${lineErr.message}`;
      }

      // ส่งการแจ้งเตือนทาง Telegram
      let telegramNotifyStatus = '';
      try {
        let telegramChatId = undefined;
        const { data: prof } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('email', teacher.email)
          .maybeSingle();

        if (prof?.telegram_chat_id) {
          telegramChatId = prof.telegram_chat_id;
        }

        // สกัดรายการสิ่งที่ส่งมาด้วย (ไฟล์แนบ) สำหรับ Telegram
        let tgAttachLinksText = '';
        const rawAtts = selectedDoc.attachment_urls;
        let docAtts: string[] = [];
        if (Array.isArray(rawAtts)) {
          docAtts = rawAtts.filter(Boolean);
        } else if (typeof rawAtts === 'string') {
          try {
            const parsed = JSON.parse(rawAtts);
            if (Array.isArray(parsed)) docAtts = parsed.filter(Boolean);
          } catch {}
        }

        if (docAtts.length > 0) {
          tgAttachLinksText = '\n\n📎 <b>สิ่งที่ส่งมาด้วย (ไฟล์แนบ):</b>';
          docAtts.forEach((url: string, i: number) => {
            tgAttachLinksText += `\n  ${i + 1}. <a href="${url}">ไฟล์แนบที่ ${i + 1}</a>`;
          });
        }

        const docButtons: any[] = [];
        if (selectedDoc.file_url) {
          docButtons.push({ text: '📄 ดูเอกสารสั่งการ', url: selectedDoc.file_url });
        }
        if (docAtts.length > 0) {
          docAtts.slice(0, 2).forEach((url, i) => {
            docButtons.push({ text: `📎 แนบ ${i + 1}`, url });
          });
        }

        const telegramReplyMarkup = {
          inline_keyboard: [
            ...(docButtons.length > 0 ? [docButtons] : []),
            [
              { text: '✅ รับทราบงาน', callback_data: `action=acknowledge&id=${insertedAssign?.id || ''}` }
            ],
            [
              { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${insertedAssign?.id || ''}` },
              { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${insertedAssign?.id || ''}` }
            ]
          ]
        };

        const safeSubject = escapeHtml(selectedDoc.subject || '-');
        const safeDocNo = escapeHtml(selectedDoc.doc_number || '-');
        const safeInstruction = escapeHtml(assignForm.instruction || 'โปรดดำเนินการตามหนังสือฉบับนี้');
        const safeTeacherName = escapeHtml(teacherName || '-');

        if (telegramChatId) {
          // ส่งตรงถึงครูผู้รับมอบหมายทาง Telegram
          const telegramPersonalMsg = `📬 <b>มีงานมอบหมายใหม่ถึงคุณครูค่ะ</b>\n\n• <b>เรื่อง</b>: ${safeSubject}\n• <b>เลขที่รับ</b>: <code>${safeDocNo}</code>\n• <b>คำสั่งการ/แนวทาง</b>: ${safeInstruction}\n\n📄 <a href="${selectedDoc.file_url}">เปิดดูต้นฉบับเอกสารสั่งการ</a>${tgAttachLinksText}`;
          await sendTelegramNotification(telegramPersonalMsg, telegramChatId, telegramReplyMarkup);
          telegramNotifyStatus = ` และ Telegram ✅`;
        } else {
          // ส่งเข้ากลุ่ม Telegram ส่วนกลาง
          const telegramGroupMsg = `📢 <b>แจ้งมอบหมายงานใหม่</b>\n\n• <b>ถึงคุณครู</b>: <b>${safeTeacherName}</b>\n• <b>เรื่อง</b>: ${safeSubject}\n• <b>เลขที่รับ</b>: <code>${safeDocNo}</code>\n• <b>คำสั่งการ</b>: ${safeInstruction}\n\n📄 <a href="${selectedDoc.file_url}">เปิดดูต้นฉบับเอกสารสั่งการ</a>${tgAttachLinksText}`;
          await sendTelegramNotification(telegramGroupMsg, 'central', telegramReplyMarkup);
          telegramNotifyStatus = ' และส่งเข้ากลุ่ม Telegram ส่วนกลาง 📣';
        }
      } catch (tgErr: any) {
        console.error('[TELEGRAM NOTIFY ERROR]', tgErr);
        telegramNotifyStatus = ` (Telegram ล้มเหลว: ${tgErr.message})`;
      }

      alert(`เกษียณหนังสือและมอบหมายงานเรียบร้อยแล้ว\n\n${lineNotifyStatus}${telegramNotifyStatus}`);
      setIsAssignModalOpen(false);
      resetForm();
      fetchDocs();
    } catch (err: any) {
      alert('ดำเนินการไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const docToDelete = docs.find(d => d.id === id);
    const docDesc = docToDelete ? `เลขรับที่ ${docToDelete.doc_number} (เรื่อง: ${docToDelete.subject || '-'})` : 'ข้อมูลนี้';
    if (!confirm(`⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบ ${docDesc}?\n\nข้อมูลการลงรับและไฟล์เอกสารที่เกี่ยวข้องจะถูกลบออกจากระบบสารบรรณ`)) return;
    try {
      // 1. ลบรายการมอบหมายงานที่ผูกกับหนังสือนี้ก่อน เพื่อป้องกัน foreign key error
      await supabase.from('doc_assignments').delete().eq('doc_id', id);

      // 2. ลบไฟล์เอกสารใน Google Drive หรือ Supabase Storage
      const { data: doc } = await supabase.from('incoming_docs').select('file_url, attachment_urls').eq('id', id).maybeSingle();
      if (doc) {
        if (doc.file_url && typeof doc.file_url === 'string') {
          if (doc.file_url.includes('drive.google.com')) await deleteFileFromDrive(doc.file_url);
          else if (doc.file_url.includes('supabase.co')) {
             const path = doc.file_url.split('/').pop()?.split('?')[0];
             if (path) await deleteFromSupabase('temp_docs', path);
          }
        }
        if (Array.isArray(doc.attachment_urls)) {
          for (const url of doc.attachment_urls) {
            if (url && typeof url === 'string' && url.includes('drive.google.com')) {
              await deleteFileFromDrive(url);
            }
          }
        }
      }
      // 3. ลบแถวข้อมูลหนังสือรับ
      const { error } = await supabase.from('incoming_docs').delete().eq('id', id);
      if (error) throw error;
      alert(`ลบ ${docDesc} เรียบร้อยแล้วค่ะ`);
      fetchDocs();
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  }

  const handleAttachFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocToAttach || !attachFile) {
      alert('กรุณาเลือกไฟล์เอกสารที่ต้องการแนบ');
      return;
    }
    setIsSaving(true);
    try {
      const ext = attachFile.name.split('.').pop() || 'pdf';
      const pathStr = `doc_attached_${Date.now()}.${ext}`;
      const file_url = await uploadToSupabase(attachFile, 'incoming', pathStr);

      const { error } = await supabase.from('incoming_docs').update({
        file_url: file_url,
        is_reserved: false,
        status: 'pending'
      }).eq('id', selectedDocToAttach.id);

      if (error) throw error;

      alert('แนบไฟล์เอกสารย้อนหลังเรียบร้อยแล้ว');
      setIsAttachModalOpen(false);
      setSelectedDocToAttach(null);
      setAttachFile(null);
      fetchDocs();
    } catch (err: any) {
      alert('แนบไฟล์ไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const sanitized = formData.subject.replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
      const prefix = `${formData.doc_number}_เรื่อง_${sanitized}`;
      let file_url = '';

      if (mainFile) {
        let fileToStaging = mainFile;
        
        if (mainFile.type === 'application/pdf') {
          try {
            const buf = await mainFile.arrayBuffer();
            const timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            const stamped = await applyDigitalStamps(
              buf,
              { 
                docNumber: formData.doc_number, 
                date: formData.doc_date, 
                time: timeStr,
                pageNumber: formData.stamp_page 
              },
              { 
                summary: proposalData.summary || 'โปรดดูรายละเอียดตามหนังสือ', 
                proposal: proposalData.proposal, 
                signer: profile?.display_name || 'เจ้าหน้าที่ธุรการ', 
                date: formData.doc_date,
                signatureUrl: profile?.signature_url 
              }
            );
            fileToStaging = new File([stamped as any], mainFile.name, { type: 'application/pdf' });
          } catch (se) { console.error('Initial stamping failed:', se); }
        }

        console.log('Uploading to Supabase Staging...');
        // ตั้งชื่อไฟล์เป็นภาษาอังกฤษเพื่อป้องกันปัญหา Invalid Key จากชื่อไฟล์ภาษาไทยใน Supabase
        const fileExt = mainFile.name.split('.').pop() || 'pdf';
        const tempPath = `temp_${Date.now()}.${fileExt}`;
        file_url = await uploadToSupabase(fileToStaging, 'temp_docs', tempPath);
      }

      const att_urls = [];
      for (let i = 0; i < attachments.length; i++) {
        const url = await uploadFileToDrive(attachments[i], 'incoming', `แนบ_${prefix}_${i + 1}`);
        att_urls.push(url);
      }

      const docDateObj = new Date(formData.doc_date);
      const docYear = docDateObj.getFullYear() + 543;
      
      // หาเลข sequence จังหวะเซฟจริง
      const { data: seqData } = await supabase
        .from('incoming_docs')
        .select('doc_sequence')
        .eq('doc_year', docYear)
        .order('doc_sequence', { ascending: false })
        .limit(1);
      
      const docSeq = (seqData && seqData.length > 0) ? (Number(seqData[0].doc_sequence) + 1) : 1;
      const finalDocNum = formData.doc_number.trim() || docSeq.toString();

      const extraData = {
        sender_doc_number: toArabic(formData.sender_doc_number), // แปลงเลขไทย→อารบิกก่อนบันทึก
        sender_doc_date: formData.sender_doc_date,
        proposal_summary: proposalData.summary,
        proposal_text: proposalData.proposal,
        stamp_page: formData.stamp_page, // เก็บเลขหน้าประทับเสนอ
        suggested_teacher_id: suggestedTeacherId || null
      };

      const { data: insertedDocs, error } = await supabase.from('incoming_docs').insert([{
        doc_number: finalDocNum,
        from_agency: formData.from_agency,
        subject: formData.subject,
        doc_date: formData.doc_date,
        urgency: formData.urgency,
        action_deadline: formData.action_deadline ? new Date(formData.action_deadline).toISOString() : null,
        suggested_assignee_id: suggestedTeacherId || null,
        remark: JSON.stringify(extraData),
        file_url,
        attachment_urls: att_urls,
        status: isHolding ? 'waiting_proposal' : 'pending',
        created_by: user?.id,
        doc_year: docYear,
        doc_sequence: docSeq
      }]).select();

      if (error) throw error;
      const insertedDoc = insertedDocs?.[0];

      // สั่งประมวลผล OCR สกัดความจำ RAG ในพื้นหลังแบบ silent (ไม่ส่งแจ้งเตือน Telegram ซ้ำซ้อน)
      if (insertedDoc?.id && file_url) {
        const vercelUrl = getVercelBaseUrl();
        fetch(`${vercelUrl}/api/ocr-process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: insertedDoc.id, fileUrl: file_url, silent: true })
        }).catch(err => console.error('[AUTO OCR TRIGGER ERROR]', err));
      }

      // ปิดหน้าต่าง Modal และรีเฟรชรายการหนังสือทันที เพื่อความรวดเร็วสูงสุด (Instant UI Response)
      setIsModalOpen(false);
      resetForm();
      fetchDocs();
      setIsSaving(false);

      let lineNotifyStatus = '';
      if (!isHolding) {
        // 1. ส่งการแจ้งเตือนทาง LINE Interactive Flex Message
        let regMsg = `เรื่อง: ${formData.subject}\nจาก: ${formData.from_agency}\nเลขที่รับ: ${finalDocNum}`;
        if (proposalData.summary) {
          regMsg += `\n\nสรุป: ${proposalData.summary}`;
        }
        if (formData.action_deadline) {
          const dlStr = formatDateDMY(formData.action_deadline);
          regMsg += `\n⏰ กำหนดส่ง/จัดงาน: ${dlStr}`;
        }

        const regActions: any[] = [
          { label: '📄 ดูต้นฉบับหนังสือ', type: 'uri' as const, uri: file_url }
        ];

        if (Array.isArray(att_urls) && att_urls.length > 0) {
          att_urls.forEach((url, i) => {
            regActions.push({
              label: `📎 ไฟล์แนบที่ ${i + 1}`,
              type: 'uri' as const,
              uri: url,
              color: '#3F51B5'
            });
          });
        }

        regActions.push({ 
          label: '✍️ เกษียณสั่งการ', 
          type: 'postback' as const, 
          data: `action=start_assign&id=${insertedDoc?.id || ''}`, 
          color: '#1DB446' 
        });

        // 2. ส่งการแจ้งเตือนทาง Telegram (Unified Rich Card)
        const urgencyBadge = formData.urgency === 'ด่วนที่สุด' 
          ? '🔴 <b>[ด่วนที่สุด]</b>' 
          : formData.urgency === 'ด่วนมาก' 
            ? '🟠 <b>[ด่วนมาก]</b>' 
            : formData.urgency === 'ด่วน' 
              ? '🟡 <b>[ด่วน]</b>' 
              : '🟢 <b>[ปกติ]</b>';

        const safeFinalDocNum = escapeHtml(finalDocNum);
        const safeSubject = escapeHtml(formData.subject || '-');
        const safeFromAgency = escapeHtml(formData.from_agency || '-');
        const safeSenderDocNo = escapeHtml(formData.sender_doc_number || '-');
        const safeSummary = escapeHtml(proposalData.summary || '');
        const safeSuggestedName = escapeHtml(suggestedTeacherName || '');

        let telegramMsg = `📥 <b>เสนอหนังสือราชการเข้าใหม่ (รอเกษียณสั่งการ)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        telegramMsg += `${urgencyBadge} 📌 <b>เลขรับที่:</b> <code>${safeFinalDocNum}</code>\n`;
        telegramMsg += `📋 <b>เรื่อง:</b> <b>${safeSubject}</b>\n`;
        telegramMsg += `🏛️ <b>จาก:</b> ${safeFromAgency}\n`;
        if (formData.sender_doc_number || formData.sender_doc_date) {
          telegramMsg += `🔢 <b>เลขที่ผู้ส่ง:</b> <code>${safeSenderDocNo}</code> ${formData.sender_doc_date ? `(ลงวันที่ ${formatDateDMY(formData.sender_doc_date)})` : ''}\n`;
        }

        if (safeSummary) {
          telegramMsg += `\n✨ <b>สาระสำคัญ (เกษียณเสนอ):</b>\n<blockquote>${safeSummary}</blockquote>\n`;
        }

        if (formData.action_deadline) {
          const dlStr = formatDateDMY(formData.action_deadline);
          telegramMsg += `⏰ <b>กำหนดการ/ส่งงาน:</b> <u>${dlStr}</u>\n`;
        }

        if (safeSuggestedName) {
          telegramMsg += `🧑‍🏫 <b>ครูผู้รับงานที่แนะนำ:</b> <b>${safeSuggestedName}</b>\n`;
        }

        telegramMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        if (file_url) {
          telegramMsg += `📄 <a href="${file_url}"><b>[เปิดดูต้นฉบับหนังสือนำ]</b></a>`;
        }

        if (Array.isArray(att_urls) && att_urls.length > 0) {
          telegramMsg += `\n📎 <b>สิ่งที่ส่งมาด้วย (ไฟล์แนบ):</b>\n`;
          att_urls.forEach((url: string, i: number) => {
            telegramMsg += `   🔹 <a href="${url}">ไฟล์แนบที่ ${i + 1}</a>\n`;
          });
        }

        const telegramInlineButtons: any[] = [];
        if (suggestedTeacherId) {
          telegramInlineButtons.push([{
            text: `✅ มอบหมาย ${safeSuggestedName} ทันที`,
            callback_data: `action=sm_asg&id=${insertedDoc?.id || ''}`
          }]);
        }
        telegramInlineButtons.push([{
          text: `✍️ เกษียณสั่งการ / มอบหมาย`,
          callback_data: `action=start_assign&id=${insertedDoc?.id || ''}`
        }]);

        const telegramReplyMarkup = { inline_keyboard: telegramInlineButtons };

        // ส่งคู่ขนานทั้ง LINE และ Telegram
        const notifyTasks: Promise<any>[] = [
          sendInteractiveFlexMessage(
            undefined,
            '📥 เสนอหนังสือรอเกษียณ',
            regMsg,
            regActions
          ).catch(e => ({ failed: true, channel: 'LINE', error: e })),

          sendTelegramNotification(telegramMsg, 'proposal', telegramReplyMarkup)
            .catch(e => ({ failed: true, channel: 'Telegram', error: e }))
        ];

        const notifyResults = await Promise.allSettled(notifyTasks);
        let lineOk = true;
        let tgOk = true;
        notifyResults.forEach(r => {
          if (r.status === 'fulfilled' && (r.value as any)?.failed) {
            if ((r.value as any).channel === 'LINE') lineOk = false;
            if ((r.value as any).channel === 'Telegram') tgOk = false;
          } else if (r.status === 'rejected') {
            tgOk = false;
          }
        });

        let channelStatus = '';
        if (lineOk && tgOk) channelStatus = ' (LINE และ Telegram สำเร็จ ✅)';
        else if (lineOk) channelStatus = ' (LINE สำเร็จ)';
        else if (tgOk) channelStatus = ' (Telegram สำเร็จ)';

        alert(`ลงรับหนังสือและเสนอผู้บริหารเรียบร้อยแล้ว${channelStatus}`);
      } else {
        alert('ลงรับหนังสือเรียบร้อยแล้ว (พักรอเสนอผู้บริหาร)');
      }

    } catch (err: any) {
      alert(`บันทึกไม่สำเร็จ: ${err.message}`);
      setIsSaving(false);
    }
  }

  async function handleBulkPropose() {
    if (selectedHoldingIds.length === 0) return;
    if (selectedHoldingIds.length > 10) {
      alert('การส่ง Flex Carousel จำกัดสูงสุด 10 ฉบับต่อครั้ง เพื่อไม่ให้เกินข้อจำกัดของระบบ LINE');
      return;
    }
    
    const count = selectedHoldingIds.length;
    if (!confirm(`คุณต้องการเสนอหนังสือที่เลือกจำนวน ${count} ฉบับไปยังผู้บริหารพร้อมกันใช่หรือไม่?`)) return;
    
    const targetIds = [...selectedHoldingIds];
    const docsToPropose = docs.filter(d => targetIds.includes(d.id));

    setIsSaving(true);
    try {
      // 1. DB-First: อัปเดตสถานะใน Supabase เป็น 'pending' ทันที
      const { error: dbError } = await supabase
        .from('incoming_docs')
        .update({ status: 'pending' })
        .in('id', targetIds);

      if (dbError) throw dbError;

      // 2. Instant Optimistic UI: ปรับสถานะบนหน้าจอทันที (เปลี่ยนเป็น 'รอ ผอ. เกษียณ' เสี้ยววินาที)
      setDocs(prev => prev.map(d => targetIds.includes(d.id) ? { ...d, status: 'pending' } : d));
      setSelectedHoldingIds([]);
      setIsSaving(false);

      // 3. เตรียมข้อมูล Carousel และ Telegram สำหรับส่งแจ้งเตือนแบบคู่ขนาน (Concurrent Dispatch)
      const carouselItems = docsToPropose.map(d => ({
        id: d.id,
        subject: d.subject || '',
        from_agency: d.from_agency || '',
        doc_number: d.doc_number || '',
        file_url: d.file_url || '',
        attachment_urls: Array.isArray(d.attachment_urls)
          ? d.attachment_urls
          : (() => { try { const p = JSON.parse(d.attachment_urls); return Array.isArray(p) ? p : []; } catch { return []; } })()
      }));

      let telegramMsg = `📥 <b>เสนอหนังสือราชการรอเกษียณเข้าใหม่ (${docsToPropose.length} ฉบับ)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      docsToPropose.forEach((doc, idx) => {
        let summaryText = '';
        let senderDocNo = '';
        let senderDocDate = '';
        try {
          const rObj = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark || '{}');
          summaryText = rObj.proposal_summary || rObj.ai_summary || '';
          senderDocNo = rObj.sender_doc_number || '';
          senderDocDate = rObj.sender_doc_date || '';
        } catch {}

        const urgencyBadge = doc.urgency === 'ด่วนที่สุด' 
          ? '🔴 <b>[ด่วนที่สุด]</b>' 
          : doc.urgency === 'ด่วนมาก' 
            ? '🟠 <b>[ด่วนมาก]</b>' 
            : doc.urgency === 'ด่วน' 
              ? '🟡 <b>[ด่วน]</b>' 
              : '🟢 <b>[ปกติ]</b>';

        const safeSubject = escapeHtml(doc.subject || '-');
        const safeDocNo = escapeHtml(doc.doc_number || '-');
        const safeFrom = escapeHtml(doc.from_agency || '-');
        const safeSenderDocNo = escapeHtml(senderDocNo || '-');

        let safeSummary = escapeHtml(summaryText || '');
        if (safeSummary.length > 250) {
          safeSummary = safeSummary.substring(0, 247) + '...';
        }

        telegramMsg += `${idx + 1}. ${urgencyBadge} <b>เรื่อง:</b> <b>${safeSubject}</b>\n`;
        telegramMsg += `   • <b>เลขรับ:</b> <code>${safeDocNo}</code> | <b>จาก:</b> ${safeFrom}\n`;
        if (senderDocNo || senderDocDate) {
          telegramMsg += `   • <b>เลขที่ผู้ส่ง:</b> <code>${safeSenderDocNo}</code> ${senderDocDate ? `(ลงวันที่ ${formatDateDMY(senderDocDate)})` : ''}\n`;
        }
        if (safeSummary) {
          telegramMsg += `   ✨ <b>สาระสำคัญ:</b>\n<blockquote>${safeSummary}</blockquote>\n`;
        }
        if (doc.action_deadline) {
          telegramMsg += `   ⏰ <b>กำหนดส่ง/จัดงาน:</b> <u>${formatDateDMY(doc.action_deadline)}</u>\n`;
        }
        if (doc.file_url) {
          telegramMsg += `   📄 <a href="${doc.file_url}"><b>[เปิดดูต้นฉบับ]</b></a>`;
        }
        const docAtts = Array.isArray(doc.attachment_urls)
          ? doc.attachment_urls
          : (() => { try { const p = JSON.parse(doc.attachment_urls); return Array.isArray(p) ? p : []; } catch { return []; } })();

        if (docAtts.length > 0) {
          telegramMsg += ` | 📎 <b>ไฟล์แนบ:</b> `;
          docAtts.forEach((url: string, i: number) => {
            telegramMsg += `<a href="${url}">[แนบ ${i + 1}]</a> `;
          });
        }
        telegramMsg += `\n\n`;
      });
      
      const inlineButtons: any[] = [];
      const buttonList = docsToPropose.map(doc => ({
        text: `✍️ สั่งการที่ ${doc.doc_number}`,
        callback_data: `action=start_assign&id=${doc.id}`
      }));
      
      for (let i = 0; i < buttonList.length; i += 2) {
        inlineButtons.push(buttonList.slice(i, i + 2));
      }
      const telegramReplyMarkup = { inline_keyboard: inlineButtons };

      // 4. ส่งแจ้งเตือน LINE และ Telegram พร้อมกันโดยไม่บล็อกการทำงาน
      const notifyPromises: Promise<any>[] = [
        sendBulkFlexCarousel(
          undefined,
          `📥 เสนอหนังสือรอเกษียณใหม่ (${count} ฉบับ)`,
          carouselItems
        ).catch(err => ({ failed: true, channel: 'LINE', err })),
        
        sendTelegramNotification(telegramMsg, 'proposal', telegramReplyMarkup)
          .catch(err => ({ failed: true, channel: 'Telegram', err }))
      ];

      const results = await Promise.allSettled(notifyPromises);
      let lineSuccess = true;
      let telegramSuccess = true;

      results.forEach((res) => {
        if (res.status === 'fulfilled' && (res.value as any)?.failed) {
          if ((res.value as any).channel === 'LINE') lineSuccess = false;
          if ((res.value as any).channel === 'Telegram') telegramSuccess = false;
        } else if (res.status === 'rejected') {
          telegramSuccess = false;
        }
      });

      let statusFeedback = '';
      if (lineSuccess && telegramSuccess) {
        statusFeedback = ' (ส่ง LINE และ Telegram สำเร็จ ✅)';
      } else if (lineSuccess && !telegramSuccess) {
        statusFeedback = ' (ส่ง LINE สำเร็จ)';
      } else if (!lineSuccess && telegramSuccess) {
        statusFeedback = ' (ส่ง Telegram สำเร็จ)';
      }

      alert(`เสนอหนังสือจำนวน ${count} ฉบับไปยังผู้บริหารเรียบร้อยแล้ว${statusFeedback}`);
      fetchDocs();
    } catch (err: any) {
      alert('เสนอไม่สำเร็จ: ' + err.message);
      setIsSaving(false);
    }
  }

  function resetForm() {
    setFormData({ 
      doc_number: '', 
      from_agency: '', 
      subject: '', 
      doc_date: new Date().toISOString().split('T')[0], 
      sender_doc_number: '',
      sender_doc_date: '',
      urgency: 'ปกติ', 
      action_deadline: '',
      remark: '',
      stamp_page: 1
    });
    setProposalData({ summary: '', proposal: 'เพื่อโปรดพิจารณา' });
    setMainFile(null);
    setAttachments([]);
    setAssignForm({ teacher_id: '', instruction: '', stamp_page: 1 });
    setIsHolding(false);
    setIsScanningAI(false);
    setAiConfidence(null);
    setSuggestedTeacherId('');
    setSuggestedTeacherName('');
  }

  const handleAddAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (attachments.length + files.length > 4) { alert('จำกัดไฟล์แนบสูงสุด 4 ไฟล์'); return; }
    setAttachments([...attachments, ...files]);
  };

  const isDirector = profile?.role === 'director' || profile?.role === 'admin';
  const isAdmin = profile?.role === 'admin';
  const extraPerms = profile?.extra_permissions || {};
  const hasAccess = isDirector || extraPerms.access_administrative;

  async function performAIScan(fileToScan: File) {
    if (!fileToScan) return;
    setIsScanningAI(true);
    try {
      const { data: sets } = await supabase
        .from('settings')
        .select('gemini_api_key, ai_cowork_api_key')
        .limit(1)
        .maybeSingle();
      const rawApiKey = sets?.ai_cowork_api_key || sets?.gemini_api_key || '';
      const apiKey = rawApiKey.split(',')[0]?.trim();
      if (!apiKey) {
        console.warn('ยังไม่ได้ระบุ Gemini API Key ในการตั้งค่าระบบ');
        return;
      }
      const buffer = await fileToScan.arrayBuffer();
      const info = await summarizeDocument(buffer, apiKey);

      let score = 0;
      const total = 5;
      if (info.doc_number) score++;
      if (info.subject) score++;
      if (info.summary && info.summary !== 'ไม่สามารถสรุปเนื้อหาได้') score++;
      if (info.action_deadline) score++;

      // แมตช์คุณครูที่แนะนำจากชื่อฝ่ายหรือตำแหน่ง
      let matchedT: any = null;
      if (info.suggested_assignee_dept && teachers.length > 0) {
        const deptLower = info.suggested_assignee_dept.toLowerCase();
        matchedT = teachers.find(t =>
          (t.department && deptLower.includes(t.department.toLowerCase())) ||
          (t.position && deptLower.includes(t.position.toLowerCase()))
        );
      }
      if (matchedT) {
        score++;
        setSuggestedTeacherId(matchedT.id);
        setSuggestedTeacherName(`${matchedT.prefix || ''}${matchedT.first_name} ${matchedT.last_name}`);
      } else {
        setSuggestedTeacherId('');
        setSuggestedTeacherName('');
      }

      setAiConfidence({ count: score, total });

      if (info.summary && info.summary !== 'ไม่สามารถสรุปเนื้อหาได้') {
        setProposalData(prev => ({ ...prev, summary: info.summary }));
      }
      setFormData(prev => ({
        ...prev,
        sender_doc_number: info.doc_number || prev.sender_doc_number,
        sender_doc_date: info.doc_date || prev.sender_doc_date,
        from_agency: info.from_agency || prev.from_agency,
        subject: info.subject || prev.subject,
        urgency: info.urgency || prev.urgency,
        action_deadline: info.action_deadline || prev.action_deadline
      }));
    } catch (err: any) {
      console.warn('Auto AI Scan failed:', err);
    } finally {
      setIsScanningAI(false);
    }
  }

  async function handleAISummary() {
    if (!mainFile) { alert('กรุณาเลือกไฟล์หนังสือนำก่อน'); return; }
    await performAIScan(mainFile);
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] border border-slate-100 shadow-sm">
        <Shield size={64} className="text-red-200 mb-4" />
        <h3 className="text-xl font-black text-slate-800">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</h3>
        <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mt-1">กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เข้าใช้งานโมดูลนี้</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-2xl flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={20} />
            <input type="text" placeholder="ค้นหาหนังสือรับ..." className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-hidden shadow-xs" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
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
        {isDirector && (
          <button onClick={openNewDocModal} className="bg-brand-primary text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg active:scale-95 transition-all">
            <FilePlus size={20} /> ลงรับหนังสือใหม่
          </button>
        )}
      </div>

      {/* Quick Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 p-1.5 rounded-2xl w-fit">
        <button
          onClick={() => setFilterType('all')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            filterType === 'all' 
              ? 'bg-white text-slate-800 shadow-xs' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          ทั้งหมด ({docs.length})
        </button>
        <button
          onClick={() => setFilterType('pending')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            filterType === 'pending' 
              ? 'bg-red-500 text-white shadow-xs' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></span>
          รอ ผอ. เกษียณ ({docs.filter(d => d.status === 'pending').length})
        </button>
        <button
          onClick={() => setFilterType('deadline')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            filterType === 'deadline' 
              ? 'bg-amber-500 text-white shadow-xs' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          ⏰ ใกล้ครบกำหนด ({docs.filter(d => d.action_deadline && d.status !== 'completed' && d.status !== 'closed').length})
        </button>
      </div>

      {selectedHoldingIds.length > 0 && (
        <div className="mb-4 p-4 bg-purple-50 border border-purple-100 rounded-[24px] flex items-center justify-between animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-purple-500 rounded-full animate-ping"></span>
            <p className="text-sm font-black text-purple-950">เลือกหนังสือรอเสนอ {selectedHoldingIds.length} ฉบับ (จำกัดไม่เกิน 10 ฉบับ)</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSelectedHoldingIds([])} 
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
            >
              ยกเลิก
            </button>
            <button 
              onClick={handleBulkPropose} 
              disabled={isSaving || selectedHoldingIds.length > 10} 
              className="bg-purple-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md shadow-purple-100 hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              <Send size={12} /> เสนอ ผอ. พร้อมกัน (Flex Carousel)
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50/50 border-b border-slate-100">
            <tr>
              {hasAccess && <th className="w-12 px-4 py-4 text-center"></th>}
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เลขที่รับ / วันที่</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">เรื่อง</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">เอกสาร</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={hasAccess ? 5 : 4} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-brand-primary" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={hasAccess ? 5 : 4} className="py-20 text-center text-slate-400 italic">ไม่พบข้อมูลหนังสือรับ</td></tr>
            ) : (
              docs.filter(d => {
                if (filterType === 'pending' && d.status !== 'pending') return false;
                if (filterType === 'deadline' && (!d.action_deadline || d.status === 'completed' || d.status === 'closed')) return false;

                const term = toArabic(searchTerm.toLowerCase());
                const subj = toArabic(d.subject || '').toLowerCase();
                const docNo = toArabic(d.doc_number || '').toLowerCase();
                const agency = toArabic(d.from_agency || '').toLowerCase();
                let senderNum = '';
                if (d.remark) {
                  try {
                    const parsed = typeof d.remark === 'string' && d.remark.startsWith('{') ? JSON.parse(d.remark) : null;
                    senderNum = toArabic(parsed?.sender_doc_number || '').toLowerCase();
                  } catch (e) {}
                }
                return subj.includes(term) || docNo.includes(term) || agency.includes(term) || senderNum.includes(term);
              }).map(doc => (
                <tr key={doc.id} className="hover:bg-slate-50 transition-colors group">
                  {hasAccess && (
                    <td className="px-4 py-4 text-center">
                      {doc.status === 'waiting_proposal' && (
                        <input 
                          type="checkbox" 
                          checked={selectedHoldingIds.includes(doc.id)} 
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedHoldingIds([...selectedHoldingIds, doc.id]);
                            } else {
                              setSelectedHoldingIds(selectedHoldingIds.filter(id => id !== doc.id));
                            }
                          }}
                          className="w-4 h-4 text-brand-primary border-slate-300 rounded focus:ring-brand-primary/20 cursor-pointer"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4">
                    {(() => {
                      let displayReceiveNo = doc.doc_number;
                      let senderNum = '';

                      if (doc.remark) {
                        try {
                          const parsed = typeof doc.remark === 'string' && doc.remark.startsWith('{') ? JSON.parse(doc.remark) : null;
                          senderNum = parsed?.sender_doc_number || '';
                        } catch (e) {}
                      }

                      // รองรับข้อมูลเก่าที่เคยถูก OCR ทับ doc_number ด้วยเลข ศธ
                      if (doc.doc_number?.includes('ศธ') || (doc.doc_number?.includes('/') && !senderNum)) {
                        if (!senderNum) senderNum = doc.doc_number;
                        if (doc.doc_sequence) displayReceiveNo = String(doc.doc_sequence);
                      }

                      return (
                        <>
                          <div className="font-bold text-slate-800 text-sm">{toArabic(displayReceiveNo)}</div>
                          {senderNum && (
                            <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5" title="เลขที่หนังสือต้นทาง">
                              <span className="text-[10px] text-slate-400 font-normal">ที่:</span> {toArabic(senderNum)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="text-[10px] text-slate-400 mt-0.5">{formatDateDMY(doc.doc_date)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-700">{doc.subject}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">
                        {doc.status === 'reserved' || doc.is_reserved ? `จองโดย: ${doc.reserved_by_name || doc.from_agency || '-'}` : doc.from_agency}
                      </p>
                      {(doc.status === 'reserved' || doc.is_reserved) && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200" title="ขอจองเลขไว้ผ่าน Telegram (ยังไม่มีไฟล์เอกสาร)">
                          🟡 จองเลขแล้ว (รอไฟล์)
                        </span>
                      )}
                      {doc.status === 'pending' && !doc.is_reserved && (
                        <span className="flex items-center gap-1 text-[9px] font-medium text-red-500 bg-red-50/50 px-1.5 py-0.5 rounded-sm">
                          <div className="w-1 h-1 bg-red-400 rounded-full"></div>
                          รอ ผอ. เกษียณ
                        </span>
                      )}
                      {doc.status === 'waiting_proposal' && (
                        <span className="flex items-center gap-1 text-[9px] font-medium text-purple-500 bg-purple-50/50 px-1.5 py-0.5 rounded-sm">
                          <div className="w-1 h-1 bg-purple-400 rounded-full"></div>
                          รอเสนอผู้บริหาร
                        </span>
                      )}
                      {doc.action_deadline && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-sm border border-amber-200" title="กำหนดส่ง/หมดเขตดำเนินการ">
                          ⏰ กำหนดส่ง: {new Date(doc.action_deadline).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {doc.extracted_text && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-sm border border-emerald-200" title="ชบาบันทึกเนื้อหาลง RAG เรียบร้อยแล้ว">
                          🧠 ชบาจำเนื้อหาแล้ว
                        </span>
                      )}
                      <DocVerificationBadge doc={doc} />
                    </div>
                  </td>

                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-1.5">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" className="w-8 h-8 rounded-lg bg-green-50 text-brand-primary flex items-center justify-center hover:bg-green-100 transition-colors">
                          <FileText size={16} />
                        </a>
                      )}
                      {(Array.isArray(doc.attachment_urls)
                        ? doc.attachment_urls
                        : (() => { try { const p = JSON.parse(doc.attachment_urls); return Array.isArray(p) ? p : []; } catch { return []; } })()
                      ).map((url: string, idx: number) => (
                        <a key={idx} href={url} target="_blank" className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center hover:bg-blue-100 transition-colors">
                          <Paperclip size={14} />
                        </a>
                      ))}

                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {doc.file_url && (
                        <button onClick={async () => {
                          alert('🤖 เริ่มต้นกระบวนการสแกนอ่านเอกสาร สกัดกำหนดการ และแนะผู้รับงานอัตโนมัติเรียบร้อยแล้วค่ะ! ชบาจะส่งแจ้งเตือนทาง Telegram เมื่อสแกนเสร็จสิ้นนะคะ 🌸');
                          try {
                            const vercelUrl = getVercelBaseUrl();
                            await fetch(`${vercelUrl}/api/ocr-process`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ docId: doc.id, fileUrl: doc.file_url })
                            });
                            fetchDocs();
                          } catch (e: any) {
                            alert(`เกิดข้อผิดพลาด: ${e.message}`);
                          }
                        }} className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs" title="สแกนอ่านเอกสาร & วิเคราะห์กำหนดการอัตโนมัติ">
                          <Sparkles size={14} /> อ่านเนื้อหา
                        </button>
                      )}
                      {doc.status === 'pending' && isDirector && (
                        <button onClick={() => { 
                          setSelectedDoc(doc); 
                          let prevStampPage = 1;
                          if (doc.remark) {
                            try {
                              const extra = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark);
                              if (extra && extra.stamp_page) {
                                prevStampPage = parseInt(extra.stamp_page) || 1;
                              }
                            } catch (e) { console.warn('Failed to parse remark for stamp_page', e); }
                          }
                          setAssignForm({ teacher_id: '', instruction: '', stamp_page: prevStampPage });
                          setIsAssignModalOpen(true); 
                        }} className="p-2 text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors flex items-center gap-1.5 font-bold text-xs" title="เกษียณสั่งการ/มอบหมาย">
                          <UserCheck size={14} /> มอบหมายงาน
                        </button>
                      )}
                      {(doc.is_reserved || doc.status === 'reserved') && (
                        <button onClick={() => { setSelectedDocToAttach(doc); setIsAttachModalOpen(true); }} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-all font-bold text-xs flex items-center gap-1 shadow-xs" title="แนบไฟล์เอกสารย้อนหลัง">
                          <Paperclip size={14} /> แนบไฟล์
                        </button>
                      )}
                      {(isAdmin || isDirector || profile?.role === 'teacher' || doc.created_by === user?.id) && (
                        <button 
                          onClick={() => handleDelete(doc.id)} 
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" 
                          title="ลบหนังสือรับนี้"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>


      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="ลงรับหนังสือใหม่ (Smart Saraban)">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isReserveMode} 
                onChange={e => setIsReserveMode(e.target.checked)} 
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
              />
              <div>
                <span className="text-xs font-bold text-amber-900 block">🟡 จองเลขไว้ก่อน (ยังไม่มีไฟล์เอกสาร)</span>
                <span className="text-[10px] font-medium text-amber-700 block">เลือกหากต้องการขอเลขไว้ล่วงหน้าเพื่อนำไปพิมพ์เอกสาร สามารถแนบไฟล์ทีหลังได้</span>
              </div>
            </label>
          </div>

          {/* 1. ส่วนอัปโหลดเอกสาร (ย้ายขึ้นบนสุดเพื่อให้ AI สแกน Auto-fill ทันที) */}
          {!isReserveMode && (
            <div className="p-4 bg-gradient-to-r from-purple-50 via-indigo-50/40 to-blue-50/30 rounded-2xl border-2 border-purple-200/80 space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-600 animate-pulse" />
                  <h4 className="text-xs font-black text-purple-900 uppercase tracking-wide">1. อัปโหลดหนังสือนำ (AI Auto-Scan)</h4>
                </div>
                {isScanningAI ? (
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2.5 py-1 rounded-full animate-pulse flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> ชบากำลังอ่านเอกสาร...
                  </span>
                ) : aiConfidence ? (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full flex items-center gap-1">
                    ✨ AI สกัดสำเร็จ {aiConfidence.count}/{aiConfidence.total} ฟิลด์
                  </span>
                ) : null}
              </div>

              <label className={`block w-full p-4 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all ${mainFile ? 'border-brand-primary bg-green-50/60 shadow-xs' : 'border-purple-300 bg-white hover:border-purple-500 hover:bg-purple-50/30'}`}>
                <input 
                  type="file" 
                  accept=".pdf" 
                  className="hidden" 
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setMainFile(f);
                    if (f) performAIScan(f);
                  }} 
                />
                {mainFile ? (
                  <div className="flex items-center justify-center gap-2 text-brand-primary font-bold text-sm">
                    <FileText size={18} /> {mainFile.name}
                    <span className="text-[10px] text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full ml-2">พร้อมตรวจทาน</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload size={24} className="mx-auto text-purple-400" />
                    <span className="text-purple-700 text-xs font-bold block">ลากหรือคลิกเลือกไฟล์หนังสือนำ (PDF) เพื่อให้ AI สแกนเติมฟอร์มอัตโนมัติ</span>
                    <span className="text-slate-400 text-[10px] block">ระบบจะสกัดเลขที่ วันที่ หน่วยงาน สรุป และกำหนดการให้อัตโนมัติ</span>
                  </div>
                )}
              </label>

              {/* แสดงผลการแนะครูผู้รับงาน */}
              {suggestedTeacherName && (
                <div className="p-2.5 bg-white/80 rounded-xl border border-purple-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-900 flex items-center gap-1.5">
                    🧑‍🏫 <b>AI แนะนำผู้รับผิดชอบ:</b> <span className="text-purple-700">{suggestedTeacherName}</span>
                  </span>
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-md">ตรงตามฝ่าย</span>
                </div>
              )}

              {/* เอกสารแนบเพิ่มเติม */}
              <div className="space-y-2 pt-2 border-t border-purple-100">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Paperclip size={12} className="text-blue-500" /> เอกสารแนบ / สิ่งที่ส่งมาด้วย
                  </label>
                  <span className="text-[10px] font-bold text-slate-400">{attachments.length}/4 ไฟล์</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="relative group p-2 bg-white border border-blue-200 rounded-xl flex items-center gap-2 overflow-hidden shadow-xs">
                      <Paperclip size={14} className="text-blue-500 shrink-0" />
                      <span className="text-[10px] font-bold text-blue-700 truncate">{file.name}</span>
                      <button type="button" onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))} className="absolute right-1 top-1 p-1 bg-white rounded-md shadow-sm text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {attachments.length < 4 && (
                    <label className="border-2 border-dashed border-slate-200 bg-white/60 rounded-xl flex items-center justify-center py-2.5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all group">
                      <input type="file" className="hidden" multiple onChange={handleAddAttachment} />
                      <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-500 flex items-center gap-1">
                        <Paperclip size={12} /> เพิ่มไฟล์แนบ ({attachments.length + 1})
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. ข้อมูลการลงรับในระบบ */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5 col-span-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">เลขที่รับ</label>
              <input type="text" className="w-full p-3 bg-slate-50 border rounded-xl font-bold" required value={formData.doc_number} onChange={e => setFormData({...formData, doc_number: e.target.value})} />
            </div>
            <div className="space-y-1.5 col-span-1">
              <label className="text-[10px] font-black text-brand-primary uppercase ml-1">เกษียณเสนอที่หน้า</label>
              <input type="number" min="1" className="w-full p-3 bg-white border-2 border-brand-primary/20 rounded-xl font-black text-brand-primary text-center" required value={formData.stamp_page} onChange={e => setFormData({...formData, stamp_page: parseInt(e.target.value) || 1})} />
              <p className="text-[8px] text-slate-400 font-bold text-center mt-0.5">*เลขรับอยู่หน้า ๑ เสมอ</p>
            </div>
            <div className="space-y-1.5 col-span-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">วันที่ลงรับ</label>
              <input type="date" className="w-full p-3 bg-slate-50 border rounded-xl font-bold" required value={formData.doc_date} onChange={e => setFormData({...formData, doc_date: e.target.value})} />
            </div>
          </div>

          {/* 3. ข้อมูลในหนังสือ (จากต้นฉบับ) */}
          <div className="bg-blue-50/40 p-4 rounded-2xl border border-blue-100 space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">ข้อมูลในหนังสือ (จากต้นฉบับ)</h4>
              {mainFile && (
                <button type="button" onClick={handleAISummary} disabled={isScanningAI} className="flex items-center gap-1.5 text-[10px] font-bold text-purple-700 bg-white px-2.5 py-1 rounded-lg border border-purple-200 hover:bg-purple-600 hover:text-white transition-all shadow-xs disabled:opacity-50">
                  <Sparkles size={12} /> {isScanningAI ? 'กำลังสแกน...' : 'สแกนซ้ำด้วย AI'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">เลขที่หนังสือ (ผู้ส่ง)</label>
                <input type="text" className="w-full p-3 bg-white border rounded-xl font-medium" placeholder="เช่น ศธ 04225/..." value={formData.sender_doc_number} onChange={e => setFormData({...formData, sender_doc_number: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">วันที่ในหนังสือ</label>
                <input type="date" className="w-full p-3 bg-white border rounded-xl font-medium" value={formData.sender_doc_date} onChange={e => setFormData({...formData, sender_doc_date: e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">ความเร่งด่วน</label>
                <select 
                  className={`w-full p-3 bg-white border rounded-xl font-bold transition-all ${
                    formData.urgency === 'ด่วนที่สุด' 
                      ? 'border-red-400 text-red-700 bg-red-50/30' 
                      : formData.urgency === 'ด่วนมาก' 
                        ? 'border-orange-400 text-orange-700 bg-orange-50/30' 
                        : formData.urgency === 'ด่วน' 
                          ? 'border-amber-400 text-amber-700 bg-amber-50/30' 
                          : 'border-slate-200 text-slate-700'
                  }`} 
                  value={formData.urgency} 
                  onChange={e => setFormData({...formData, urgency: e.target.value})}
                >
                  <option value="ปกติ">🟢 ปกติ</option>
                  <option value="ด่วน">🟡 ด่วน</option>
                  <option value="ด่วนมาก">🟠 ด่วนมาก</option>
                  <option value="ด่วนที่สุด">🔴 ด่วนที่สุด</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-amber-700 uppercase ml-1 flex items-center gap-1">
                  ⏰ กำหนดส่งงาน / จัดงาน (Deadline)
                </label>
                <input type="date" className="w-full p-3 bg-white border-2 border-amber-300 rounded-xl font-bold text-amber-900 focus:ring-2 focus:ring-amber-200" value={formData.action_deadline} onChange={e => setFormData({...formData, action_deadline: e.target.value})} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">จากหน่วยงาน</label>
              <input type="text" className="w-full p-3 bg-white border rounded-xl font-medium" required value={formData.from_agency} onChange={e => setFormData({...formData, from_agency: e.target.value})} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">เรื่อง</label>
              <textarea className="w-full p-3 bg-white border rounded-xl font-medium" rows={2} required value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} />
            </div>
          </div>

          {/* 4. สรุปสาระสำคัญ (เกษียณเสนอ) */}
          <div className="p-4 bg-brand-primary/5 rounded-2xl border border-brand-primary/10 space-y-4">
             <div className="flex justify-between items-center">
                <h4 className="text-[10px] font-black text-brand-primary uppercase tracking-widest">สรุปสาระสำคัญ (เกษียณเสนอ)</h4>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-1">สรุปสาระสำคัญ (จะพิมพ์ลงตรายาง)</label>
                  <textarea className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:border-brand-primary" rows={2} placeholder="สรุปโดยเจ้าหน้าที่หรือ AI..." value={proposalData.summary} onChange={e => setProposalData({...proposalData, summary: e.target.value})} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-1">ข้อความเสนอ</label>
                  <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold" value={proposalData.proposal} onChange={e => setProposalData({...proposalData, proposal: e.target.value})} />
                </div>
             </div>
          </div>

          <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 border border-slate-100 rounded-2xl">
            <input 
              type="checkbox" 
              id="isHolding" 
              checked={isHolding} 
              onChange={e => setIsHolding(e.target.checked)}
              className="w-5 h-5 text-brand-primary border-slate-300 rounded focus:ring-brand-primary/20 cursor-pointer"
            />
            <label htmlFor="isHolding" className="text-xs font-black text-slate-700 cursor-pointer select-none">
              📥 พักหนังสือรอเสนอภายหลัง (ไม่ส่งแจ้งเตือน ผอ. ทันที)
            </label>
          </div>

          <button type="submit" disabled={isSaving || (!isReserveMode && !mainFile)} className="w-full bg-brand-primary text-white py-4.5 rounded-[24px] font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-green-100 hover:bg-green-700 transition-all disabled:opacity-50">
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />} {isReserveMode ? 'บันทึกจองเลขหนังสือ' : (isHolding ? 'บันทึกและพักรอเสนอ' : 'บันทึกและเสนอ ผอ. ทันที')}
          </button>
        </form>
      </Modal>

      <Modal isOpen={isAssignModalOpen} onClose={() => setIsAssignModalOpen(false)} title="เกษียณหนังสือและมอบหมายงาน">
        <form onSubmit={handleAssign} className="space-y-6">
          {selectedDoc && <DocVerificationCard doc={selectedDoc} compact={false} />}

          <div className="grid grid-cols-2 gap-4 bg-blue-50 p-4 rounded-2xl border border-blue-100">
             <div>
               <h4 className="text-sm font-black text-blue-800 mb-1">{selectedDoc?.subject}</h4>
               <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">เลขที่รับ: {selectedDoc?.doc_number}</p>
             </div>
             <div className="space-y-1">
               <label className="text-[10px] font-black text-brand-primary uppercase ml-1">ประทับตรา ผอ. ที่หน้า</label>
               <input type="number" min="1" className="w-full p-2 bg-white border-2 border-brand-primary/20 rounded-xl font-black text-brand-primary text-center" required value={assignForm.stamp_page} onChange={e => setAssignForm({...assignForm, stamp_page: parseInt(e.target.value) || 1})} />
             </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">คำสั่งการผู้อำนวยการ (จะประทับตราลงใน PDF)</label>
            <textarea className="w-full p-4 bg-white border border-brand-primary/20 rounded-2xl font-bold text-blue-800 outline-hidden focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all" rows={3} placeholder="เช่น มอบครู... ดำเนินการ, เห็นชอบตามเสนอ..." required value={assignForm.instruction} onChange={e => setAssignForm({...assignForm, instruction: e.target.value})} />
          </div>
          <div className="space-y-1.5 border-t pt-4">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">มอบหมายผู้ปฏิบัติในระบบ</label>
            <select className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-hidden focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary" required value={assignForm.teacher_id} onChange={e => setAssignForm({...assignForm, teacher_id: e.target.value})}>
              <option value="">-- กรุณาเลือกรายชื่อผู้ปฏิบัติ --</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.prefix}{t.first_name} {t.last_name} ({t.position})</option>)}
            </select>
          </div>
          <button type="submit" disabled={isSaving || !assignForm.teacher_id || !assignForm.instruction} className="w-full py-5 bg-slate-800 text-white rounded-[24px] font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-slate-200 hover:bg-slate-900 transition-all disabled:opacity-50">
            {isSaving ? <Loader2 className="animate-spin" /> : <Send />} ยืนยันเกษียณและส่งเข้า Google Drive
          </button>
          <p className="text-[9px] text-center text-slate-400 font-bold uppercase tracking-widest">ระบบจะนำไฟล์จากที่พักไฟล์มาประทับตราและส่งเข้า Drive อัตโนมัติ</p>
        </form>
      </Modal>

      <Modal isOpen={isAttachModalOpen} onClose={() => setIsAttachModalOpen(false)} title="แนบไฟล์เอกสารย้อนหลัง">
        <form onSubmit={handleAttachFileSubmit} className="space-y-4 text-slate-700">
          <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 space-y-2">
            <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider">รายละเอียดการจองเลข</h4>
            <p className="text-sm font-bold text-slate-800">เลขที่รับ: {selectedDocToAttach?.doc_number}</p>
            <p className="text-xs text-slate-600">เรื่อง: {selectedDocToAttach?.subject}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600">เลือกไฟล์เอกสาร (PDF หรือรูปภาพ)</label>
            <input 
              type="file" 
              accept=".pdf,image/*"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl"
              required
              onChange={e => setAttachFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button 
              type="button" 
              onClick={() => setIsAttachModalOpen(false)} 
              className="px-4 py-2 bg-slate-100 font-bold text-slate-600 rounded-xl hover:bg-slate-200"
            >
              ยกเลิก
            </button>
            <button 
              type="submit" 
              disabled={isSaving}
              className="px-5 py-2 bg-brand-primary text-white font-bold rounded-xl hover:bg-brand-primary/90 flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              บันทึกไฟล์แนบ
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
