/****************************************************************
 * ระบบเช็คอินพนักงานนอกสถานที่ — Google Apps Script (API เท่านั้น)
 *
 * สคริปต์นี้ทำหน้าที่เป็น "API" อย่างเดียว ไม่ได้ serve หน้าเว็บ
 * หน้าเว็บอยู่บน GitHub Pages (โฟลเดอร์ docs/) เพื่อให้ GPS ทำงานได้
 * เต็มที่ — ไม่ติดข้อจำกัด iframe ของ Apps Script Web App
 *
 * วิธีติดตั้ง: ดู README.md ในโฟลเดอร์เดียวกัน
 ****************************************************************/

// ===================== ตั้งค่า =====================

/** ไอดีของ Google Sheet — เว้นว่างไว้แล้วรัน setup() ระบบจะสร้างให้ใหม่ */
var SPREADSHEET_ID = '';

/** รหัสผ่านสำหรับหน้า Dashboard และหน้าจัดการหน่วยงาน (เปลี่ยนก่อนใช้จริง!) */
var ADMIN_PIN = 'CHANGE_ME';

/** โฟลเดอร์ Drive เก็บรูป — เว้นว่างไว้ ระบบจะสร้าง/หาโฟลเดอร์ชื่อด้านล่างให้เอง */
var PHOTO_FOLDER_ID   = '';
var PHOTO_FOLDER_NAME = 'เช็คอินพนักงาน - รูปภาพ';

/** ความแม่นยำ GPS ที่ยอมรับได้ (เมตร) — ค่าที่แย่กว่านี้จะไม่รับเช็คอิน */
var MAX_ACCURACY_M = 150;

/** รัศมีเริ่มต้น (เมตร) เมื่อไม่ได้ระบุในแท็บ Locations */
var DEFAULT_RADIUS_M = 200;

/**
 * โหมดตรวจพื้นที่
 *   'strict'   = ต้อง (ระยะห่าง <= รัศมี) เท่านั้น
 *   'tolerant' = ผ่อนผันด้วยค่าความคลาดเคลื่อน GPS: (ระยะห่าง - ความแม่นยำ) <= รัศมี
 * ถ้าพนักงานบ่นว่าอยู่หน้างานจริงแต่เช็คอินไม่ได้ ให้ลองเปลี่ยนเป็น 'tolerant'
 */
var GEOFENCE_MODE = 'strict';

var TZ = 'Asia/Bangkok';

// ชื่อแท็บ
var SH_EMP = 'Employees';
var SH_LOC = 'Locations';
var SH_LOG = 'CheckLog';

// หัวคอลัมน์ (ลำดับสลับได้ ระบบอ่านจากชื่อหัวคอลัมน์)
var HEAD_EMP = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'สถานะ'];
var HEAD_LOC = ['รหัสหน่วยงาน', 'ชื่อหน่วยงาน', 'ละติจูด', 'ลองจิจูด', 'รัศมี(ม.)', 'ที่อยู่/หมายเหตุ', 'สถานะ'];
var HEAD_LOG = [
  'Log ID', 'วันที่', 'รหัสพนักงาน', 'ชื่อพนักงาน', 'รหัสหน่วยงาน', 'หน่วยงาน',
  'เวลาเข้า', 'ละติจูดเข้า', 'ลองจิจูดเข้า', 'ความแม่นยำเข้า(ม.)', 'ระยะห่างเข้า(ม.)', 'รูปเช็คอิน',
  'เวลาออก', 'ละติจูดออก', 'ลองจิจูดออก', 'ความแม่นยำออก(ม.)', 'ระยะห่างออก(ม.)', 'รูปเช็คเอาท์',
  'ระยะเวลา(นาที)', 'หมายเหตุ', 'สถานะ', 'เข้าเมื่อ', 'ออกเมื่อ'
];

var ST_OPEN = 'กำลังปฏิบัติงาน';
var ST_DONE = 'เสร็จสิ้น';

// ===== เฟส 2: แบบประเมินประจำเดือน (เฉพาะตำแหน่ง QA) =====

/** คอลัมน์เสริมในแท็บ Locations — รหัสพนักงาน QA ที่ดูแลหน่วยนี้ (หลายคนคั่นด้วย ,) */
var COL_LOC_QA = 'QA ผู้ดูแล';

/**
 * คอลัมน์เสริมในแท็บ Employees — อนุญาตให้เช็คอิน "งานเฉพาะกิจ" ได้
 * (งานครั้งเดียวจบในสถานที่ที่ยังไม่มีพิกัดในระบบ)
 * ใส่ ใช้งาน / อนุญาต / ใช่ / Y จึงจะเปิดสิทธิ์ เว้นว่าง = ไม่อนุญาต
 */
var COL_EMP_ADHOC = 'งานเฉพาะกิจ';

/** คอลัมน์เสริมใน CheckLog — แยกงานประจำกับงานเฉพาะกิจ */
var COL_LOG_KIND = 'ประเภทงาน';

var KIND_ADHOC   = 'งานเฉพาะกิจ';
var KIND_NORMAL  = 'งานประจำ';

var SH_CFG    = 'FormConfig';
var SH_SURVEY = 'SurveyLog';
var SH_AUDIT  = 'AuditLog';

var HEAD_CFG = ['ฟอร์ม', 'ลำดับ', 'หมวด', 'คำถาม', 'สถานะ'];

var HEAD_SURVEY = [
  'เดือน', 'วันที่', 'เวลา', 'Log ID', 'รหัสหน่วยงาน', 'หน่วยงาน',
  'รหัสQA', 'ชื่อQA', 'สถานะ', 'ผู้ประเมิน', 'ตำแหน่งผู้ประเมิน', 'พื้นที่/อาคาร/ชั้น',
  'จำนวนพนักงานทั้งหมด', 'หัวหน้างาน(คน)', 'พนักงาน(คน)',
  'คะแนนรายข้อ(JSON)', 'คะแนนรวม', 'ข้อเสนอแนะ', 'เหตุผลไม่สะดวก', 'บันทึกเมื่อ'
];

var HEAD_AUDIT = [
  'เดือน', 'วันที่', 'เวลา', 'Log ID', 'รหัสหน่วยงาน', 'หน่วยงาน',
  'รหัสQA', 'ชื่อQA', 'จำนวนพนักงานประจำจุด', 'ผู้ประสานงานหน้างาน', 'ผู้ว่าจ้าง',
  'ผลรายข้อ(JSON)', 'ปกติ(ข้อ)', 'ปรับปรุง(ข้อ)', 'ปัญหา/ข้อเสนอแนะ', 'บันทึกเมื่อ'
];

/** คอลัมน์เสริมใน SurveyLog — ลิงก์รูปลายเซ็นลูกค้า */
var COL_SURVEY_SIGN = 'ลายเซ็นผู้ประเมิน';

/** คอลัมน์เสริมใน AuditLog — ลายเซ็นผู้รับรองข้อมูล (QA) และผู้ว่าจ้าง */
var COL_AUDIT_SIGN_QA  = 'ลายเซ็นQA';
var COL_AUDIT_SIGN_EMP = 'ลายเซ็นผู้ว่าจ้าง';

var ST_SURVEY_OK   = 'ประเมินแล้ว';
var ST_SURVEY_SKIP = 'ลูกค้าไม่สะดวก';


// ===================== จุดรับ request =====================

/**
 * อ่านข้อมูล (GET) — รองรับ JSONP ผ่านพารามิเตอร์ callback
 * เหตุที่ใช้ JSONP: หน้าเว็บอยู่คนละโดเมน (GitHub Pages) การอ่านผ่าน JSONP
 * ทำงานได้ทุกเบราว์เซอร์โดยไม่ต้องพึ่ง CORS
 */
function doGet(e) {
  var p  = (e && e.parameter) || {};
  var cb = p.callback || '';
  try {
    return jsonOut_(route_(p.action, p, null), cb);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message }, cb);
  }
}

