// =========================================================================
// Google Apps Script (GAS) Smart Archiving & Auto-Organize Engine v2.1
// ระบบบริหารจัดการข้อมูลโรงเรียน (School Admin System)
// โครงสร้างโฟลเดอร์: [สารบรรณอิเล็กทรอนิกส์] -> [ปี 2569] -> [01_หนังสือรับ]
// =========================================================================

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
        message: 'จัดระเบียบไฟล์เรียบร้อยแล้ว',
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
      return createJsonResponse({ status: 'error', message: 'ข้อมูลไม่ครบถ้วน' });
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
    return ContentService.createTextOutput("จัดระเบียบไฟล์เอกสารใน Google Drive เรียบร้อยแล้ว\n\n" + JSON.stringify(report, null, 2))
      .setMimeType(ContentService.MimeType.TEXT);
  }
  
  return createJsonResponse({
    status: 'success',
    message: 'Google Apps Script Smart Archiving Engine is active and ready!',
    hint: 'พิมพ์ต่อท้าย URL ด้วย ?action=organize เพื่อสั่งจัดระเบียบไฟล์เก่าเข้าโฟลเดอร์อัตโนมัติ'
  });
}

// ฟังก์ชันค้นหาหรือสร้างโฟลเดอร์ตามโครงสร้าง:
function getTargetCategoryFolder(docYear, rawFolder, filename) {
  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var yearFolderName = "ปี " + docYear;
  var yearFolder = getOrCreateFolder(rootFolder, yearFolderName);
  
  var categoryKey = 'general';
  var lowerRaw = (rawFolder || '').toLowerCase();
  var lowerFile = (filename || '').toLowerCase();
  
  // 1. คำสั่งโรงเรียน
  if (lowerRaw.indexOf('order') !== -1 || lowerFile.indexOf('คำสั่ง') !== -1) {
    categoryKey = 'orders';
  // 2. บันทึกข้อความ
  } else if (lowerRaw.indexOf('memo') !== -1 || lowerFile.indexOf('บันทึก') !== -1) {
    categoryKey = 'memos';
  // 3. หนังสือส่ง
  } else if (lowerRaw.indexOf('outgo') !== -1 || lowerFile.indexOf('หนังสือส่ง') !== -1 || lowerFile.indexOf('ส่ง_') === 0) {
    categoryKey = 'outgoing';
  // 4. รายงานผลการปฏิบัติงาน
  } else if (lowerRaw.indexOf('report') !== -1 || lowerFile.indexOf('รายงาน') !== -1) {
    categoryKey = 'reports';
  // 5. จัดซื้อจัดจ้าง / พัสดุ
  } else if (lowerRaw.indexOf('procure') !== -1 || lowerFile.indexOf('พัสดุ') !== -1 || lowerFile.indexOf('จัดซื้อ') !== -1) {
    categoryKey = 'procurement';
  // 6. หนังสือรับ (Incoming Docs):
  // ครอบคลุม: โฟลเดอร์ incoming / SchoolAdminDocs, ไฟล์แนบ, มีคำว่าหนังสือรับ,
  // หนังสือนำที่มีชื่อเรื่อง เช่น "822_เรื่อง_...", หรือขึ้นต้นด้วยเลขที่ เช่น "822_", "ว", "ศธ", "ที่"
  } else if (
    lowerRaw.indexOf('incom') !== -1 || 
    lowerRaw.indexOf('schooladmindocs') !== -1 || 
    lowerFile.indexOf('แนบ_') === 0 || 
    lowerFile.indexOf('หนังสือรับ') !== -1 || 
    lowerFile.indexOf('รับ_') === 0 ||
    lowerFile.indexOf('_เรื่อง_') !== -1 ||
    /^[0-9]+_/.test(lowerFile) ||
    /^[0-9]+$/.test(lowerFile.replace('.pdf', '')) ||
    /^[วศธท]/i.test(lowerFile)
  ) {
    categoryKey = 'incoming';
  }
  
  var categoryFolderName = CATEGORY_MAP[categoryKey] || '07_เอกสารทั่วไป';
  return getOrCreateFolder(yearFolder, categoryFolderName);
}

// สร้างหรือดึงโฟลเดอร์ย่อยอย่างปลอดภัย
function getOrCreateFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

// ดึงตัวเลขปี พ.ศ. จากชื่อไฟล์ (เช่น 2568, 2569)
function extractYearFromText(text) {
  if (!text) return null;
  var match = text.match(/25[5-7][0-9]/); // จับปี 2550 - 2579
  if (match) return match[0];
  return null;
}

