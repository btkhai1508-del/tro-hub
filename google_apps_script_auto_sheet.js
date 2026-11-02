/**
 * AutoSheet.gs — CHẠY THEO THÁNG CHO NHÀ TRỌ PHONG LAN (TRO-HUB)
 * Dán chung project với Code.gs (google_apps_script.js), vì dùng các hàm
 * getSafeSpreadsheet, kyCuaTab_, kyHienTai_, timTabThang_, chuanHoaPhong_, dongBoCuDan_ ở đó.
 * 1. createMonthlySheet: ngày 1 hàng tháng tạo tab MM/YYYY từ tab tháng gần nhất.
 * 2. autoColorColumnPFromLogs: tô cột P của tab tháng hiện tại theo giao dịch trong tab Logs.
 */

/************************************************
 * TẠO TAB THÁNG HIỆN TẠI (MM/YYYY)
 ************************************************/
function createMonthlySheet() {
  var ss = getSafeSpreadsheet();
  var newSheetName = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'MM/yyyy');

  if (timTabThang_(ss, newSheetName)) {
    Logger.log('Tab đã tồn tại: ' + newSheetName);
    return;
  }

  // Sao chép từ tab tháng gần nhất trước tháng này, kể cả khi bị lỡ một tháng.
  var hienTai = kyHienTai_();
  var oldSheet = null;
  var oldKy = 0;
  ss.getSheets().forEach(function (sheet) {
    var ky = kyCuaTab_(sheet.getName());
    if (ky && ky < hienTai && ky > oldKy) {
      oldKy = ky;
      oldSheet = sheet;
    }
  });
  if (!oldSheet) throw new Error('Không có tab tháng nào trước ' + newSheetName + ' để sao chép');

  var newSheet = oldSheet.copyTo(ss);
  newSheet.setName(newSheetName);
  ss.setActiveSheet(newSheet);
  ss.moveActiveSheet(ss.getNumSheets());

  // Số mới tháng trước thành số cũ tháng này.
  newSheet.getRange('B7:B51').setValues(oldSheet.getRange('C7:C51').getValues());
  newSheet.getRange('C7:C51').clearContent();
  newSheet.getRange('E7:E51').setValues(oldSheet.getRange('F7:F51').getValues());
  newSheet.getRange('F7:F51').clearContent();

  formatColumnP(newSheet);
  newSheet.getRange('G2').setValue(newSheetName);

  // Đưa cư dân từ tab THÔNG TIN CÁ NHÂN vào tab mới.
  dongBoCuDan_(ss, false, true);

  Logger.log('Đã tạo tab ' + newSheetName + ' từ ' + oldSheet.getName());
}

/** Đầu tháng mọi phòng chưa đóng: cột P dòng 7 → 50 màu đỏ pastel. */
function formatColumnP(sheet) {
  var bg = [];
  for (var i = 7; i <= 50; i++) bg.push(['#f8d7da']);
  sheet.getRange('P7:P50').setBackgrounds(bg);
}

/** Chạy một lần để cài trigger ngày 1 hàng tháng (xoá trigger cũ cùng tên trước). */
function createMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'createMonthlySheet') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('createMonthlySheet')
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .create();
  Logger.log('Đã cài trigger createMonthlySheet ngày 1 hàng tháng');
}

/************************************************
 * TÔ CỘT P THEO TAB LOGS (TRIGGER "KHI CÓ THAY ĐỔI")
 * Nội dung chuyển khoản dạng 102T112026, 203-T11-2026, G02T112026, LVC203-T11-2026.
 * Chỉ tính giao dịch có đúng phòng và đúng tháng hiện tại, nên giao dịch tháng trước không tô nhầm tab mới.
 * Cộng tất cả lần chuyển của phòng (cột H) rồi so với tổng tiền ở cột P:
 * đủ tiền thì tô xanh, thiếu thì giữ màu cũ. Ô P luôn có ghi chú số tiền đã nhận.
 ************************************************/
function soTien_(value) {
  if (typeof value === 'number') return value;
  return Number(String(value === null || value === undefined ? '' : value).replace(/[^\d]/g, '')) || 0;
}

function dinhDangTien_(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

function autoColorColumnPFromLogs() {
  var ss = getSafeSpreadsheet();
  var logsSheet = ss.getSheetByName('Logs');
  var monthSheet = timTabThang_(ss, '');
  if (!logsSheet || !monthSheet) return;

  var lastLogRow = logsSheet.getLastRow();
  if (lastLogRow < 2) return;

  var thang = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'M');
  var nam = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy');
  var maThang = 'T0?' + thang + '(?:[\\s./-]*' + nam + ')?(?!\\d)';

  // Cột F là Nội dung, cột G là Loại, cột H là Số tiền.
  var logs = logsSheet.getRange(2, 6, lastLogRow - 1, 3).getValues();
  var rooms = monthSheet.getRange(7, 1, 44, 1).getValues();
  var tongTien = monthSheet.getRange(7, 16, 44, 1).getValues();
  var patterns = rooms.map(function (row) {
    var phong = chuanHoaPhong_(row[0]);
    if (!phong) return null;
    var maPhong = phong.replace(/^(LVC|G)(\d+)$/, '$1[\\s-]?$2');
    return new RegExp('(?:^|[^A-Z0-9]|P\\.?)' + maPhong + '[\\s.-]*' + maThang);
  });

  // Một giao dịch chỉ tính cho phòng đầu tiên khớp, để không cộng trùng.
  var daNhan = {};
  logs.forEach(function (log) {
    var loai = String(log[1] || '').toLowerCase();
    if (loai && loai.indexOf('vào') === -1 && loai.indexOf('in') === -1) return;
    var noiDung = String(log[0] || '').toUpperCase();
    for (var j = 0; j < patterns.length; j++) {
      if (patterns[j] && patterns[j].test(noiDung)) {
        daNhan[j] = (daNhan[j] || 0) + soTien_(log[2]);
        return;
      }
    }
  });

  Object.keys(daNhan).forEach(function (j) {
    var cell = monthSheet.getRange(7 + Number(j), 16);
    var canDong = soTien_(tongTien[j][0]);
    var nhan = daNhan[j];
    if (!canDong) {
      cell.setNote('Đã nhận ' + dinhDangTien_(nhan) + ', ô P chưa có tổng tiền nên chưa đối chiếu được');
    } else if (nhan >= canDong) {
      cell.setBackground('#CEEAD5');
      cell.setNote('Đã nhận đủ ' + dinhDangTien_(nhan) + ' / ' + dinhDangTien_(canDong) + (nhan > canDong ? ' (dư ' + dinhDangTien_(nhan - canDong) + ')' : ''));
    } else {
      cell.setNote('Mới nhận ' + dinhDangTien_(nhan) + ' / ' + dinhDangTien_(canDong) + ', còn thiếu ' + dinhDangTien_(canDong - nhan));
    }
  });
}