/**
 * เขียนข้อมูล (POST) — body เป็น JSON ส่งมาแบบ Content-Type: text/plain
 * เพื่อให้เป็น "simple request" ไม่ต้องมี CORS preflight
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    return jsonOut_(route_(body.action, body, body), '');
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message }, '');
  }
}

/** แจกงานตาม action */
function route_(action, p, body) {
  switch (action) {
    case 'ping':        return { ok: true, time: nowStr_('dd/MM/yyyy HH:mm:ss'), mode: GEOFENCE_MODE };
    case 'bootstrap':   return apiBootstrap_(p.code);
    case 'locations':   return { ok: true, locations: readLocations_(true) };
    case 'checkin':     return apiCheckin_(body);
    case 'checkout':    return apiCheckout_(body);
    case 'dashboard':   return apiDashboard_(p);
    case 'formConfig':  return { ok: true, forms: readFormConfig_() };
    case 'submitAudit':   return apiSubmitAudit_(body);
    case 'submitSurvey':  return apiSubmitSurvey_(body);
    case 'monthlyStatus': return apiMonthlyStatus_(p);
    case 'exportForms':   return apiExportForms_(p);
    case 'adminLoad':   return apiAdminLoad_(p);
    case 'adminSaveLocation':   return apiAdminSaveLocation_(body);
    case 'adminDeleteLocation': return apiAdminDeleteLocation_(body);
    case 'adminSaveEmployee':   return apiAdminSaveEmployee_(body);
    default: throw new Error('ไม่รู้จักคำสั่ง: ' + (action || '(ว่าง)'));
  }
}

function jsonOut_(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}


// ===================== API: พนักงาน =====================

/**
 * เปิดแอพครั้งแรก / ใส่รหัสพนักงาน
 * คืน: ข้อมูลพนักงาน + รายชื่อหน่วยงาน + รายการที่ยังเช็คอินค้างอยู่
 */
function apiBootstrap_(code) {
  code = normCode_(code);
  if (!code) throw new Error('กรุณากรอกรหัสพนักงาน');

  var emp = findEmployee_(code);
  if (!emp)             throw new Error('ไม่พบรหัสพนักงาน "' + code + '" ในระบบ');
  if (!emp.active)      throw new Error('รหัสพนักงาน "' + code + '" ถูกระงับการใช้งาน');

  var locations = readLocations_(true);
  var open      = findOpenLogs_(code);

  // เฉพาะ QA: สถานะแบบประเมินประจำเดือนของหน่วยที่ตนดูแล
  var duty = null;
  if (isQA_(emp)) {
    duty = {};
    var month = monthKey_();
    for (var i = 0; i < locations.length; i++) {
      var l = locations[i];
      if (l.qa.indexOf(emp.code) < 0) continue;
      duty[l.id] = {
        audit:  auditDoneMonth_(l.id, month),
        survey: surveyDoneMonth_(l.id, month)
      };
    }
    for (var j = 0; j < open.length; j++) {
      if (duty[open[j].locationId]) {
        open[j].surveySkipped = surveyUnavailable_(open[j].logId);
      }
    }
  }

  return {
    ok: true,
    employee:  emp,
    locations: locations,
    open:      open,
    duty:      duty,
    month:     monthKey_(),
    config:    { maxAccuracy: MAX_ACCURACY_M, mode: GEOFENCE_MODE }
  };
}

/** เช็คอิน — ตรวจพื้นที่ฝั่งเซิร์ฟเวอร์อีกชั้น (กันแก้ไขฝั่งหน้าเว็บ) */
function apiCheckin_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  var fix = requireFix_(d);

  if (!d.photo || !d.photo.data) throw new Error('กรุณาแนบรูปถ่ายตอนเช็คอิน');

  // งานเฉพาะกิจ = งานครั้งเดียวจบในที่ที่ยังไม่มีพิกัดในระบบ จึงตรวจรัศมีไม่ได้
  // เปิดให้เฉพาะพนักงานที่ถูกกำหนดสิทธิ์ไว้เท่านั้น กันเลี่ยงการตรวจพื้นที่
  var adhoc     = d.adhoc === true;
  var placeName = String(d.placeName || '').trim();
  if (adhoc) {
    if (!emp.adhoc) {
      throw new Error('บัญชีของคุณไม่ได้รับสิทธิ์เช็คอินงานเฉพาะกิจ กรุณาติดต่อผู้ดูแลระบบ');
    }
    if (!placeName) throw new Error('กรุณากรอกชื่อสถานที่หรือชื่อลูกค้า');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // หาหรือสร้างหน่วยงานภายใต้ lock เดียวกัน กันสร้างซ้ำเมื่อกดพร้อมกัน
    var loc, distance;
    if (adhoc) {
      loc = findLocationByName_(placeName) || createAdhocLocation_(placeName, fix, emp);
      distance = haversine_(fix.lat, fix.lng, loc.lat, loc.lng);
    } else {
      loc = requireLocation_(d.locationId);
      var judge = judgeFence_(fix, loc);
      if (!judge.inside) {
        throw new Error('คุณอยู่ห่างจาก "' + loc.name + '" ประมาณ ' + fmtDist_(judge.distance) +
                        ' (อนุญาตไม่เกิน ' + loc.radius + ' ม.) จึงยังเช็คอินไม่ได้');
      }
      distance = judge.distance;
    }

    // กันเช็คอินซ้ำที่เดิมทั้งที่ยังไม่ได้เช็คเอาท์
    var open = findOpenLogs_(emp.code);
    for (var i = 0; i < open.length; i++) {
      if (open[i].locationId === loc.id) {
        throw new Error('คุณเช็คอินที่ "' + loc.name + '" ค้างไว้อยู่แล้ว (เวลา ' +
                        open[i].timeIn + ') กรุณาเช็คเอาท์ก่อน');
      }
    }

    var sheet = getSheet_(SH_LOG);
    var idx   = headerIndex_(sheet, HEAD_LOG);
    var now   = new Date();
    var logId = nextLogId_(sheet, idx, now);

    var photoUrl = savePhoto_(d.photo, logId + '_IN');

    var row = new Array(sheet.getLastColumn() || HEAD_LOG.length).fill('');
    put_(row, idx, 'Log ID',            logId);
    put_(row, idx, 'วันที่',             fmt_(now, 'dd/MM/yyyy'));
    put_(row, idx, 'รหัสพนักงาน',        emp.code);
    put_(row, idx, 'ชื่อพนักงาน',        emp.name);
    put_(row, idx, 'รหัสหน่วยงาน',       loc.id);
    put_(row, idx, 'หน่วยงาน',          loc.name);
    put_(row, idx, 'เวลาเข้า',           fmt_(now, 'HH:mm'));
    put_(row, idx, 'ละติจูดเข้า',        fix.lat);
    put_(row, idx, 'ลองจิจูดเข้า',       fix.lng);
    put_(row, idx, 'ความแม่นยำเข้า(ม.)', Math.round(fix.accuracy));
    put_(row, idx, 'ระยะห่างเข้า(ม.)',   Math.round(distance));
    put_(row, idx, 'รูปเช็คอิน',         photoUrl);
    put_(row, idx, 'หมายเหตุ',           String(d.note || '').trim());
    put_(row, idx, 'สถานะ',              ST_OPEN);
    put_(row, idx, 'เข้าเมื่อ',           now.toISOString());
    put_(row, idx, COL_LOG_KIND,        adhoc ? KIND_ADHOC : KIND_NORMAL);

    sheet.appendRow(row);

    return {
      ok: true, logId: logId, timeIn: fmt_(now, 'HH:mm'), date: fmt_(now, 'dd/MM/yyyy'),
      location: loc.name, locationId: loc.id, adhoc: adhoc,
      distance: Math.round(distance), photo: photoUrl
    };
  } finally {
    lock.releaseLock();
  }
}

