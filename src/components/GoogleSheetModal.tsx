import { useDialogFocus } from '../lib/useDialogFocus';
import React, { useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  RefreshCw,
  Check,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  Table,
  UserCheck,
  HelpCircle,
  Database
} from './AppIcons';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/api';
import { initAuth, googleSignIn, logout, getAccessToken } from '../lib/googleAuth';
import {
  extractSpreadsheetId,
  getSpreadsheetDetails,
  fetchResidentProfileFromSheet,
  fetchMonthlyInvoicesFromSheet,
  syncAllOccupantsToProfileTabInGoogleSheet
} from '../lib/googleSheetsService';

export function GoogleSheetModal() {
  const {
    isGoogleSheetModalOpen,
    closeGoogleSheetModal,
    profile,
    updateProfile,
    invoices,
    setInvoices,
    sheetConfig,
    updateSheetConfig
  } = useApp();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [sheetInput, setSheetInput] = useState(sheetConfig.spreadsheetId || '');
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [selectedProfileTab, setSelectedProfileTab] = useState(sheetConfig.profileTab || 'Thông tin cá nhân');
  const [selectedInvoiceTab, setSelectedInvoiceTab] = useState(sheetConfig.monthlyTab || '10/2026');
  const [targetRoom, setTargetRoom] = useState(sheetConfig.syncRoom || profile.room.roomNumber.replace(/[^\d]/g, '') || '203');

  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  const [showSchemaGuide, setShowSchemaGuide] = useState(false);
  const [showSepayGuide, setShowSepayGuide] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [isTestingSepay, setIsTestingSepay] = useState(false);

  const webhookUrl = `${window.location.origin}/api/sepay/webhook`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleTestSepay = async () => {
    setIsTestingSepay(true);
    try {
      const res = await apiFetch('/api/sepay/test-webhook', {
        method: 'POST',
        body: JSON.stringify({
          room: targetRoom || profile.room.roomNumber || '203',
          amount: invoices[0]?.total || 3550000,
          content: `${targetRoom || '203'}-T10-2026`
        })
      });
      if (res.ok) {
        setSyncStatus({
          type: 'success',
          message: `⚡ Test SePAY thành công: Webhook đã nhận diện tiền vào và cập nhật Hóa đơn Phòng ${targetRoom || '203'} sang ĐÃ THANH TOÁN (Màu xanh lá)!`
        });
        // Update local invoice state
        setInvoices(prev => prev.map(inv => inv.id === 'INV-102026' || inv.month === '10/2026' ? { ...inv, status: 'paid', paidAt: 'SePAY Webhook Tự động' } : inv));
      }
    } catch (e: any) {
      setSyncStatus({ type: 'error', message: 'Lỗi test webhook: ' + e.message });
    } finally {
      setIsTestingSepay(false);
    }
  };

  const appsScriptCode = `/* =====================================================
   ECOSTAY - LVC GOOGLE APPS SCRIPT
   - Chuyển cư dân từ Cột Q-AB sang THÔNG TIN CÁ NHÂN
   - Tự động đổi màu cột P: Xanh lá (#d4edda) = Đã thanh toán, Vàng (#fff3cd) = Chờ xác nhận
   - Tự động quét tab "Logs" để cập nhật Cột P sang Xanh lá
===================================================== */

var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏢 Nhà Trọ Phong Lan')
    .addItem('➡️ 1. Tự Động Chuyển Cư Dân (Q-AB) Sang Tab THÔNG TIN CÁ NHÂN', 'chuyenCuDanSangTabCaNhan')
    .addSeparator()
    .addItem('🔄 2. Tự Động Quét Tab Logs & Đổi Màu Cột P (Xanh lá)', 'tuDongDongBoTuLogs')
    .addSeparator()
    .addItem('✅ 3. Đánh dấu ĐÃ THANH TOÁN phòng đang chọn (Màu xanh lá)', 'markRowPaid')
    .addItem('⏳ 4. Đánh dấu CHỜ XÁC NHẬN phòng đang chọn (Màu vàng)', 'markRowPending')
    .addToUi();
}

function chuyenCuDanSangTabCaNhan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Tự động tìm tab tháng hiện tại (vd: 10/2026 hoặc 102026 hoặc tab active)
  var activeSheet = ss.getActiveSheet();
  var monthSheet = (activeSheet.getName().includes('/') || activeSheet.getName().includes('10'))
    ? activeSheet
    : (ss.getSheetByName('10/2026') || ss.getSheetByName('102026') || ss.getSheets()[1] || ss.getSheets()[0]);

  var profileSheet = ss.getSheetByName('THÔNG TIN CÁ NHÂN');
  if (!profileSheet) {
    profileSheet = ss.insertSheet('THÔNG TIN CÁ NHÂN');
    profileSheet.getRange(1, 1, 1, 14).setValues([[
      'Họ và Tên', 'SĐT', 'CCCD', 'Email Liên Hệ', 'Ngày sinh', 'Địa chỉ thường trú',
      'Biển số xe', 'Loại xe dòng xe', 'Phòng số', 'Người liên hệ', 'Mối quan hệ',
      'Số điện thoại khẩn', 'Password', 'Hợp đồng'
    ]]);
  }

  // Đọc từ dòng 6 đến hết dữ liệu các phòng (G01..G07, 101..502, LVC101..LVC204)
  var lastRow = Math.min(monthSheet.getLastRow(), 60);
  if (lastRow < 6) {
    SpreadsheetApp.getUi().alert('⚠️ Không tìm thấy dữ liệu phòng từ dòng 6 trở đi!');
    return;
  }

  var data = monthSheet.getRange(6, 1, lastRow - 5, 28).getValues();
  var out = [];

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var rawA = (r[0] || '').toString().trim();
    var sheetRowNumber = i + 6;
    var room = rawA;

    // Dò phòng nếu Cột A để trống:
    if (!room) {
      if (sheetRowNumber >= 6 && sheetRowNumber <= 12) {
        room = 'G0' + (sheetRowNumber - 5);
      } else if (sheetRowNumber >= 42 && sheetRowNumber <= 45) {
        room = 'LVC10' + (sheetRowNumber - 41);
      } else if (sheetRowNumber >= 46 && sheetRowNumber <= 49) {
        room = 'LVC20' + (sheetRowNumber - 45);
      }
    }

    if (!room) continue;
    if (!room.startsWith('P.') && !room.startsWith('P. ')) room = 'P. ' + room;

    var contractCode = 'HĐ-' + room.replace(/[^0-9A-Za-z]/g, '');

    // Cột Q-T (Index 16-19): Người 1
    // Cột U-X (Index 20-23): Người 2
    // Cột Y-AB (Index 24-27): Người 3
    var tenants = [
      { name: r[16], cccd: r[17], phone: r[18], plate: r[19] },
      { name: r[20], cccd: r[21], phone: r[22], plate: r[23] },
      { name: r[24], cccd: r[25], phone: r[26], plate: r[27] }
    ];

    tenants.forEach(function(t) {
      var tName = (t.name || '').toString().trim();
      var isNumeric = /^\d+(\.\d+)?$/.test(tName);
      var isHeader = /^họ\s*(?:và\s*)?tên/i.test(tName);
      if (tName && tName !== '1' && !isNumeric && !isHeader) {
        var rawPhone = t.phone ? t.phone.toString().trim() : '';
        var isPhoneNumericOnly = /^[0-9](\.0+)?$/.test(rawPhone);
        var phone = (rawPhone && rawPhone !== '' && rawPhone !== '0' && !isPhoneNumericOnly) ? rawPhone : '1';
        var pass = (phone !== '1' && phone.length >= 6) ? phone.slice(-6) : '180505';

        out.push([
          tName,
          phone,
          t.cccd && !/^[0-9](\.0+)?$/.test(t.cccd.toString().trim()) ? t.cccd.toString().trim() : '',
          '',
          '',
          '',
          t.plate && !/^\d+(\.\d+)?$/.test(t.plate.toString().trim()) ? t.plate.toString().trim() : '',
          'Xe máy',
          room,
          '',
          '',
          '',
          pass,
          contractCode
        ]);
      }
    });
  }

  if (out.length > 0) {
    // Ghi trực tiếp vào tab THÔNG TIN CÁ NHÂN từ dòng 2
    profileSheet.getRange(2, 1, out.length, 14).setValues(out);
    SpreadsheetApp.getUi().alert('🎉 Thành công! Đã tự động bưng ' + out.length + ' cư dân từ tab \"' + monthSheet.getName() + '\" sang tab \"THÔNG TIN CÁ NHÂN\"!');
  } else {
    SpreadsheetApp.getUi().alert('⚠️ Không tìm thấy thông tin cư dân ở cột Q - AB!');
  }
}

// Tự động quét tab Logs và đổi màu Cột P sang Xanh lá (#d4edda) cho các phòng đã chuyển khoản
function tuDongDongBoTuLogs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet) {
    SpreadsheetApp.getUi().alert('⚠️ Không tìm thấy tab \"Logs\"!');
    return;
  }

  var activeSheet = ss.getActiveSheet();
  var monthSheet = (activeSheet.getName().includes('/') || activeSheet.getName().includes('10'))
    ? activeSheet
    : (ss.getSheetByName('10/2026') || ss.getSheetByName('102026') || ss.getSheets()[1]);

  var logsLastRow = logsSheet.getLastRow();
  if (logsLastRow < 2) {
    SpreadsheetApp.getUi().alert('Tab Logs chưa có giao dịch nào.');
    return;
  }

  var logsData = logsSheet.getRange(2, 1, logsLastRow - 1, 10).getValues();
  var monthLastRow = Math.min(monthSheet.getLastRow(), 60);
  var monthData = monthSheet.getRange(6, 1, monthLastRow - 5, 28).getValues();

  var updatedCount = 0;

  for (var i = 0; i < monthData.length; i++) {
    var r = monthData[i];
    var sheetRowNumber = i + 6;
    var rawA = (r[0] || '').toString().trim();
    var room = rawA;

    if (!room) {
      if (sheetRowNumber >= 6 && sheetRowNumber <= 12) room = 'G0' + (sheetRowNumber - 5);
      else if (sheetRowNumber >= 42 && sheetRowNumber <= 45) room = 'LVC10' + (sheetRowNumber - 41);
      else if (sheetRowNumber >= 46 && sheetRowNumber <= 49) room = 'LVC20' + (sheetRowNumber - 45);
    }
    if (!room) continue;

    var cleanRoom = room.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    var currentPColor = monthSheet.getRange(sheetRowNumber, 16).getBackground();

    // Check if logs contain this room
    for (var l = 0; l < logsData.length; l++) {
      var logContent = (logsData[l][5] || '').toString().toUpperCase();
      var logType = (logsData[l][6] || '').toString().toLowerCase();
      if (logType && !logType.includes('vào') && !logType.includes('in')) continue;

      if (logContent.includes(cleanRoom) || logContent.includes(cleanRoom + 'T10')) {
        // Đổi màu Cột P sang Xanh lá
        monthSheet.getRange(sheetRowNumber, 16).setBackground('#d4edda');
        updatedCount++;
        break;
      }
    }
  }

  SpreadsheetApp.getUi().alert('✅ Đã đồng bộ từ Logs: Cập nhật ' + updatedCount + ' phòng sang ĐÃ THANH TOÁN (Màu xanh lá)!');
}

// Cập nhật trạng thái thanh toán sang màu xanh lá (#d4edda)
function markRowPaid() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveCell().getRow();
  if (row < 6) {
    SpreadsheetApp.getUi().alert('Vui lòng chọn một ô trong hàng của phòng cần duyệt!');
    return;
  }
  sheet.getRange(row, 16).setBackground('#d4edda'); // Cột P màu xanh lá
  SpreadsheetApp.getUi().alert('✅ Đã đánh dấu ĐÃ THANH TOÁN (Màu xanh lá #d4edda) cho hàng ' + row);
}

// Cập nhật trạng thái chờ xác nhận sang màu vàng (#fff3cd)
function markRowPending() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveCell().getRow();
  if (row < 5) return;
  sheet.getRange(row, 16).setBackground('#fff3cd'); // Cột P màu vàng
  SpreadsheetApp.getUi().alert('⏳ Đã đánh dấu CHỜ XÁC NHẬN (Màu vàng #fff3cd) cho hàng ' + row);
}`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(appsScriptCode);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 3000);
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => setCurrentUser(user),
      () => setCurrentUser(null)
    );
    return () => unsubscribe();
  }, []);

  const dialogRef = useDialogFocus(isGoogleSheetModalOpen, closeGoogleSheetModal);

  if (!isGoogleSheetModalOpen) return null;

  const handleGoogleLogin = async () => {
    try {
      setIsSigningIn(true);
      setSyncStatus({ type: 'idle', message: '' });
      const res = await googleSignIn();
      if (res?.user) {
        setCurrentUser(res.user);
        setSyncStatus({ type: 'success', message: `Đăng nhập Google thành công: ${res.user.email}` });
        if (sheetInput) {
          fetchTabs(res.accessToken);
        }
      }
    } catch (err: any) {
      setSyncStatus({ type: 'error', message: err.message || 'Đăng nhập thất bại' });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setAvailableTabs([]);
    setSyncStatus({ type: 'idle', message: 'Đã đăng xuất Google' });
  };

  const handleBatchSyncToSheet = async () => {
    const rawId = extractSpreadsheetId(sheetInput);
    if (!rawId) {
      setSyncStatus({ type: 'error', message: 'Vui lòng nhập Link hoặc ID Google Sheet hợp lệ' });
      return;
    }

    try {
      setIsBatchSyncing(true);
      setSyncStatus({ type: 'idle', message: '' });
      let token = await getAccessToken();

      if (!token && !currentUser) {
        setSyncStatus({
          type: 'error',
          message: 'Để ghi trực tiếp vào Google Sheet, bạn cần bấm nút "Đăng nhập với Google" ở trên để cấp quyền ghi cho tài khoản Google của bạn.'
        });
        setIsBatchSyncing(false);
        return;
      }

      const res = await syncAllOccupantsToProfileTabInGoogleSheet(
        rawId,
        token || '',
        selectedInvoiceTab || '10/2026',
        selectedProfileTab || 'THÔNG TIN CÁ NHÂN'
      );

      setSyncStatus({
        type: 'success',
        message: `Đã tự động chuyển và điền thành công ${res.totalRows} cư dân (Cột Q - AB) sang tab "${selectedProfileTab}" trực tiếp trên Google Sheet!`
      });
    } catch (err: any) {
      setSyncStatus({
        type: 'error',
        message: err.message || 'Không thể chỉnh sửa Google Sheet trực tiếp. Cần cấp quyền truy cập tài khoản Google.'
      });
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const fetchTabs = async (tokenOverride?: string) => {
    const rawId = extractSpreadsheetId(sheetInput);
    if (!rawId) {
      setSyncStatus({ type: 'error', message: 'Vui lòng nhập Link hoặc ID Google Sheet' });
      return;
    }

    const token = tokenOverride || await getAccessToken();
    if (!token) {
      setSyncStatus({ type: 'error', message: 'Vui lòng Đăng nhập Google trước khi đọc Sheet' });
      return;
    }

    try {
      setIsLoadingDetails(true);
      setSyncStatus({ type: 'idle', message: '' });
      const details = await getSpreadsheetDetails(rawId, token);
      setAvailableTabs(details.sheets);

      // Auto select matching tabs
      const profTab = details.sheets.find(s => s.toLowerCase().includes('thông tin') || s.toLowerCase().includes('cá nhân') || s.toLowerCase().includes('profile')) || details.sheets[0] || '';
      const invTab = details.sheets.find(s => s.includes('10') || s.toLowerCase().includes('tháng') || s.toLowerCase().includes('invoice')) || details.sheets[1] || details.sheets[0] || '';

      setSelectedProfileTab(profTab);
      setSelectedInvoiceTab(invTab);
      setSyncStatus({ type: 'success', message: `Đã kết nối "${details.title}" (${details.sheets.length} tab)` });
    } catch (err: any) {
      setSyncStatus({ type: 'error', message: err.message || 'Không thể tải danh sách tab từ Google Sheet' });
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSyncData = async () => {
    const rawId = extractSpreadsheetId(sheetInput);
    if (!rawId) {
      setSyncStatus({ type: 'error', message: 'Vui lòng nhập Link hoặc ID Google Sheet' });
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setSyncStatus({ type: 'error', message: 'Vui lòng Đăng nhập tài khoản Google' });
      return;
    }

    try {
      setIsSyncing(true);
      setSyncStatus({ type: 'idle', message: '' });

      // 1. Save config
      updateSheetConfig({
        spreadsheetId: rawId,
        profileTab: selectedProfileTab,
        monthlyTab: selectedInvoiceTab,
        syncRoom: targetRoom,
        lastSynced: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString('vi-VN')
      });

      let updatedProfile = false;
      let updatedInvoice = false;

      // 2. Fetch Resident Profile if tab exists
      if (selectedProfileTab) {
        try {
          const profileData = await fetchResidentProfileFromSheet(rawId, selectedProfileTab, token, targetRoom);
          if (profileData) {
            updateProfile(profileData);
            updatedProfile = true;
          }
        } catch (e: any) {
          console.warn('Profile sync warning:', e);
        }
      }

      // 3. Fetch Monthly Invoices (Row 7+, Columns A-AD)
      if (selectedInvoiceTab) {
        try {
          const invoiceData = await fetchMonthlyInvoicesFromSheet(rawId, selectedInvoiceTab, token, targetRoom);
          if (invoiceData) {
            // Merge or update current month invoice
            setInvoices((prev: any[]) => {
              const exists = prev.some(i => i.id === invoiceData.id || i.month === invoiceData.month);
              if (exists) {
                return prev.map(i => (i.id === invoiceData.id || i.month === invoiceData.month) ? invoiceData : i);
              }
              return [invoiceData, ...prev];
            });
            updatedInvoice = true;
          }
        } catch (e: any) {
          console.warn('Invoice sync warning:', e);
        }
      }

      if (updatedProfile || updatedInvoice) {
        setSyncStatus({
          type: 'success',
          message: `Đồng bộ thành công! Đã nạp ${updatedProfile ? 'hồ sơ cư dân' : ''} ${updatedProfile && updatedInvoice ? '& ' : ''}${updatedInvoice ? 'hóa đơn tháng từ Sheet' : ''}`
        });
      } else {
        setSyncStatus({
          type: 'error',
          message: `Không tìm thấy hàng dữ liệu cho Phòng "${targetRoom}" từ dòng 7 trở đi trong Sheet.`
        });
      }
    } catch (err: any) {
      setSyncStatus({ type: 'error', message: err.message || 'Lỗi khi đồng bộ dữ liệu từ Sheet' });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      className="tahoe-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md duration-200 select-none"
      onClick={closeGoogleSheetModal}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="google-sheet-dialog-title"
        className="tahoe-dialog w-full max-w-xl bg-white rounded-3xl border border-white/90 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.35)] flex flex-col max-h-[92vh] overflow-hidden relative duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 bg-white/95 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <span className="type-label text-emerald-600 block text-[10px] font-bold uppercase tracking-wider">
                Google Workspace Integration
              </span>
              <h3 id="google-sheet-dialog-title" className="type-h4 text-slate-900 font-bold">Liên kết Google Sheets</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={closeGoogleSheetModal}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* 1. Google Account Connection Card */}
          <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Tài khoản Google</span>
              {currentUser && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                  <Check size={12} /> Đã cấp quyền
                </span>
              )}
            </div>

            {currentUser ? (
              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2.5">
                  <img
                    src={currentUser.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=100'}
                    alt="User"
                    className="w-8 h-8 rounded-full object-cover ring-2 ring-emerald-500/20"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900">{currentUser.displayName || 'Google User'}</div>
                    <div className="text-[11px] text-slate-500">{currentUser.email}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogout}
                  className="text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  Đăng xuất
                </button>
              </div>
            ) : (
              <div className="pt-1">
                {/* Official Google Sign-in Button */}
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isSigningIn}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium py-2.5 px-4 rounded-xl shadow-xs transition-all cursor-pointer active:scale-[0.99]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span className="text-xs sm:text-sm font-semibold">
                    {isSigningIn ? 'Đang kết nối Google...' : 'Đăng nhập với Google để cấp quyền Sheet'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 2. Sheet URL / ID Input */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700">Đường dẫn Google Sheet hoặc Spreadsheet ID</label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBatchSyncToSheet}
                  disabled={isBatchSyncing || isSyncing}
                  className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] disabled:opacity-50"
                  title="Chuyển toàn bộ danh sách cư dân (Cột Q-AB) sang Tab Thông Tin Cá Nhân"
                >
                  <RefreshCw size={12} className={isBatchSyncing ? 'animate-spin text-emerald-600' : 'text-emerald-600'} />
                  <span>{isBatchSyncing ? 'Đang chuyển...' : '⚡ Chuyển cư dân sang Tab Cá Nhân'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSchemaGuide(!showSchemaGuide)}
                  className="text-[11px] font-medium text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle size={13} />
                  <span>{showSchemaGuide ? 'Ẩn cấu trúc' : 'Cấu trúc Sheet'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSepayGuide(!showSepayGuide)}
                  className="text-[11px] font-bold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"
                >
                  <Database size={13} />
                  <span>{showSepayGuide ? 'Ẩn SePAY' : '🔌 Cổng SePAY Webhook'}</span>
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs... hoặc ID bảng tính"
                aria-label="Liên kết hoặc ID bảng tính Google Sheets" value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => fetchTabs()}
                disabled={isLoadingDetails}
                className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={13} className={isLoadingDetails ? 'animate-spin' : ''} />
                <span>Lấy tab</span>
              </button>
            </div>
          </div>

          {/* SePAY Webhook Integration Guide */}
          {showSepayGuide && (
            <div className="p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs space-y-3.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                  <Database size={16} className="text-emerald-600" />
                  <span>Tích hợp Cổng thanh toán tự động SePAY</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-200/80 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 text-[10px] font-bold">
                  Tự động 100%
                </span>
              </div>

              <p className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                Khi cư dân chuyển khoản ngân hàng, SePAY sẽ bắn Webhook ngay lập tức để cập nhật trạng thái <strong>Cột P sang Đã thanh toán (Màu xanh lá)</strong> và thông báo cho cư dân.
              </p>

              {/* Webhook URL Box */}
              <div className="space-y-1 bg-white dark:bg-slate-900 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">1. Đường dẫn Webhook URL (Điền vào SePAY):</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    aria-label="Địa chỉ webhook Apps Script" value={webhookUrl}
                    className="flex-1 px-2.5 py-1.5 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
                  >
                    {copiedWebhook ? '✓ Đã chép' : 'Sao chép URL'}
                  </button>
                </div>
              </div>

              {/* Transfer Content Syntax Guide */}
              <div className="space-y-1 bg-white p-3 rounded-xl border border-emerald-200 text-[11px]">
                <span className="font-bold text-slate-700 block">2. Cú pháp nhận diện nội dung chuyển khoản:</span>
                <ul className="list-disc pl-4 text-slate-600 space-y-1">
                  <li><strong>Căn riêng LVC:</strong> <code className="text-indigo-600 font-bold bg-indigo-50 px-1 py-0.5 rounded font-mono">LVC[SỐ PHÒNG]-T[Tháng]-[Năm]</code> (Ví dụ: <code className="font-mono font-semibold">LVC203-T10-2026</code>)</li>
                  <li><strong>Căn thông thường:</strong> <code className="text-emerald-700 font-bold bg-emerald-50 px-1 py-0.5 rounded font-mono">[SỐ PHÒNG]-T[Tháng]-[Năm]</code> (Ví dụ: <code className="font-mono font-semibold">0203-T10-2026</code>)</li>
                </ul>
              </div>

              {/* Live Test Trigger */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-600 text-[11px]">Kiểm tra kết nối và giả lập thanh toán:</span>
                <button
                  type="button"
                  onClick={handleTestSepay}
                  disabled={isTestingSepay}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isTestingSepay ? 'animate-spin' : ''} />
                  <span>{isTestingSepay ? 'Đang bắn test...' : '⚡ Bắn Test Webhook SePAY'}</span>
                </button>
              </div>
            </div>
          )}

          {/* 3. Schema Explanation (Accordion) */}
          {showSchemaGuide && (
            <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 text-xs space-y-3 animate-in fade-in duration-200">
              <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                <Database size={15} />
                <span>Cấu trúc chuẩn đã thiết lập theo yêu cầu của bạn:</span>
              </div>

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-800">1. Tab thông tin cá nhân (12 cột):</div>
                <p className="text-slate-600 font-mono text-[11px] bg-white p-2 rounded-lg border border-indigo-100">
                  Họ và Tên, SĐT, CCCD, Email Liên Hệ, Ngày sinh, Địa chỉ thường trú, Biển soó xe, Loại xe dòng xe, Phòng số, Người liên hệ, Mối quan hệ, Số điện thoại khẩn
                </p>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="font-semibold text-slate-800">2. Tab tiền điện tiền nước hàng tháng (từ Dòng 7 trở đi):</div>
                <ul className="list-disc pl-4 text-slate-600 text-[11px] space-y-1">
                  <li><strong>Cột A:</strong> Số phòng (bắt đầu dòng 7)</li>
                  <li><strong>Cột B - D:</strong> Số điện cũ, mới, tiêu thụ (D = C - B)</li>
                  <li><strong>Cột E - G:</strong> Số nước cũ, mới, tiêu thụ (G = F - E)</li>
                  <li><strong>Cột H - O:</strong> Tiền điện, nước, phòng (J), rác, internet, xe, khác, cọc (O)</li>
                  <li><strong>Cột P (Tổng cộng):</strong> Trạng thái màu & Tổng tiền</li>
                  <li><strong>Cột Q - T:</strong> Họ tên, CCCD, SĐT, Biển số xe người 1</li>
                  <li><strong>Cột U - X:</strong> Họ tên, CCCD, SĐT, Biển số xe người 2</li>
                  <li><strong>Cột Y - AB:</strong> Họ tên, CCCD, SĐT, Biển số xe người 3</li>
                  <li><strong>Cột AC - AD:</strong> Tổng số người, Tổng số xe</li>
                </ul>
              </div>

              <div className="space-y-2 pt-2 border-t border-indigo-100">
                <div className="font-semibold text-slate-800 flex items-center justify-between">
                  <span>3. Tạo nút bấm trực tiếp bên trong Google Sheets (Kế bên nút Trợ giúp / Help):</span>
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    {copiedScript ? (
                      <>
                        <Check size={12} />
                        <span>Đã chép mã!</span>
                      </>
                    ) : (
                      <>
                        <span>📋 Sao chép mã Apps Script</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-slate-600 text-[11px] leading-relaxed">
                  <strong>Hướng dẫn 3 bước:</strong>
                  <br />1. Trong Google Sheets, vào menu <strong>Tiện ích mở rộng (Extensions) $\rightarrow$ Apps Script</strong>.
                  <br />2. Xóa code cũ, dán đoạn mã bên dưới và bấm nút <strong>Lưu (Save)</strong>.
                  <br />3. Tải lại (F5) Google Sheets, bạn sẽ thấy xuất hiện thêm menu <strong>🏢 Nhà Trọ Phong Lan</strong> ngay bên cạnh nút Help để chuyển dữ liệu trực tiếp bất cứ lúc nào!
                </p>

                <div className="relative group">
                  <pre className="text-[10px] font-mono bg-slate-900 text-emerald-300 p-3 rounded-xl overflow-x-auto leading-relaxed border border-slate-800 max-h-[160px] overflow-y-auto">
{appsScriptCode}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* 4. Tab selection and room targeting */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Tab Thông Tin Cư Dân</label>
              {availableTabs.length > 0 ? (
                <select
                  aria-label="Trang tính thông tin cá nhân" value={selectedProfileTab}
                  onChange={(e) => setSelectedProfileTab(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                >
                  {availableTabs.map((tab, idx) => (
                    <option key={idx} value={tab} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">{tab}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Thông tin cá nhân"
                  aria-label="Trang tính thông tin cá nhân" value={selectedProfileTab}
                  onChange={(e) => setSelectedProfileTab(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Tab Hóa Đơn Tháng</label>
              {availableTabs.length > 0 ? (
                <select
                  aria-label="Trang tính hóa đơn" value={selectedInvoiceTab}
                  onChange={(e) => setSelectedInvoiceTab(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                >
                  {availableTabs.map((tab, idx) => (
                    <option key={idx} value={tab} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">{tab}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="10/2026 hoặc T10"
                  aria-label="Trang tính hóa đơn" value={selectedInvoiceTab}
                  onChange={(e) => setSelectedInvoiceTab(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Số Phòng Đồng Bộ</label>
              <input
                type="text"
                placeholder="203"
                aria-label="Phòng cần đồng bộ" value={targetRoom}
                onChange={(e) => setTargetRoom(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-num focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
              />
            </div>
          </div>

          {/* Sync status indicator */}
          {syncStatus.message && (
            <div className={`p-3 rounded-xl flex items-center gap-2 text-xs ${
              syncStatus.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : syncStatus.type === 'error'
                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                : 'bg-slate-100 text-slate-700'
            }`}>
              {syncStatus.type === 'success' ? (
                <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle size={16} className="shrink-0 text-rose-600" />
              )}
              <span className="leading-relaxed">{syncStatus.message}</span>
            </div>
          )}

          {sheetConfig.lastSynced && (
            <div className="text-[11px] text-slate-400 text-right">
              Đồng bộ gần nhất: <span className="font-semibold text-slate-600">{sheetConfig.lastSynced}</span>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="shrink-0 p-4 sm:p-5 border-t border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeGoogleSheetModal}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleBatchSyncToSheet}
              disabled={isBatchSyncing || isSyncing}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              title="Bưng toàn bộ cư dân từ cột Q-AB của tab Tháng sang Tab Thông tin cá nhân trên Google Sheet"
            >
              <RefreshCw size={13} className={isBatchSyncing ? 'animate-spin' : ''} />
              <span>{isBatchSyncing ? 'Đang ghi vào Sheet...' : 'Bưng cư dân sang Tab Cá Nhân (Ghi vào Sheet)'}</span>
            </button>

            <button
              type="button"
              onClick={handleSyncData}
              disabled={isSyncing || isBatchSyncing}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-semibold shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? 'Đang đọc...' : 'Đồng bộ'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