// 🚀 ฟังก์ชันจัดระเบียบไฟล์ที่มีอยู่เดิมทั้งหมด (Auto-Organize Migration)
// แก้ไขปัญหา Timeout: จำกัดขอบเขตค้นหาเฉพาะโฟลเดอร์สารบรรณ และมี Time Guard 4 นาที
// สามารถกดรันจากใน Apps Script Editor หรือเรียกผ่าน ?action=organize
function organizeExistingFiles() {
  var startTime = new Date().getTime();
  var MAX_RUNTIME_MS = 240000; // 4 นาที (ปลอดภัย ป้องกัน Google 6-minute timeout)
  var timeLimitReached = false;

  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  
  // รวบรวมเฉพาะโฟลเดอร์สารบรรณเก่าเพื่อทำการย้าย (ไม่กวาดทั้งไดรฟ์เด็ดขาด)
  var foldersToProcess = [];
  
  // 1. ไฟล์ที่อาจหลงอยู่ในชั้นนอกสุดของ rootFolder
  foldersToProcess.push(rootFolder);
  
  // 2. ค้นหาโฟลเดอร์เก่าชื่อ SchoolAdminDocs
  var legacy1 = DriveApp.getFoldersByName('SchoolAdminDocs');
  while (legacy1.hasNext()) {
    var f = legacy1.next();
    if (f.getId() !== rootFolder.getId()) {
      foldersToProcess.push(f);
      var subFolders = f.getFolders();
      while (subFolders.hasNext()) {
        foldersToProcess.push(subFolders.next());
      }
    }
  }
  
  // 3. ค้นหาโฟลเดอร์เก่าชื่อ incoming, outgoing, orders, memos, reports
  var legacyNames = ['incoming', 'outgoing', 'orders', 'memos', 'reports', 'temp_docs'];
  for (var n = 0; n < legacyNames.length; n++) {
    var folIter = DriveApp.getFoldersByName(legacyNames[n]);
    while (folIter.hasNext()) {
      foldersToProcess.push(folIter.next());
    }
  }

  // 4. ตรวจสอบโฟลเดอร์ 07_เอกสารทั่วไป เพื่อดึงหนังสือนำที่เคยหลงเข้าไปกลับมาจัดใหม่
  var generalFolders = DriveApp.getFoldersByName('07_เอกสารทั่วไป');
  while (generalFolders.hasNext()) {
    foldersToProcess.push(generalFolders.next());
  }

  var movedCount = 0;
  var skippedCount = 0;
  var processedFileIds = {};

  for (var i = 0; i < foldersToProcess.length; i++) {
    if (timeLimitReached) break;
    
    var curFolder = foldersToProcess[i];
    var curFolderName = curFolder.getName();
    
    // ข้ามเฉพาะโฟลเดอร์ 01_ ถึง 06_ ที่จัดระเบียบถูกต้องแล้ว (ไม่ข้าม 07_ เพื่อตรวจสอบไฟล์หลงทาง)
    if (curFolderName.indexOf('01_') === 0 || curFolderName.indexOf('02_') === 0 || 
        curFolderName.indexOf('03_') === 0 || curFolderName.indexOf('04_') === 0 ||
        curFolderName.indexOf('05_') === 0 || curFolderName.indexOf('06_') === 0) {
      continue;
    }
    
    var files = curFolder.getFiles();
    while (files.hasNext()) {
      if (new Date().getTime() - startTime > MAX_RUNTIME_MS) {
        timeLimitReached = true;
        break;
      }
      
      var file = files.next();
      var fileId = file.getId();
      
      if (processedFileIds[fileId]) continue;
      processedFileIds[fileId] = true;
      
      var fileName = file.getName();
      // ข้ามหากไม่ใช่ไฟล์เอกสารหรือรูปภาพ
      var lowerName = fileName.toLowerCase();
      var isDoc = lowerName.endsWith('.pdf') || lowerName.endsWith('.png') || 
                  lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ||
                  lowerName.endsWith('.doc') || lowerName.endsWith('.docx');
      if (!isDoc) {
        skippedCount++;
        continue;
      }
      
      // ดึงปี พ.ศ. จากชื่อไฟล์ หรือวันที่สร้างไฟล์
      var year = extractYearFromText(fileName);
      if (!year) {
        var createdDate = file.getDateCreated();
        year = createdDate.getFullYear() + 543;
      }
      
      // หาโฟลเดอร์เป้าหมายตามปีและหมวดหมู่
      var destFolder = getTargetCategoryFolder(year, curFolderName, fileName);
      
      // ตรวจสอบว่าไฟล์อยู่ใน destFolder อยู่แล้วหรือไม่
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
        Logger.log("ย้ายไฟล์: " + fileName + " -> " + destFolder.getName());
      } else {
        skippedCount++;
      }
    }
  }

  var msg = timeLimitReached
    ? ("ย้ายรอบนี้แล้ว " + movedCount + " ไฟล์ (กดรันต่อได้เลย)")
    : ("จัดระเบียบเสร็จสมบูรณ์ ย้าย " + movedCount + " ไฟล์ ข้าม " + skippedCount + " ไฟล์");
  
  Logger.log(msg);
  return {
    status: timeLimitReached ? 'partial_success' : 'success',
    movedFilesCount: movedCount,
    skippedFilesCount: skippedCount,
    hasMore: timeLimitReached,
    message: msg
  };
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