/** เช็คเอาท์ — ไม่บังคับว่าต้องอยู่ในรัศมี และไม่บังคับแนบรูป แต่บันทึกพิกัดไว้เสมอ */
function apiCheckout_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  if (!d.logId) throw new Error('ไม่พบรายการที่ต้องการเช็คเอาท์');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_LOG);
    var idx   = headerIndex_(sheet, HEAD_LOG);
    var found = findLogRow_(sheet, idx, d.logId);
    if (!found) throw new Error('ไม่พบรายการ ' + d.logId);
    // ชีตแปลงรหัสพนักงานที่เป็นตัวเลขให้เป็น number จึงต้องเทียบผ่าน normCode_
    if (normCode_(get_(found.row, idx, 'รหัสพนักงาน')) !== emp.code) {
      throw new Error('รายการนี้ไม่ใช่ของคุณ');
    }
    if (cellTime_(get_(found.row, idx, 'เวลาออก'))) throw new Error('รายการนี้เช็คเอาท์ไปแล้ว');

    // ด่านแบบประเมินประจำเดือน — เฉพาะ QA ที่หน่วยของตัวเอง
    qaGate_(emp, String(get_(found.row, idx, 'รหัสหน่วยงาน')).trim(), d.logId);

    var now = new Date();
    var row = found.row;

    // พิกัดตอนออก: มีก็บันทึก ไม่มีก็ผ่านได้ (บางที่สัญญาณไม่ถึง)
    if (isNum_(d.lat) && isNum_(d.lng)) {
      var loc = findLocation_(get_(row, idx, 'รหัสหน่วยงาน'));
      put_(row, idx, 'ละติจูดออก',        Number(d.lat));
      put_(row, idx, 'ลองจิจูดออก',       Number(d.lng));
      put_(row, idx, 'ความแม่นยำออก(ม.)', isNum_(d.accuracy) ? Math.round(d.accuracy) : '');
      if (loc) {
        put_(row, idx, 'ระยะห่างออก(ม.)',
             Math.round(haversine_(Number(d.lat), Number(d.lng), loc.lat, loc.lng)));
      }
    }

    if (d.photo && d.photo.data) {
      put_(row, idx, 'รูปเช็คเอาท์', savePhoto_(d.photo, get_(row, idx, 'Log ID') + '_OUT'));
    }

    var startIso = cellIso_(get_(row, idx, 'เข้าเมื่อ'));
    var minutes  = '';
    if (startIso) {
      var start = new Date(startIso);
      if (!isNaN(start.getTime())) minutes = Math.round((now - start) / 60000);
    }

    var note = String(d.note || '').trim();
    if (note) {
      var old = get_(row, idx, 'หมายเหตุ');
      put_(row, idx, 'หมายเหตุ', old ? (old + ' | ' + note) : note);
    }

    put_(row, idx, 'เวลาออก',        fmt_(now, 'HH:mm'));
    put_(row, idx, 'ระยะเวลา(นาที)', minutes);
    put_(row, idx, 'สถานะ',          ST_DONE);
    put_(row, idx, 'ออกเมื่อ',        now.toISOString());

    sheet.getRange(found.rowNum, 1, 1, row.length).setValues([row]);

    return {
      ok: true, logId: d.logId, timeOut: fmt_(now, 'HH:mm'),
      minutes: minutes, duration: fmtDur_(minutes)
    };
  } finally {
    lock.releaseLock();
  }
}


// ===================== API: หัวหน้า / แอดมิน =====================

/** ข้อมูลสำหรับหน้า Dashboard */
function apiDashboard_(p) {
  requirePin_(p && p.pin);

  var sheet = getSheet_(SH_LOG);
  var idx   = headerIndex_(sheet, HEAD_LOG);
  var last  = sheet.getLastRow();
  var rows  = [];

  if (last > 1) {
    var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    var from = p.from || '';   // yyyy-MM-dd
    var to   = p.to   || '';

    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var logId = get_(r, idx, 'Log ID');
      if (!logId) continue;

      var iso  = cellIso_(get_(r, idx, 'เข้าเมื่อ'));
      var day  = iso ? iso.substring(0, 10) : isoFromThaiDate_(cellDate_(get_(r, idx, 'วันที่')));
      if (from && day && day < from) continue;
      if (to   && day && day > to)   continue;

      rows.push({
        logId:       logId,
        day:         day,
        date:        cellDate_(get_(r, idx, 'วันที่')),
        empCode:     String(get_(r, idx, 'รหัสพนักงาน')),
        empName:     String(get_(r, idx, 'ชื่อพนักงาน')),
        locationId:  String(get_(r, idx, 'รหัสหน่วยงาน')),
        location:    String(get_(r, idx, 'หน่วยงาน')),
        timeIn:      cellTime_(get_(r, idx, 'เวลาเข้า')),
        latIn:       numOrNull_(get_(r, idx, 'ละติจูดเข้า')),
        lngIn:       numOrNull_(get_(r, idx, 'ลองจิจูดเข้า')),
        accIn:       numOrNull_(get_(r, idx, 'ความแม่นยำเข้า(ม.)')),
        distIn:      numOrNull_(get_(r, idx, 'ระยะห่างเข้า(ม.)')),
        photoIn:     String(get_(r, idx, 'รูปเช็คอิน')),
        timeOut:     cellTime_(get_(r, idx, 'เวลาออก')),
        latOut:      numOrNull_(get_(r, idx, 'ละติจูดออก')),
        lngOut:      numOrNull_(get_(r, idx, 'ลองจิจูดออก')),
        distOut:     numOrNull_(get_(r, idx, 'ระยะห่างออก(ม.)')),
        photoOut:    String(get_(r, idx, 'รูปเช็คเอาท์')),
        minutes:     numOrNull_(get_(r, idx, 'ระยะเวลา(นาที)')),
        note:        String(get_(r, idx, 'หมายเหตุ')),
        status:      String(get_(r, idx, 'สถานะ')),
        kind:        String(get_(r, idx, COL_LOG_KIND) || ''),
        startIso:    iso
      });
    }
  }

  rows.sort(function (a, b) { return (b.startIso || '').localeCompare(a.startIso || ''); });

  return {
    ok: true,
    rows: rows,
    locations: readLocations_(false),
    employees: readEmployees_(),
    today: nowStr_('yyyy-MM-dd'),
    fetchedAt: nowStr_('dd/MM/yyyy HH:mm:ss')
  };
}

/** ข้อมูลสำหรับหน้าจัดการหน่วยงาน/พนักงาน */
function apiAdminLoad_(p) {
  requirePin_(p && p.pin);
  return { ok: true, locations: readLocations_(false), employees: readEmployees_() };
}

/** เพิ่ม/แก้ไขหน่วยงาน (ปักหมุดจากแผนที่) */
function apiAdminSaveLocation_(d) {
  requirePin_(d && d.pin);
  var loc = (d && d.location) || {};
  var name = String(loc.name || '').trim();
  if (!name)                        throw new Error('กรุณากรอกชื่อหน่วยงาน');
  if (!isNum_(loc.lat) || !isNum_(loc.lng)) throw new Error('กรุณาปักหมุดตำแหน่งบนแผนที่');

  var radius = isNum_(loc.radius) ? Math.round(Number(loc.radius)) : DEFAULT_RADIUS_M;
  if (radius < 20)    radius = 20;
  if (radius > 20000) radius = 20000;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_LOC);
    var idx   = headerIndex_(sheet, HEAD_LOC);
    var last  = sheet.getLastRow();
    var id    = String(loc.id || '').trim();
    var rowNum = 0;

    if (id && last > 1) {
      var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === id) { rowNum = i + 2; break; }
      }
    }
    if (!id) id = nextLocId_(sheet, idx);

    var row = new Array(sheet.getLastColumn() || HEAD_LOC.length).fill('');
    if (rowNum) row = sheet.getRange(rowNum, 1, 1, row.length).getValues()[0];

    put_(row, idx, 'รหัสหน่วยงาน',    id);
    put_(row, idx, 'ชื่อหน่วยงาน',     name);
    put_(row, idx, 'ละติจูด',         Number(loc.lat));
    put_(row, idx, 'ลองจิจูด',        Number(loc.lng));
    put_(row, idx, 'รัศมี(ม.)',       radius);
    put_(row, idx, 'ที่อยู่/หมายเหตุ', String(loc.address || '').trim());
    put_(row, idx, 'สถานะ',          loc.active === false ? 'ปิด' : 'ใช้งาน');

    if (rowNum) sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
    else        sheet.appendRow(row);

    return { ok: true, id: id, locations: readLocations_(false) };
  } finally {
    lock.releaseLock();
  }
}

