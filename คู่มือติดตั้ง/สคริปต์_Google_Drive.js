/**
 * =========================================================================
 * Google Apps Script (GAS) Smart Archiving & Auto-Organize Engine v2.0
 * สำหรับระบบบริหารจัดการข้อมูลโรงเรียน (School Admin System)
 * 
 * คุณสมบัติเด่น:
 * 1. แยกโฟลเดอร์ตาม "ปี พ.ศ." (เช่น ปี 2569) อัตโนมัติ
 * 2. แยกโฟลเดอร์ย่อยตาม "หมวดหมู่หนังสือ" (หนังสือรับ, หนังสือส่ง, คำสั่ง, ฯลฯ)
 * 3. มีระบบจัดระเบียบไฟล์เก่า (Auto-Organize) กวาดไฟล์เดิมเข้าโฟลเดอร์ใหม่ให้อัตโนมัติ 100%
 * 4. ลิงก์เดิมและ File ID ไม่เปลี่ยน ทำให้ลิงก์ใน Supabase และ Telegram เปิดได้ตามปกติ 100%
 * =========================================================================
 */

// ชื่อโฟลเดอร์หลักของระบบสารบรรณโรงเรียน
var ROOT_FOLDER_NAME = "สารบรรณอิเล็กทรอนิกส์ (SchoolAdminDocs)";

// แมปชื่อหมวดหมู่โฟลเดอร์ภาษาไทยที่สวยงามและเป็นระเบียบ
var CATEGORY_MAP = {
  'incoming': '01_หนังสือรับ',
  'outgoing': '02_หนังสือส่ง',
  'memos': '03_บันทึกข้อความ',
  'orders': '04_คำสั่งโรงเรียน',
  'reports': '05_รายงานผลการปฏิบัติงาน',
  'procurement': '06_จัดซื้อจัดจ้าง',
  'general': '07_เอกสารทั่วไป'
};

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // ── กรณีสั่ง: ย้ายและจัดระเบียบไฟล์เก่าทั้งหมดให้อัตโนมัติ ──
    if (data.action === 'organize') {
      var organizeReport = organizeExistingFiles();
      return createJsonResponse({
        status: 'success',
        message: 'จัดระเบียบไฟล์เก่าเข้าโฟลเดอร์ตามปี พ.ศ. และหมวดหมู่เรียบร้อยแล้วค่ะ 🌸',
        report: organizeReport
      });
    }
    
    // ── กรณีสั่ง: ลบไฟล์ (Delete Action) ──
    if (data.action === 'delete') {
      var fileId = data.fileId;
      if (!fileId) {
        return createJsonResponse({ status: 'error', message: 'กรุณาระบุ fileId ที่ต้องการลบ' });
      }
      var file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
      return createJsonResponse({ status: 'success', message: 'ย้ายไฟล์ลงถังขยะเรียบร้อยแล้ว' });
    }
    
    // ── กรณีสั่ง: อัปโหลดไฟล์ใหม่ (Upload Action) ──
    var base64Data = data.base64;
    var filename = data.filename;
    var mimeType = data.mimeType || 'application/pdf';
    var rawFolder = data.folder || 'incoming';
    var docYear = data.year || extractYearFromText(filename) || (new Date().getFullYear() + 543);
    
    if (!base64Data || !filename) {
      return createJsonResponse({ status: 'error', message: 'ข้อมูลไม่ครบถ้วน (ต้องการ base64, filename)' });
    }
    
    // 1. ถอดรหัสไฟล์จาก Base64 เป็น Binary Blob
    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, mimeType, filename);
    
    // 2. ค้นหาหรือสร้างโฟลเดอร์ตามลำดับชั้น: [Root] -> [ปี 2569] -> [01_หนังสือรับ]
    var targetFolder = getTargetCategoryFolder(docYear, rawFolder, filename);
    
    // 3. บันทึกไฟล์ลงในโฟลเดอร์เป้าหมาย
    var file = targetFolder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log("Domain restricted sharing: " + shareErr.toString());
    }
    
    return createJsonResponse({
      status: 'success',
      url: file.getUrl(),
      fileId: file.getId(),
      folderPath: ROOT_FOLDER_NAME + " / ปี " + docYear + " / " + targetFolder.getName()
    });
    
  } catch (error) {
    return createJsonResponse({ status: 'error', message: 'GAS Error: ' + error.toString() });
  }
}

// รองรับการทดสอบ หรือสั่งจัดระเบียบไฟล์ผ่านเบราว์เซอร์ตรงๆ
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  
  if (action === 'organize') {
    var report = organizeExistingFiles();
    return ContentService.createTextOutput("🌸 จัดระเบียบไฟล์เอกสารใน Google Drive เรียบร้อยแล้วค่ะ!\n\n" + JSON.stringify(report, null, 2))
      .setMimeType(ContentService.MimeType.TEXT);
  }
  
  return createJsonResponse({
    status: 'success',
    message: 'Google Apps Script Smart Archiving Engine is active and ready! 🌸',
    hint: 'พิมพ์ต่อท้าย URL ด้วย ?action=organize เพื่อสั่งจัดระเบียบไฟล์เก่าเข้าโฟลเดอร์อัตโนมัติ'
  });
}

