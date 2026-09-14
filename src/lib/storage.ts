import { supabase, getActiveSchoolProfile } from './supabase';

function getGasUrl(): string {
  const profile = getActiveSchoolProfile();
  return profile?.gasUrl || 
         (typeof window !== 'undefined' ? localStorage.getItem('custom_gas_url') : null) || 
         import.meta.env.VITE_GAS_URL || 
         'https://script.google.com/macros/s/AKfycbzvITJ2HwYAB3tlDDbnjv52b97goxigd2KzNGSIu3jfnlNIpZyNB4hC2nCg_0lxek9E/exec';
}

/**
 * Uploads a file to Supabase Storage (Temporary Staging)
 */
export async function uploadToSupabase(file: File | Blob, bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true
  });

  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return publicUrl;
}

/**
 * Deletes a file from Supabase Storage
 */
export async function deleteFromSupabase(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.warn('Supabase delete error:', error);
}

/**
 * Basic upload for legacy support
 */
export async function uploadFile(file: File, bucket: string, folder: string = ''): Promise<string> {
  return uploadFileToDrive(file, folder || bucket, file.name.split('.')[0]);
}

/**
 * Uploads a file to Google Drive via GAS with smart naming.
 * พร้อมระบบ Auto-Fallback อัจฉริยะ: หาก Google Apps Script ส่ง HTTP 404 หรือไม่พร้อมใช้งาน
 * ระบบจะสลับไปบันทึกบน Supabase Storage ทันที เพื่อป้องกันไม่ให้การบันทึกหนังสือสะดุดล้มเหลว
 */
export async function uploadFileToDrive(
  file: File, 
  folder: string, 
  customName: string,
  docDateOrYear?: string | number
): Promise<string> {
  const gasUrl = getGasUrl();

  // คำนวณปี พ.ศ. จาก "วันที่ลงรับหนังสือ" เสมอ
  let targetYear = new Date().getFullYear() + 543;
  if (typeof docDateOrYear === 'number') {
    targetYear = docDateOrYear;
  } else if (typeof docDateOrYear === 'string' && docDateOrYear.trim()) {
    const parsedDate = new Date(docDateOrYear);
    if (!isNaN(parsedDate.getTime())) {
      const y = parsedDate.getFullYear();
      targetYear = y > 2400 ? y : y + 543;
    }
  }

  // 1. พยายามอัปโหลดขึ้น Google Drive ผ่าน Google Apps Script ก่อน
  if (gasUrl && !gasUrl.includes('YOUR_GAS_URL')) {
    try {
      const gDriveUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const fileExt = file.name.split('.').pop() || 'pdf';
          const finalFilename = `${customName}.${fileExt}`;
          
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 วินาที Timeout สำหรับไฟล์ PDF ขนาดใหญ่

            const response = await fetch(gasUrl, {
              method: 'POST',
              signal: controller.signal,
              body: JSON.stringify({
                folder: folder,
                filename: finalFilename,
                mimeType: file.type || 'application/pdf',
                base64: base64,
                year: targetYear,
                doc_date: docDateOrYear || new Date().toISOString().split('T')[0]
              })
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              return reject(new Error(`HTTP ${response.status}`));
            }

            const result = await response.json();
            if (result.status === 'success' && result.url) {
              resolve(result.url);
            } else {
              reject(new Error(result.message || 'GAS Upload response status not success'));
            }
          } catch (fetchErr) {
            reject(fetchErr);
          }
        };
        reader.onerror = (error) => reject(error);
      });

      if (gDriveUrl) return gDriveUrl;
    } catch (gasErr: any) {
      console.warn('[STORAGE] Google Apps Script upload failed (HTTP 404/Timeout). Seamlessly falling back to Supabase Storage...', gasErr);
    }
  }

  // 2. Auto-Fallback: หาก Google Apps Script ล้มเหลว (เช่น HTTP 404 หรือปิดกั้นสิทธิ์) ให้สลับไปจัดเก็บบน Supabase Storage ทันที
  try {
    const fileExt = file.name.split('.').pop() || 'pdf';
    const fallbackPath = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const supabaseUrl = await uploadToSupabase(file, 'temp_docs', fallbackPath);
    console.log('[STORAGE] Supabase Storage fallback successful:', supabaseUrl);
    return supabaseUrl;
  } catch (supabaseErr: any) {
    console.error('[STORAGE] Both Google Drive and Supabase Storage upload failed:', supabaseErr);
    throw new Error(`ไม่สามารถจัดเก็บไฟล์ได้ทั้ง Google Drive และ Supabase (สาเหตุ: ${supabaseErr.message || 'Storage error'})`);
  }
}

/**
 * Deletes a file from Google Drive via GAS or Supabase Storage using its URL or ID.
 */
export async function deleteFileFromDrive(fileUrl: string): Promise<boolean> {
  if (!fileUrl) return true;
  
  // กรณีเป็นไฟล์บน Supabase Storage
  if (fileUrl.includes('supabase.co')) {
    try {
      const match = fileUrl.match(/\/temp_docs\/(.+)$/);
      if (match && match[1]) {
        await deleteFromSupabase('temp_docs', decodeURIComponent(match[1]));
        return true;
      }
    } catch (e) {
      console.warn('[STORAGE] Supabase remove warning:', e);
    }
  }

  // กรณีเป็นไฟล์บน Google Drive ผ่าน GAS
  try {
    const gasUrl = getGasUrl();
    if (!gasUrl) return true;

    let fileId = fileUrl;
    const match = fileUrl.match(/[-\w]{25,}/);
    if (match) fileId = match[0];

    const response = await fetch(gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'delete',
        fileId: fileId
      })
    });

    const result = await response.json();
    return result.status === 'success';
  } catch (err) {
    console.error('GAS Delete error:', err);
    return false;
  }
}