/** ปิดใช้งานหน่วยงาน (ไม่ลบทิ้ง เพื่อให้ประวัติเดิมยังอ่านได้) */
function apiAdminDeleteLocation_(d) {
  requirePin_(d && d.pin);
  var id = String((d && d.id) || '').trim();
  if (!id) throw new Error('ไม่พบรหัสหน่วยงาน');

  var sheet = getSheet_(SH_LOC);
  var idx   = headerIndex_(sheet, HEAD_LOC);
  var last  = sheet.getLastRow();
  if (last < 2) throw new Error('ไม่พบหน่วยงานนี้');

  var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      sheet.getRange(i + 2, idx['สถานะ'] + 1).setValue('ปิด');
      return { ok: true, locations: readLocations_(false) };
    }
  }
  throw new Error('ไม่พบหน่วยงานนี้');
}

/** เพิ่ม/แก้ไขพนักงาน */
function apiAdminSaveEmployee_(d) {
  requirePin_(d && d.pin);
  var e    = (d && d.employee) || {};
  var code = normCode_(e.code);
  var name = String(e.name || '').trim();
  if (!code) throw new Error('กรุณากรอกรหัสพนักงาน');
  if (!name) throw new Error('กรุณากรอกชื่อพนักงาน');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_EMP);
    var idx   = headerIndex_(sheet, HEAD_EMP);
    var last  = sheet.getLastRow();
    var rowNum = 0;

    if (last > 1) {
      var codes = sheet.getRange(2, idx['รหัสพนักงาน'] + 1, last - 1, 1).getValues();
      for (var i = 0; i < codes.length; i++) {
        if (normCode_(codes[i][0]) === code) { rowNum = i + 2; break; }
      }
    }

    var row = new Array(sheet.getLastColumn() || HEAD_EMP.length).fill('');
    if (rowNum) row = sheet.getRange(rowNum, 1, 1, row.length).getValues()[0];

    put_(row, idx, 'รหัสพนักงาน',  code);
    put_(row, idx, 'ชื่อ-นามสกุล', name);
    put_(row, idx, 'ตำแหน่ง',      String(e.position || '').trim());
    put_(row, idx, 'สถานะ',        e.active === false ? 'พ้นสภาพ' : 'ใช้งาน');

    if (rowNum) sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
    else        sheet.appendRow(row);

    return { ok: true, employees: readEmployees_() };
  } finally {
    lock.releaseLock();
  }
}


// ===================== แบบประเมินประจำเดือน (เฟส 2) =====================

/** พนักงานคนนี้เป็น QA ไหม — ดูจากคอลัมน์ตำแหน่งในแท็บ Employees */
function isQA_(emp) {
  return String((emp && emp.position) || '').toUpperCase().indexOf('QA') >= 0;
}

/** คีย์เดือนปัจจุบัน เช่น "2026-09" */
function monthKey_() { return nowStr_('yyyy-MM'); }

/**
 * ด่านก่อนเช็คเอาท์: QA ที่เช็คเอาท์จากหน่วยที่ตนดูแล ต้องทำแบบประเมิน
 * ของเดือนนั้นให้ครบก่อน — แบบตรวจมาตรฐานต้องทำเสมอ ส่วนแบบพึงพอใจ
 * ผ่อนผันได้ถ้าบันทึก "ลูกค้าไม่สะดวก" ไว้สำหรับการเข้างานรอบนี้
 */
function qaGate_(emp, locationId, logId) {
  if (!isQA_(emp)) return;
  var loc = findLocation_(locationId);
  if (!loc || loc.qa.indexOf(emp.code) < 0) return;

  var month = monthKey_();
  if (!auditDoneMonth_(loc.id, month)) {
    throw new Error('เดือนนี้ยังไม่ได้ทำ "แบบตรวจมาตรฐานการปฏิบัติงาน" ของ ' + loc.name +
                    ' — กรุณาทำให้เสร็จก่อนเช็คเอาท์');
  }
  if (!surveyDoneMonth_(loc.id, month) && !surveyUnavailable_(logId)) {
    throw new Error('เดือนนี้ยังไม่ได้ทำ "แบบประเมินความพึงพอใจ" ของ ' + loc.name +
                    ' — ยื่นเครื่องให้ลูกค้าประเมิน หรือบันทึก "ลูกค้าไม่สะดวก" ก่อนเช็คเอาท์');
  }
}

/** อ่านข้อคำถามทั้ง 2 ฟอร์มจากแท็บ FormConfig (แก้คำถามได้ในชีต ไม่ต้องแก้โค้ด) */
function readFormConfig_() {
  var sheet = getSheet_(SH_CFG);
  var idx   = headerIndex_(sheet, HEAD_CFG);
  var last  = sheet.getLastRow();
  var forms = { audit: [], survey: [] };
  if (last < 2) return forms;

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    var r    = values[i];
    var form = String(get_(r, idx, 'ฟอร์ม')).trim().toLowerCase();
    var q    = String(get_(r, idx, 'คำถาม')).trim();
    if (!forms[form] || !q) continue;
    if (!isActive_(get_(r, idx, 'สถานะ'))) continue;
    forms[form].push({
      order:    Number(get_(r, idx, 'ลำดับ')) || (forms[form].length + 1),
      section:  String(get_(r, idx, 'หมวด')).trim(),
      question: q
    });
  }
  forms.audit.sort(function (a, b) { return a.order - b.order; });
  forms.survey.sort(function (a, b) { return a.order - b.order; });
  return forms;
}

/** เดือนนี้หน่วยนี้ทำแบบตรวจมาตรฐานแล้วหรือยัง */
function auditDoneMonth_(locationId, month) {
  return scanLog_(SH_AUDIT, HEAD_AUDIT, function (r, idx) {
    return cellMonth_(get_(r, idx, 'เดือน')) === month &&
           String(get_(r, idx, 'รหัสหน่วยงาน')).trim() === locationId;
  }).length > 0;
}

/** เดือนนี้หน่วยนี้มีผลประเมินพึงพอใจ (ที่ลูกค้าประเมินจริง) แล้วหรือยัง */
function surveyDoneMonth_(locationId, month) {
  return scanLog_(SH_SURVEY, HEAD_SURVEY, function (r, idx) {
    return cellMonth_(get_(r, idx, 'เดือน')) === month &&
           String(get_(r, idx, 'รหัสหน่วยงาน')).trim() === locationId &&
           String(get_(r, idx, 'สถานะ')).trim() === ST_SURVEY_OK;
  }).length > 0;
}

/** การเข้างานรอบนี้ (logId) บันทึก "ลูกค้าไม่สะดวก" ไว้แล้วหรือยัง */
function surveyUnavailable_(logId) {
  if (!logId) return false;
  return scanLog_(SH_SURVEY, HEAD_SURVEY, function (r, idx) {
    return String(get_(r, idx, 'Log ID')).trim() === String(logId).trim() &&
           String(get_(r, idx, 'สถานะ')).trim() === ST_SURVEY_SKIP;
  }).length > 0;
}

/** อ่านทุกแถวของแท็บ log ที่ตรงเงื่อนไข — คืน [{row, idx}] */
function scanLog_(sheetName, expected, match) {
  var sheet = getSheet_(sheetName);
  var idx   = headerIndex_(sheet, expected);
  var last  = sheet.getLastRow();
  var out = [];
  if (last < 2) return out;
  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    if (match(values[i], idx)) out.push({ row: values[i], idx: idx });
  }
  return out;
}

/** ตรวจว่า QA คนนี้มีสิทธิ์ส่งฟอร์มของหน่วยนี้ แล้วคืนข้อมูลหน่วย */
function requireQaDuty_(emp, locationId) {
  if (!isQA_(emp)) throw new Error('เฉพาะพนักงานตำแหน่ง QA เท่านั้นที่ส่งแบบประเมินได้');
  var loc = requireLocation_(locationId);
  if (loc.qa.indexOf(emp.code) < 0) {
    throw new Error('คุณไม่ได้เป็น QA ผู้ดูแลของ "' + loc.name + '"');
  }
  return loc;
}