/**
 * ฟังก์ชันค้นหาหรือสร้างโฟลเดอร์ตามโครงสร้าง:
 * สารบรรณอิเล็กทรอนิกส์ -> ปี 2569 -> 01_หนังสือรับ
 */
function getTargetCategoryFolder(docYear, rawFolder, filename) {
  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var yearFolderName = "ปี " + docYear;
  var yearFolder = getOrCreateFolder(rootFolder, yearFolderName);
  
  // จำแนกหมวดหมู่
  var categoryKey = 'general';
  var lowerRaw = (rawFolder || '').toLowerCase();
  var lowerFile = (filename || '').toLowerCase();
  
  if (lowerRaw.includes('incom') || lowerFile.startsWith('แนบ_') || lowerFile.includes('หนังสือรับ')) {
    categoryKey = 'incoming';
  } else if (lowerRaw.includes('outgo') || lowerFile.includes('หนังสือส่ง') || lowerFile.includes('ส่ง_')) {
    categoryKey = 'outgoing';
  } else if (lowerRaw.includes('memo') || lowerFile.includes('บันทึก')) {
    categoryKey = 'memos';
  } else if (lowerRaw.includes('order') || lowerFile.includes('คำสั่ง')) {
    categoryKey = 'orders';
  } else if (lowerRaw.includes('report') || lowerFile.includes('รายงาน')) {
    categoryKey = 'reports';
  } else if (lowerRaw.includes('procure') || lowerFile.includes('พัสดุ') || lowerFile.includes('จัดซื้อ')) {
    categoryKey = 'procurement';
  }
  
  var categoryFolderName = CATEGORY_MAP[categoryKey] || '07_เอกสารทั่วไป';
  return getOrCreateFolder(yearFolder, categoryFolderName);
}

/**
 * สร้างหรือดึงโฟลเดอร์ย่อยอย่างปลอดภัย
 */
function getOrCreateFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

/**
 * ดึงตัวเลขปี พ.ศ. จากชื่อไฟล์ (เช่น 2568, 2569)
 */
function extractYearFromText(text) {
  if (!text) return null;
  var match = text.match(/25[5-7][0-9]/); // จับปี 2550 - 2579
  if (match) return match[0];
  return null;
}

/**
 * 🚀 ฟังก์ชันจัดระเบียบไฟล์ที่มีอยู่เดิมทั้งหมด (Auto-Organize Migration)
 * สามารถกดรันจากใน Apps Script Editor หรือเรียกผ่าน ?action=organize
 */
function organizeExistingFiles() {
  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var foldersToCheck = [
    rootFolder,
    DriveApp.getRootFolder() // ค้นหาโฟลเดอร์ SchoolAdminDocs เก่า
  ];
  
  // ตรวจสอบโฟลเดอร์เก่าชื่อ SchoolAdminDocs หรือ incoming
  var legacyFolders = DriveApp.getFoldersByName('SchoolAdminDocs');
  while (legacyFolders.hasNext()) {
    foldersToCheck.push(legacyFolders.next());
  }
  var incomingFolders = DriveApp.getFoldersByName('incoming');
  while (incomingFolders.hasNext()) {
    foldersToCheck.push(incomingFolders.next());
  }

  var movedCount = 0;
  var processedFileIds = {};

  for (var f = 0; f < foldersToCheck.length; f++) {
    var curFolder = foldersToCheck[f];
    var files = curFolder.getFiles();
    
    while (files.hasNext()) {
      var file = files.next();
      var fileId = file.getId();
      
      // ข้ามไฟล์ที่ประมวลผลไปแล้ว
      if (processedFileIds[fileId]) continue;
      processedFileIds[fileId] = true;
      
      var fileName = file.getName();
      // ข้ามหากไม่ใช่ไฟล์เอกสาร (PDF, รูปภาพ)
      if (!fileName.endsWith('.pdf') && !fileName.endsWith('.png') && !fileName.endsWith('.jpg') && !fileName.endsWith('.jpeg')) {
        continue;
      }
      
      // ตรวจหาปี พ.ศ. จากชื่อไฟล์ หรือ วันที่สร้างไฟล์
      var year = extractYearFromText(fileName);
      if (!year) {
        var createdDate = file.getDateCreated();
        year = createdDate.getFullYear() + 543;
      }
      
      // หาโฟลเดอร์หมวดหมู่ปลายทาง
      var destFolder = getTargetCategoryFolder(year, '', fileName);
      
      // ถ้าย้ายไม่ได้อยู่ในโฟลเดอร์ปลายทางอยู่แล้ว ให้สั่งย้าย
      var parentFolders = file.getParents();
      var alreadyInDest = false;
      while (parentFolders.hasNext()) {
        if (parentFolders.next().getId() === destFolder.getId()) {
          alreadyInDest = true;
          break;
        }
      }
      
      if (!alreadyInDest) {
        file.moveTo(destFolder);
        movedCount++;
      }
    }
  }
  
  return {
    status: 'success',
    movedFilesCount: movedCount,
    message: 'ย้ายและจัดหมวดหมู่ไฟล์สำเร็จจำนวน ' + movedCount + ' ไฟล์'
  };
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