/** ส่งแบบตรวจมาตรฐานการปฏิบัติงาน (QA กรอกเอง) */
function apiSubmitAudit_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  var loc = requireQaDuty_(emp, d.locationId);

  var questions = readFormConfig_().audit;
  if (!questions.length) throw new Error('ยังไม่ได้ตั้งข้อคำถามในแท็บ FormConfig');

  var answers = d.answers || {};
  var normals = 0, improves = 0;
  for (var i = 0; i < questions.length; i++) {
    var a = String(answers[questions[i].order] || '').trim();
    if (a === 'ปกติ') normals++;
    else if (a === 'ปรับปรุง') improves++;
    else throw new Error('กรุณาตอบข้อ "' + questions[i].question + '" (ปกติ/ปรับปรุง)');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_AUDIT);
    var idx   = headerIndex_(sheet, HEAD_AUDIT);
    var now   = new Date();

    var row = new Array(sheet.getLastColumn() || HEAD_AUDIT.length).fill('');
    put_(row, idx, 'เดือน',               monthKey_());
    put_(row, idx, 'วันที่',               fmt_(now, 'dd/MM/yyyy'));
    put_(row, idx, 'เวลา',                fmt_(now, 'HH:mm'));
    put_(row, idx, 'Log ID',              String(d.logId || '').trim());
    put_(row, idx, 'รหัสหน่วยงาน',         loc.id);
    put_(row, idx, 'หน่วยงาน',            loc.name);
    put_(row, idx, 'รหัสQA',              emp.code);
    put_(row, idx, 'ชื่อQA',              emp.name);
    put_(row, idx, 'จำนวนพนักงานประจำจุด', String(d.staffCount || '').trim());
    put_(row, idx, 'ผู้ประสานงานหน้างาน',   String(d.coordinator || '').trim());
    put_(row, idx, 'ผู้ว่าจ้าง',            String(d.employer || '').trim());
    put_(row, idx, 'ผลรายข้อ(JSON)',       JSON.stringify({ answers: answers, remarks: d.remarks || {} }));
    put_(row, idx, 'ปกติ(ข้อ)',            normals);
    put_(row, idx, 'ปรับปรุง(ข้อ)',        improves);
    put_(row, idx, 'ปัญหา/ข้อเสนอแนะ',     String(d.issues || '').trim());
    put_(row, idx, 'บันทึกเมื่อ',           now.toISOString());

    var stamp = loc.id + '_' + fmt_(now, 'yyyyMMdd_HHmmss');
    if (d.signatureQa && d.signatureQa.data) {
      put_(row, idx, COL_AUDIT_SIGN_QA,  savePhoto_(d.signatureQa,  'SIGNQA_'  + stamp, 'image/png'));
    }
    if (d.signatureEmp && d.signatureEmp.data) {
      put_(row, idx, COL_AUDIT_SIGN_EMP, savePhoto_(d.signatureEmp, 'SIGNEMP_' + stamp, 'image/png'));
    }
    sheet.appendRow(row);

    return {
      ok: true, month: monthKey_(),
      duty: { audit: true, survey: surveyDoneMonth_(loc.id, monthKey_()) }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ส่งแบบประเมินความพึงพอใจ
 * - โหมดปกติ: ลูกค้ากดคะแนน 1-10 ครบทุกข้อ
 * - โหมด "ลูกค้าไม่สะดวก" (d.unavailable = true): บันทึกเหตุผลไว้
 *   ปลดล็อกเช็คเอาท์เฉพาะรอบนี้ แต่เดือนนั้นยังถือว่าค้างประเมินอยู่
 */
function apiSubmitSurvey_(d) {
  d = d || {};
  var emp = requireEmployee_(d.empCode);
  var loc = requireQaDuty_(emp, d.locationId);

  var status, scores = {}, total = '';
  if (d.unavailable) {
    status = ST_SURVEY_SKIP;
    if (!String(d.reason || '').trim()) throw new Error('กรุณาระบุเหตุผลที่ลูกค้าไม่สะดวก');
    if (!String(d.logId || '').trim())  throw new Error('ไม่พบรายการเช็คอินที่อ้างอิง');
  } else {
    status = ST_SURVEY_OK;
    var questions = readFormConfig_().survey;
    if (!questions.length) throw new Error('ยังไม่ได้ตั้งข้อคำถามในแท็บ FormConfig');
    var sum = 0;
    for (var i = 0; i < questions.length; i++) {
      var s = Number((d.scores || {})[questions[i].order]);
      if (!isFinite(s) || s < 1 || s > 10) {
        throw new Error('กรุณาให้คะแนนข้อ "' + questions[i].question + '" (1-10)');
      }
      scores[questions[i].order] = s;
      sum += s;
    }
    total = sum;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(SH_SURVEY);
    var idx   = headerIndex_(sheet, HEAD_SURVEY);
    var now   = new Date();

    var row = new Array(sheet.getLastColumn() || HEAD_SURVEY.length).fill('');
    put_(row, idx, 'เดือน',               monthKey_());
    put_(row, idx, 'วันที่',               fmt_(now, 'dd/MM/yyyy'));
    put_(row, idx, 'เวลา',                fmt_(now, 'HH:mm'));
    put_(row, idx, 'Log ID',              String(d.logId || '').trim());
    put_(row, idx, 'รหัสหน่วยงาน',         loc.id);
    put_(row, idx, 'หน่วยงาน',            loc.name);
    put_(row, idx, 'รหัสQA',              emp.code);
    put_(row, idx, 'ชื่อQA',              emp.name);
    put_(row, idx, 'สถานะ',               status);
    put_(row, idx, 'ผู้ประเมิน',            String(d.rater || '').trim());
    put_(row, idx, 'ตำแหน่งผู้ประเมิน',      String(d.raterPosition || '').trim());
    put_(row, idx, 'พื้นที่/อาคาร/ชั้น',      String(d.area || '').trim());
    put_(row, idx, 'จำนวนพนักงานทั้งหมด',   String(d.totalStaff || '').trim());
    put_(row, idx, 'หัวหน้างาน(คน)',        String(d.heads || '').trim());
    put_(row, idx, 'พนักงาน(คน)',          String(d.workers || '').trim());
    put_(row, idx, 'คะแนนรายข้อ(JSON)',    JSON.stringify(scores));
    put_(row, idx, 'คะแนนรวม',            total);
    put_(row, idx, 'ข้อเสนอแนะ',           String(d.comment || '').trim());
    put_(row, idx, 'เหตุผลไม่สะดวก',        String(d.reason || '').trim());
    put_(row, idx, 'บันทึกเมื่อ',           now.toISOString());
    if (d.signature && d.signature.data) {
      put_(row, idx, COL_SURVEY_SIGN,
           savePhoto_(d.signature, 'SIGN_' + loc.id + '_' + fmt_(now, 'yyyyMMdd_HHmmss'), 'image/png'));
    }
    sheet.appendRow(row);

    return {
      ok: true, month: monthKey_(), status: status, total: total,
      duty: { audit: auditDoneMonth_(loc.id, monthKey_()), survey: status === ST_SURVEY_OK }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Dashboard: สถานะประเมินรายเดือนของทุกหน่วย
 * 🔴 QA ผู้ดูแลยังไม่เข้าเยี่ยมเลย / 🟡 เยี่ยมแล้วแต่ฟอร์มไม่ครบ / 🟢 ครบ
 */
function apiMonthlyStatus_(p) {
  requirePin_(p && p.pin);
  var month = String((p && p.month) || monthKey_()).trim();

  // การเข้าเยี่ยมของเดือนนั้น: locationId → { empCode: วันที่ล่าสุด }
  var visits = {};
  scanLog_(SH_LOG, HEAD_LOG, function (r, idx) {
    var iso = cellIso_(get_(r, idx, 'เข้าเมื่อ'));
    if (iso.substring(0, 7) !== month) return false;
    var locId = String(get_(r, idx, 'รหัสหน่วยงาน')).trim();
    var code  = normCode_(get_(r, idx, 'รหัสพนักงาน'));
    if (!visits[locId]) visits[locId] = {};
    var day = cellDate_(get_(r, idx, 'วันที่'));
    if (!visits[locId][code] || visits[locId][code] < day) visits[locId][code] = day;
    return false;   // ใช้ scan เป็นตัววนอย่างเดียว ไม่เก็บแถว
  });

  var employees = readEmployees_();
  var nameOf = {};
  for (var e = 0; e < employees.length; e++) nameOf[employees[e].code] = employees[e].name;

  var rows = [];
  var locations = readLocations_(true);
  for (var i = 0; i < locations.length; i++) {
    var l = locations[i];
    var lastVisit = '';
    for (var q = 0; q < l.qa.length; q++) {
      var v = (visits[l.id] || {})[l.qa[q]] || '';
      if (v > lastVisit) lastVisit = v;
    }
    var audit  = auditDoneMonth_(l.id, month);
    var survey = surveyDoneMonth_(l.id, month);
    var status = !l.qa.length ? 'noqa'
               : (audit && survey) ? 'done'
               : lastVisit ? 'partial'
               : 'missing';
    rows.push({
      locationId: l.id, location: l.name,
      qaCodes: l.qa,
      qaNames: l.qa.map(function (c) { return nameOf[c] || c; }),
      lastVisit: lastVisit, audit: audit, survey: survey, status: status
    });
  }

  var order = { missing: 0, partial: 1, noqa: 2, done: 3 };
  rows.sort(function (a, b) {
    return (order[a.status] - order[b.status]) || a.location.localeCompare(b.location, 'th');
  });
  return { ok: true, month: month, rows: rows };
}

/** Dashboard: ข้อมูลสำหรับ Export PDF — เลือกเดือน + หน่วย (ว่าง = ทั้งหมด) */
function apiExportForms_(p) {
  requirePin_(p && p.pin);
  var month = String((p && p.month) || monthKey_()).trim();
  var locId = String((p && p.locationId) || '').trim();

  function pick(rows, headers) {
    return rows.map(function (x) {
      var o = {};
      for (var i = 0; i < headers.length; i++) o[headers[i]] = valOut_(get_(x.row, x.idx, headers[i]));
      return o;
    });
  }

  var match = function (r, idx) {
    if (cellMonth_(get_(r, idx, 'เดือน')) !== month) return false;
    return !locId || String(get_(r, idx, 'รหัสหน่วยงาน')).trim() === locId;
  };

  return {
    ok: true, month: month,
    forms:   readFormConfig_(),
    surveys: pick(scanLog_(SH_SURVEY, HEAD_SURVEY, match), HEAD_SURVEY.concat([COL_SURVEY_SIGN])),
    audits:  pick(scanLog_(SH_AUDIT,  HEAD_AUDIT,  match),
                      HEAD_AUDIT.concat([COL_AUDIT_SIGN_QA, COL_AUDIT_SIGN_EMP])),
    locations: readLocations_(false)
  };
}

/** แปลงค่าจากชีตให้พร้อมส่งออก (Date → ข้อความอ่านได้) */
function valOut_(v) {
  if (isDate_(v)) {
    // เดาจากค่า: ปี 1899 = เวลาอย่างเดียว, เที่ยงคืนพอดี = วันที่อย่างเดียว
    if (v.getFullYear() < 1970) return cellTime_(v);
    if (v.getHours() === 0 && v.getMinutes() === 0) return cellDate_(v);
    return cellDate_(v) + ' ' + cellTime_(v);
  }
  return v;
}


// ===================== อ่านข้อมูลจากชีต =====================

function readEmployees_() {
  var sheet = getSheet_(SH_EMP);
  var idx   = headerIndex_(sheet, HEAD_EMP);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var code = normCode_(get_(values[i], idx, 'รหัสพนักงาน'));
    if (!code) continue;
    out.push({
      code:     code,
      name:     String(get_(values[i], idx, 'ชื่อ-นามสกุล')).trim(),
      position: String(get_(values[i], idx, 'ตำแหน่ง')).trim(),
      active:   isActive_(get_(values[i], idx, 'สถานะ')),
      // คอลัมน์เสริม — ชีตเก่าที่ยังไม่มีคอลัมน์นี้จะได้ false (ไม่อนุญาต)
      adhoc:    (COL_EMP_ADHOC in idx) && isYes_(get_(values[i], idx, COL_EMP_ADHOC))
    });
  }
  return out;
}

function findEmployee_(code) {
  code = normCode_(code);
  var list = readEmployees_();
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
  return null;
}

function requireEmployee_(code) {
  var emp = findEmployee_(code);
  if (!emp)        throw new Error('ไม่พบรหัสพนักงานในระบบ');
  if (!emp.active) throw new Error('รหัสพนักงานนี้ถูกระงับการใช้งาน');
  return emp;
}

function readLocations_(activeOnly) {
  var sheet = getSheet_(SH_LOC);
  var idx   = headerIndex_(sheet, HEAD_LOC);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r    = values[i];
    var id   = String(get_(r, idx, 'รหัสหน่วยงาน')).trim();
    var name = String(get_(r, idx, 'ชื่อหน่วยงาน')).trim();
    var lat  = Number(get_(r, idx, 'ละติจูด'));
    var lng  = Number(get_(r, idx, 'ลองจิจูด'));
    if (!id || !name || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;

    var active = isActive_(get_(r, idx, 'สถานะ'));
    if (activeOnly && !active) continue;

    var radius = Number(get_(r, idx, 'รัศมี(ม.)'));

    // คอลัมน์ QA ผู้ดูแล เป็นคอลัมน์เสริม — ชีตเก่าที่ยังไม่มีก็ใช้งานได้ (ได้ลิสต์ว่าง)
    var qaRaw = (COL_LOC_QA in idx) ? String(get_(r, idx, COL_LOC_QA)) : '';
    var qa = qaRaw.split(',').map(normCode_).filter(function (c) { return !!c; });

    out.push({
      id: id, name: name, lat: lat, lng: lng,
      radius:  (isFinite(radius) && radius > 0) ? Math.round(radius) : DEFAULT_RADIUS_M,
      address: String(get_(r, idx, 'ที่อยู่/หมายเหตุ')).trim(),
      qa:      qa,
      active:  active
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

function findLocation_(id) {
  id = String(id || '').trim();
  var list = readLocations_(false);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** หาหน่วยงานจากชื่อ (ตัดช่องว่างหัวท้าย ไม่สนตัวพิมพ์เล็กใหญ่) */
function findLocationByName_(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  var list = readLocations_(false);
  for (var i = 0; i < list.length; i++) {
    if (list[i].name.toLowerCase() === n) return list[i];
  }
  return null;
}

/**
 * สร้างหน่วยงานใหม่จากจุดที่พนักงานยืนอยู่ตอนเช็คอินงานเฉพาะกิจ
 * ครั้งต่อไปจะเลือกจากรายการได้เลย และใช้การตรวจรัศมีตามปกติ
 */
function createAdhocLocation_(name, fix, emp) {
  var sheet = getSheet_(SH_LOC);
  var idx   = headerIndex_(sheet, HEAD_LOC);
  var id    = nextLocId_(sheet, idx);

  var row = new Array(sheet.getLastColumn() || HEAD_LOC.length).fill('');
  put_(row, idx, 'รหัสหน่วยงาน',    id);
  put_(row, idx, 'ชื่อหน่วยงาน',     String(name).trim());
  put_(row, idx, 'ละติจูด',         fix.lat);
  put_(row, idx, 'ลองจิจูด',        fix.lng);
  put_(row, idx, 'รัศมี(ม.)',       DEFAULT_RADIUS_M);
  put_(row, idx, 'ที่อยู่/หมายเหตุ',
       'สร้างอัตโนมัติจากงานเฉพาะกิจ ' + nowStr_('dd/MM/yyyy') + ' โดย ' + emp.name);
  put_(row, idx, 'สถานะ',          'ใช้งาน');
  sheet.appendRow(row);

  return {
    id: id, name: String(name).trim(), lat: fix.lat, lng: fix.lng,
    radius: DEFAULT_RADIUS_M, address: '', qa: [], active: true
  };
}

function requireLocation_(id) {
  var loc = findLocation_(id);
  if (!loc)        throw new Error('ไม่พบหน่วยงานที่เลือก');
  if (!loc.active) throw new Error('หน่วยงาน "' + loc.name + '" ถูกปิดการใช้งานแล้ว');
  return loc;
}

/** รายการที่เช็คอินแล้วแต่ยังไม่เช็คเอาท์ ของพนักงานคนนี้ */
function findOpenLogs_(empCode) {
  empCode = normCode_(empCode);
  var sheet = getSheet_(SH_LOG);
  var idx   = headerIndex_(sheet, HEAD_LOG);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (normCode_(get_(r, idx, 'รหัสพนักงาน')) !== empCode) continue;
    if (cellTime_(get_(r, idx, 'เวลาออก'))) continue;
    var logId = String(get_(r, idx, 'Log ID')).trim();
    if (!logId) continue;

    out.push({
      logId:      logId,
      date:       cellDate_(get_(r, idx, 'วันที่')),
      timeIn:     cellTime_(get_(r, idx, 'เวลาเข้า')),
      locationId: String(get_(r, idx, 'รหัสหน่วยงาน')).trim(),
      location:   String(get_(r, idx, 'หน่วยงาน')).trim(),
      photoIn:    String(get_(r, idx, 'รูปเช็คอิน')).trim(),
      startIso:   cellIso_(get_(r, idx, 'เข้าเมื่อ'))
    });
  }
  out.sort(function (a, b) { return (b.startIso || '').localeCompare(a.startIso || ''); });
  return out;
}

function findLogRow_(sheet, idx, logId) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var col = idx['Log ID'] + 1;
  var ids = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(logId).trim()) {
      return { rowNum: i + 2, row: sheet.getRange(i + 2, 1, 1, sheet.getLastColumn()).getValues()[0] };
    }
  }
  return null;
}


// ===================== พื้นที่ / ระยะทาง =====================

/** ระยะทางระหว่าง 2 พิกัด (เมตร) — สูตร Haversine */
function haversine_(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function judgeFence_(fix, loc) {
  var distance = haversine_(fix.lat, fix.lng, loc.lat, loc.lng);
  var effective = (GEOFENCE_MODE === 'tolerant')
    ? Math.max(0, distance - fix.accuracy)
    : distance;
  return { distance: distance, inside: effective <= loc.radius };
}

function requireFix_(d) {
  if (!isNum_(d.lat) || !isNum_(d.lng)) throw new Error('ไม่ได้รับพิกัด GPS กรุณาลองใหม่');
  var acc = isNum_(d.accuracy) ? Number(d.accuracy) : 9999;
  if (acc > MAX_ACCURACY_M) {
    throw new Error('สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อน ±' + Math.round(acc) +
                    ' ม. ต้องไม่เกิน ±' + MAX_ACCURACY_M + ' ม.) กรุณาออกไปที่โล่งแล้วลองใหม่');
  }
  return { lat: Number(d.lat), lng: Number(d.lng), accuracy: acc };
}


// ===================== รูปภาพ =====================

/** อัปโหลดรูป base64 ขึ้น Drive แล้วคืนลิงก์ */
function savePhoto_(photo, baseName, mime) {
  var type   = mime || photo.mimeType || 'image/jpeg';
  var bytes  = Utilities.base64Decode(photo.data);
  var name   = baseName + (type === 'image/png' ? '.png' : '.jpg');
  var blob   = Utilities.newBlob(bytes, type, name);
  var folder = getPhotoFolder_();
  var file   = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) { /* องค์กรจำกัดการแชร์: ลิงก์ยังใช้ได้ภายในองค์กร */ }
  return 'https://drive.google.com/open?id=' + file.getId();
}

/** โฟลเดอร์รูป แยกโฟลเดอร์ย่อยรายเดือน */
function getPhotoFolder_() {
  var root;
  if (PHOTO_FOLDER_ID) {
    root = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  } else {
    var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  }
  var monthName = nowStr_('yyyy-MM');
  var sub = root.getFoldersByName(monthName);
  return sub.hasNext() ? sub.next() : root.createFolder(monthName);
}


// ===================== ตัวช่วยชีต =====================

function getSS_() {
  if (!SPREADSHEET_ID) {
    throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID — กรุณารันฟังก์ชัน setup() ก่อน');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name) {
  var sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแท็บชื่อ "' + name + '" — กรุณารันฟังก์ชัน setup()');
  return sheet;
}

/** แผนที่ชื่อหัวคอลัมน์ → index (เริ่มที่ 0) */
function headerIndex_(sheet, expected) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('แท็บ "' + sheet.getName() + '" ยังไม่มีหัวคอลัมน์');

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h && !(h in idx)) idx[h] = i;
  }
  for (var j = 0; j < expected.length; j++) {
    if (!(expected[j] in idx)) {
      throw new Error('แท็บ "' + sheet.getName() + '" ไม่มีคอลัมน์ "' + expected[j] + '"');
    }
  }
  return idx;
}

function get_(row, idx, header) {
  var i = idx[header];
  return (i == null || i >= row.length) ? '' : row[i];
}

function put_(row, idx, header, value) {
  var i = idx[header];
  if (i == null) return;
  while (row.length <= i) row.push('');
  row[i] = value;
}

/** Log ID รูปแบบ CHK-yyyyMMdd-001 (ไล่เลขใหม่ทุกวัน) */
function nextLogId_(sheet, idx, now) {
  var prefix = 'CHK-' + fmt_(now, 'yyyyMMdd') + '-';
  var last   = sheet.getLastRow();
  var max    = 0;
  if (last > 1) {
    var ids = sheet.getRange(2, idx['Log ID'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var s = String(ids[i][0]).trim();
      if (s.indexOf(prefix) === 0) {
        var n = parseInt(s.substring(prefix.length), 10);
        if (n > max) max = n;
      }
    }
  }
  return prefix + ('00' + (max + 1)).slice(-3);
}

/** รหัสหน่วยงานรูปแบบ LOC-001 */
function nextLocId_(sheet, idx) {
  var last = sheet.getLastRow();
  var max  = 0;
  if (last > 1) {
    var ids = sheet.getRange(2, idx['รหัสหน่วยงาน'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var m = String(ids[i][0]).trim().match(/^LOC-(\d+)$/);
      if (m && +m[1] > max) max = +m[1];
    }
  }
  return 'LOC-' + ('00' + (max + 1)).slice(-3);
}


// ===================== ตัวช่วยทั่วไป =====================

function requirePin_(pin) {
  if (String(pin || '') !== ADMIN_PIN) throw new Error('รหัสผ่านไม่ถูกต้อง');
}

/**
 * Google Sheet แปลงข้อความที่ดูเหมือนวันที่/เวลาให้กลายเป็นค่า Date อัตโนมัติ
 * เวลาอ่านกลับมาจึงได้ object Date แทนข้อความที่เขียนลงไป
 * ("28/08/2026" → Fri Aug 28 2026 ..., "16:04" → Sat Dec 30 1899 16:04)
 * สามฟังก์ชันนี้แปลงกลับเป็นข้อความให้ตรงกับที่ตั้งใจเก็บไว้
 */
function cellDate_(v) {
  if (isDate_(v)) return zz_(v.getDate()) + '/' + zz_(v.getMonth() + 1) + '/' + v.getFullYear();
  return String(v == null ? '' : v).trim();
}

function cellTime_(v) {
  if (isDate_(v)) return zz_(v.getHours()) + ':' + zz_(v.getMinutes());
  return String(v == null ? '' : v).trim();
}

function cellIso_(v) {
  if (isDate_(v)) return v.toISOString();
  return String(v == null ? '' : v).trim();
}

/** คีย์เดือน "yyyy-MM" — ชีตแปลง "2026-09" เป็นวันที่ จึงต้องแปลงกลับก่อนเทียบ */
function cellMonth_(v) {
  if (isDate_(v)) return v.getFullYear() + '-' + zz_(v.getMonth() + 1);
  return String(v == null ? '' : v).trim();
}

/** ตรวจว่าเป็น Date จริงไหม — ใช้ toString แทน instanceof เพื่อไม่พึ่ง realm เดียวกัน */
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function zz_(n) { return ('0' + n).slice(-2); }

/** รหัสพนักงานอาจถูกชีตแปลงเป็นตัวเลข ("0123" → 123) จึงตัดช่องว่างและ .0 ทิ้ง */
function normCode_(v) {
  if (v == null) return '';
  var s = (typeof v === 'number') ? String(Math.round(v)) : String(v).trim();
  return s.replace(/\.0+$/, '');
}

function isActive_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return true;   // เว้นว่าง = ใช้งานได้
  return !/^(ปิด|ไม่ใช้งาน|พ้นสภาพ|ลาออก|inactive|disabled|no|false|0)$/i.test(s);
}

/** ค่าที่ถือว่า "อนุญาต" — ต่างจาก isActive_ ตรงที่เว้นว่าง = ไม่อนุญาต */
function isYes_(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t) return false;
  return /^(ใช้งาน|อนุญาต|ใช่|เปิด|y|yes|true|1|✓)$/i.test(t);
}

function isNum_(v)      { return v !== '' && v != null && isFinite(Number(v)); }
function numOrNull_(v)  { return isNum_(v) ? Number(v) : null; }
function fmt_(d, p)     { return Utilities.formatDate(d, TZ, p); }
function nowStr_(p)     { return fmt_(new Date(), p); }

function fmtDist_(m) {
  return (m >= 1000) ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.';
}

function fmtDur_(min) {
  if (!isNum_(min)) return '';
  var h = Math.floor(min / 60), m = min % 60;
  return h ? (h + ' ชม. ' + m + ' นาที') : (m + ' นาที');
}

/** "dd/MM/yyyy" (ค.ศ. หรือ พ.ศ.) → "yyyy-MM-dd" สำหรับกรองช่วงวัน */
function isoFromThaiDate_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var y = +m[3];
  if (y > 2400) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}


// ===================== ติดตั้งครั้งแรก =====================

/**
 * รันฟังก์ชันนี้ครั้งเดียวตอนติดตั้ง
 * - ถ้า SPREADSHEET_ID ว่าง จะสร้าง Google Sheet ใหม่ให้ แล้วบอกไอดีใน Log
 * - สร้างแท็บ Employees / Locations / CheckLog พร้อมหัวคอลัมน์
 */
function setup() {
  var ss;
  if (SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.create('ระบบเช็คอินพนักงานนอกสถานที่');
    Logger.log('สร้างชีตใหม่แล้ว — คัดลอกไอดีนี้ไปใส่ตัวแปร SPREADSHEET_ID ด้านบน:');
    Logger.log(ss.getId());
  }
  ss.setSpreadsheetTimeZone(TZ);

  ensureSheet_(ss, SH_EMP, HEAD_EMP.concat([COL_EMP_ADHOC]), [
    ['1001', 'ตัวอย่าง พนักงาน', 'ช่างบริการ', 'ใช้งาน', '']
  ]);
  ensureSheet_(ss, SH_LOC, HEAD_LOC.concat([COL_LOC_QA]), [
    ['LOC-001', 'ตัวอย่าง หน่วยงาน', 13.7563, 100.5018, 200, 'แก้พิกัดให้ตรงหน้างานจริง', 'ใช้งาน', '']
  ]);
  ensureSheet_(ss, SH_LOG, HEAD_LOG.concat([COL_LOG_KIND]), []);

  // เฟส 2: แบบประเมินประจำเดือน — ข้อคำถามตั้งต้นตามแบบฟอร์มกระดาษจริง
  ensureSheet_(ss, SH_CFG, HEAD_CFG, [
    // แบบตรวจมาตรฐานการปฏิบัติงานประจำหน่วยงาน (ปกติ/ปรับปรุง)
    ['audit', 1,  'สถานะการทำงานของพนักงาน', 'อัตรากำลังพลครบตามสัญญา', 'ใช้งาน'],
    ['audit', 2,  'สถานะการทำงานของพนักงาน', 'การแต่งกาย / ยูนิฟอร์ม', 'ใช้งาน'],
    ['audit', 3,  'สถานะการทำงานของพนักงาน', 'ความประพฤติและกิริยามารยาท / การบริการ', 'ใช้งาน'],
    ['audit', 4,  'สถานะการทำงานของพนักงาน', 'การปฏิบัติงาน / ความรู้ความเข้าใจในงาน', 'ใช้งาน'],
    ['audit', 5,  'คุณภาพงานความสะอาด', 'พื้นที่ทั่วไป: ประตู, หน้าต่าง, ทางเดิน, เพดาน, ผนัง', 'ใช้งาน'],
    ['audit', 6,  'คุณภาพงานความสะอาด', 'เฟอร์นิเจอร์: โต๊ะ, เก้าอี้, โซฟา, ตู้', 'ใช้งาน'],
    ['audit', 7,  'คุณภาพงานความสะอาด', 'ห้องน้ำ: ผนัง, พื้น, เคาน์เตอร์, อ่างล้างมือ, กระจกเงา', 'ใช้งาน'],
    ['audit', 8,  'คุณภาพงานความสะอาด', 'ห้องน้ำ: สุขภัณฑ์ / กลิ่น', 'ใช้งาน'],
    ['audit', 9,  'คุณภาพงานความสะอาด', 'อุปกรณ์ / น้ำยาทำความสะอาด', 'ใช้งาน'],
    ['audit', 10, 'คุณภาพงานความสะอาด', 'อื่น ๆ', 'ใช้งาน'],
    // แบบประเมินความพึงพอใจการบริการทำความสะอาด FM-OP04-03 REV.03 (คะแนน 1-10)
    ['survey', 1,  '', 'ความสะอาดของพื้นที่บริการ / ห้องแม่บ้าน', 'ใช้งาน'],
    ['survey', 2,  '', 'ความพร้อมของเครื่องมืออุปกรณ์และผลิตภัณฑ์', 'ใช้งาน'],
    ['survey', 3,  '', 'ความครบถ้วนของจำนวนพนักงาน', 'ใช้งาน'],
    ['survey', 4,  '', 'กริยามารยาท / การแต่งกายของพนักงาน', 'ใช้งาน'],
    ['survey', 5,  '', 'ความรู้ความสามารถของพนักงาน', 'ใช้งาน'],
    ['survey', 6,  '', 'ความรู้ความสามารถของหัวหน้างาน', 'ใช้งาน'],
    ['survey', 7,  '', 'ความสะดวกรวดเร็วในการประสานงานจากบริษัท ฯ', 'ใช้งาน'],
    ['survey', 8,  '', 'ความรวดเร็วในการแก้ไข', 'ใช้งาน'],
    ['survey', 9,  '', 'ความสม่ำเสมอในการเข้าตรวจสอบของบริษัทฯ', 'ใช้งาน'],
    ['survey', 10, '', 'ความสามารถในการดำเนินงานตามระบบ ISO', 'ใช้งาน']
  ]);
  ensureSheet_(ss, SH_SURVEY, HEAD_SURVEY.concat([COL_SURVEY_SIGN]), []);
  ensureSheet_(ss, SH_AUDIT,  HEAD_AUDIT.concat([COL_AUDIT_SIGN_QA, COL_AUDIT_SIGN_EMP]), []);

  // ลบแท็บเปล่าที่ Google สร้างมาให้ตอนสร้างไฟล์ใหม่
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  Logger.log('ติดตั้งเรียบร้อย: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers, sampleRows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    for (var i = 0; i < sampleRows.length; i++) sheet.appendRow(sampleRows[i]);
  } else {
    // เติมเฉพาะคอลัมน์ที่ยังขาด ไม่แตะข้อมูลเดิม
    var lastCol  = sheet.getLastColumn();
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h).trim();
    });
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  }

  sheet.getRange(1, 1, 1, sheet.getLastColumn())
       .setFontWeight('bold')
       .setBackground('#1F4BB8')
       .setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  return sheet;
}
