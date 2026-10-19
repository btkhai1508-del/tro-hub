import React, { useState, useRef } from 'react';
import { 
  FileText, 
  Printer, 
  ZoomIn, 
  ZoomOut, 
  Building2 
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export function Contract() {
  const { profile } = useApp();
  const [activeTab, setActiveTab] = useState<'contract' | 'ct01'>('contract');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const printRef = useRef<HTMLDivElement>(null);

  const cleanRoom = profile.room?.roomNumber
    ? (profile.room.roomNumber.startsWith('P.') ? profile.room.roomNumber : `P. ${profile.room.roomNumber}`)
    : 'P. G02';

  const contractCode = profile.contractUrl || `HĐ-${cleanRoom.replace(/[^\w]/g, '')}`;

  // Parse birth date parts
  const birthYear = profile.dob ? profile.dob.slice(-4) : '2000';
  const dobParts = profile.dob ? profile.dob.split('/') : ['15', '08', '2000'];
  const dobDay = dobParts[0] || '15';
  const dobMonth = dobParts[1] || '08';
  const dobYear = dobParts[2] || '2000';

  // 12-digit arrays for Citizen ID boxes (CT01)
  const cccdDigits = (profile.cccd || '080092013210')
    .replace(/\D/g, '')
    .padEnd(12, ' ')
    .slice(0, 12)
    .split('');
  const landlordCccdDigits = '079090001800'.split('');

  // Handle native print / export to PDF
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-5xl mx-auto pb-16 px-2 sm:px-4">
      
      {/* Top Header & Actions (Hidden on Print) */}
      <div data-tutorial="contract-header" className="print:hidden flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              ✓ Đang hiệu lực (01/06/2026 — 01/12/2028)
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">Mã: {contractCode}</span>
          </div>
          <h1 className="text-xl sm:text-2xl text-slate-900 dark:text-white mt-1.5 font-bold">
            Văn bản Pháp lý & Hợp đồng
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Mẫu văn bản hành chính khổ A4 chuẩn Times New Roman mực đen theo đúng nguyên gốc PDF.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center flex-wrap gap-2 shrink-0">
          {/* Zoom Controls */}
          <div className="hidden lg:flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.max(75, prev - 10))}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 cursor-pointer transition-colors"
              title="Thu nhỏ"
              aria-label="Thu nhỏ"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-[11px] font-mono px-2 font-semibold text-slate-700 dark:text-slate-300">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.min(125, prev + 10))}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 cursor-pointer transition-colors"
              title="Phóng to"
              aria-label="Phóng to"
            >
              <ZoomIn size={16} />
            </button>
          </div>

          {/* Print / Export to PDF */}
          <button
            type="button"
            onClick={handlePrint}
            className="primary-button text-xs py-2 px-4 flex items-center gap-1.5 shadow-sm font-semibold cursor-pointer active:scale-95"
            title="In hoặc Lưu thành file PDF"
          >
            <Printer size={14} />
            <span>In / Lưu PDF</span>
          </button>
        </div>
      </div>

      {/* Tabs Selector: Hợp đồng vs Mẫu CT01 (Hidden on Print) */}
      <div className="print:hidden flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-slate-700/80 max-w-md">
        <button
          type="button"
          onClick={() => setActiveTab('contract')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'contract'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileText size={15} />
          <span>Hợp đồng thuê phòng</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ct01')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'ct01'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Building2 size={15} />
          <span>Tờ khai cư trú (CT01)</span>
        </button>
      </div>

      {/* =========================================================================
          A4 ADMINISTRATIVE PAPER CONTAINER (TIMES NEW ROMAN & PURE BLACK #000000)
          ========================================================================= */}
      <div className="w-full overflow-x-auto flex justify-center py-2">
        <div 
          ref={printRef}
          style={{ 
            transform: `scale(${zoomLevel / 100})`, 
            transformOrigin: 'top center',
            fontFamily: '"Times New Roman", Times, Georgia, serif'
          }}
          className="contract-document-a4 transition-transform duration-150 w-full max-w-[820px] bg-white text-black shadow-[0_15px_45px_rgba(0,0,0,0.12)] border border-slate-300 rounded-none p-8 sm:p-14 md:p-16 leading-[1.45] text-[13.5px] select-text relative"
        >
          
          {/* =====================================================================
              DOCUMENT 1: HỢP ĐỒNG THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ (PDF 2)
              100% IDENTICAL TO media_1791221206183.pdf
              ===================================================================== */}
          {activeTab === 'contract' && (
            <div className="space-y-4 text-black">
              
              {/* Quốc hiệu & Tiêu ngữ */}
              <div className="text-center space-y-0.5">
                <p className="font-bold text-[14px] uppercase tracking-wider">
                  CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                </p>
                <p className="font-bold text-[14px]">
                  Độc Lập – Tự do – Hạnh Phúc
                </p>
                <div className="w-40 h-[1px] bg-black mx-auto mt-1" />
              </div>

              {/* Tên Hợp Đồng */}
              <div className="text-center pt-3 pb-1">
                <h2 className="text-[17px] font-bold uppercase tracking-wide">
                  HỢP ĐỒNG THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ
                </h2>
              </div>

              {/* Ngày tháng & Địa điểm */}
              <div className="space-y-1 text-justify">
                <p>
                  Hôm nay, ngày <span className="font-bold underline">01</span> tháng <span className="font-bold underline">06</span> năm 20<span className="font-bold underline">26</span>
                </p>
                <p>
                  Tại căn nhà số: <span className="font-bold">Nhà Trọ Phong Lan</span> Đường <span className="font-bold">Lê Văn Chí</span>, Khu phố <span className="font-bold">3</span>, phường <span className="font-bold">Linh Chiểu</span>, TP. Hồ Chí Minh
                </p>
              </div>

              {/* I/ BÊN CHO THUÊ (BÊN A) */}
              <div className="space-y-1 pt-1 text-justify">
                <p className="font-bold uppercase">
                  I/ BÊN CHO THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên A):
                </p>
                <p>
                  1. Ông/bà: <span className="font-bold">BÙI TRUNG KHẢI</span>, Sinh năm: <span className="font-bold">1990</span>, Số CCCD: <span className="font-bold">079090001800</span>
                </p>
                <p>
                  Nơi đăng ký thường trú: <span className="font-bold">Số 123</span> Đường <span className="font-bold">Kha Vạn Cân</span>, Khu phố <span className="font-bold">2</span>, Phường <span className="font-bold">Linh Chiểu</span>, Tỉnh (TP): <span className="font-bold">TP. Hồ Chí Minh</span>
                </p>
                <p>
                  2. Ông/bà: ......................................., Sinh năm: ............., Số CCCD: ................................
                </p>
                <p>
                  Nơi đăng ký thường trú: ...................... Đường ..................., Khu phố ............., Phường ...................., Tỉnh (TP): .........................................................................
                </p>
                <p>
                  Là chủ sở hữu căn nhà tại địa chỉ số: <span className="font-bold">Nhà Trọ Phong Lan</span> Đường <span className="font-bold">Lê Văn Chí</span>, Khu phố <span className="font-bold">3</span>, Phường <span className="font-bold">Linh Chiểu</span>, TP. Hồ Chí Minh.
                </p>
              </div>

              {/* II/ BÊN THUÊ (BÊN B) */}
              <div className="space-y-1 pt-1 text-justify">
                <p className="font-bold uppercase">
                  II/ BÊN THUÊ/MƯỢN/Ở NHỜ NHÀ, PHÒNG TRỌ: (Gọi tắt là bên B):
                </p>
                <p>
                  1. Ông/bà: <span className="font-bold uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</span> Sinh năm: <span className="font-bold">{birthYear}</span> Số CCCD/ĐDCN: <span className="font-bold">{profile.cccd || '080092013210'}</span>
                </p>
                <p>
                  Nơi đăng ký thường trú: <span className="font-bold">{profile.address || 'Xã Long Hựu Đông, Huyện Cần Đước, Tỉnh Long An'}</span>
                </p>
                <p>
                  2. Ông/bà:     .............................. Sinh năm:  ........  Số CCCD/ĐDCN: .............................
                </p>
                <p>
                  Nơi đăng ký thường trú: .....................................................................................................
                </p>
                <p>
                  3. Ông/bà:     .............................. Sinh năm:  ........  Số CCCD/ĐDCN: .............................
                </p>
                <p>
                  Nơi đăng ký thường trú: .....................................................................................................
                </p>
                <p>
                  4. Ông/bà:     .............................. Sinh năm:  ........  Số CCCD/ĐDCN: .............................
                </p>
                <p>
                  Nơi đăng ký thường trú: .....................................................................................................
                </p>
                <p>
                  5. Ông/bà:     .............................. Sinh năm:  ........  Số CCCD/ĐDCN: .............................
                </p>
                <p>
                  Nơi đăng ký thường trú: .....................................................................................................
                </p>
              </div>

              {/* THỎA THUẬN */}
              <div className="space-y-2 pt-1 text-justify">
                <p className="font-bold text-center">
                  Sau khi thỏa thuận, hai bên thống nhất như sau:
                </p>
                <p>
                  Bên A đồng ý cho bên B được thuê/mượn/ở nhờ nhà, phòng trọ số <span className="font-bold underline">{cleanRoom}</span> tại căn nhà số nhà <span className="font-bold">Nhà Trọ Phong Lan</span> Đường <span className="font-bold">Lê Văn Chí</span>, Khu phố <span className="font-bold">3</span>, Phường <span className="font-bold">Linh Chiểu</span>, TP. Hồ Chí Minh
                </p>
                <p>
                  Thời hạn thuê (mượn, ở nhờ nhà): <span className="font-bold">30 tháng</span> kể từ ngày ký họp đồng
                </p>
                <p>
                  Bên B chỉ được quyền ở và đăng ký tạm trú vào địa chỉ nhà bên A, bên B không được tranh chấp nhà, yêu cầu gì về tài sản của bên A.
                </p>
                <p>
                  Hợp đồng này được lập thành 02 bản có giá trị như nhau mỗi bên giữ 01 bản./.
                </p>
              </div>

              {/* CHỮ KÝ 2 BÊN */}
              <div className="pt-8 pb-4 grid grid-cols-2 gap-8 text-center">
                <div className="space-y-1">
                  <p className="font-bold uppercase text-[13px]">
                    BÊN CHO/MƯỢN/Ở NHỜ<br />NHÀ/PHÒNG TRỌ
                  </p>
                  <p className="italic text-[12px]">(Ký tên, ghi rõ họ tên)</p>
                  <div className="pt-10 pb-2">
                    <p className="italic font-bold text-[14px]">(Đã ký xác nhận)</p>
                    <p className="font-bold text-[15px] mt-2">Bùi Trung Khải</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="font-bold uppercase text-[13px]">
                    BÊN THUÊ/MƯỢN/Ở NHỜ<br />NHÀ/PHÒNG TRỌ
                  </p>
                  <p className="italic text-[12px]">(Ký tên, ghi rõ họ tên)</p>
                  <div className="pt-10 pb-2">
                    <p className="italic font-bold text-[14px]">(Đã ký xác nhận)</p>
                    <p className="font-bold text-[15px] mt-2 uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</p>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* =====================================================================
              DOCUMENT 2: TỜ KHAI THAY ĐỔI THÔNG TIN CƯ TRÚ (MẪU CT01 - BCA)
              100% IDENTICAL TO media_1791221206177.pdf
              ===================================================================== */}
          {activeTab === 'ct01' && (
            <div className="space-y-3.5 text-black">
              
              {/* Header Trích yếu Bộ Công An */}
              <div className="text-[12px] italic text-black leading-tight">
                <p>Mẫu CT01 ban hành kèm theo Thông tư số 53/2025/TT-BCA</p>
                <p>ngày 01/7/2025 của Bộ trưởng Bộ Công an</p>
              </div>

              {/* Quốc hiệu & Tiêu ngữ */}
              <div className="text-center space-y-0.5 pt-1">
                <p className="font-bold text-[14px] uppercase tracking-wider">
                  CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                </p>
                <p className="font-bold text-[14px]">
                  Độc lập – Tự do – Hạnh phúc
                </p>
                <div className="w-36 h-[1px] bg-black mx-auto mt-1" />
              </div>

              {/* Tiêu đề biểu mẫu */}
              <div className="text-center pt-2 pb-1 space-y-1">
                <h2 className="text-[17px] font-bold uppercase tracking-wide">
                  TỜ KHAI THAY ĐỔI THÔNG TIN CƯ TRÚ
                </h2>
                <p className="text-[13px]">
                  Kính gửi<sup>(1)</sup>: <span className="font-semibold underline">Công an Phường Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh</span>
                </p>
              </div>

              {/* Mục 1: Họ tên */}
              <div className="flex items-baseline gap-1 text-[13.5px]">
                <span className="shrink-0">1. Họ, chữ đệm và tên khai sinh:</span>
                <span className="font-bold uppercase tracking-wide border-b border-dotted border-black flex-1 pl-1">
                  {profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}
                </span>
              </div>

              {/* Mục 2 & 3: Ngày sinh & Giới tính */}
              <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
                <div className="flex items-baseline gap-1 flex-1">
                  <span className="shrink-0">2. Ngày, tháng, năm sinh:</span>
                  <span className="border-b border-dotted border-black flex-1 text-center font-semibold">
                    {dobDay} / {dobMonth} / {dobYear}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 w-44">
                  <span className="shrink-0">3. Giới tính:</span>
                  <span className="border-b border-dotted border-black flex-1 text-center font-semibold">
                    Nam
                  </span>
                </div>
              </div>

              {/* Mục 4: Số định danh cá nhân - 12 ô vuông chuẩn mẫu CT01 */}
              <div className="flex items-center gap-2 pt-0.5 text-[13.5px]">
                <span className="shrink-0">4. Số định danh cá nhân:</span>
                <div className="flex items-center gap-1 font-mono font-bold text-[14px]">
                  {cccdDigits.map((digit, idx) => (
                    <div 
                      key={idx}
                      className="w-6 h-7 border border-black flex items-center justify-center bg-white text-black font-bold"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
              </div>

              {/* Mục 5 & 6: SĐT & Email */}
              <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
                <div className="flex items-baseline gap-1 flex-1">
                  <span className="shrink-0">5. Số điện thoại liên hệ:</span>
                  <span className="border-b border-dotted border-black flex-1 pl-1 font-semibold">
                    {profile.phone || '0348667694'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 flex-1">
                  <span className="shrink-0">6. Email:</span>
                  <span className="border-b border-dotted border-black flex-1 pl-1 font-semibold">
                    {profile.email || 'resident@ecostay.vn'}
                  </span>
                </div>
              </div>

              {/* Mục 7 & 8: Tên chủ hộ & Quan hệ */}
              <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
                <div className="flex items-baseline gap-1 flex-1">
                  <span className="shrink-0">7. Họ, chữ đệm và tên chủ hộ:</span>
                  <span className="border-b border-dotted border-black flex-1 pl-1 font-bold">
                    BÙI TRUNG KHẢI
                  </span>
                </div>
                <div className="flex items-baseline gap-1 flex-1">
                  <span className="shrink-0">8. Mối quan hệ với chủ hộ:</span>
                  <span className="border-b border-dotted border-black flex-1 pl-1 font-semibold">
                    Người thuê trọ
                  </span>
                </div>
              </div>

              {/* Mục 9: Số định danh cá nhân của chủ hộ - 12 ô vuông */}
              <div className="flex items-center gap-2 pt-0.5 text-[13.5px]">
                <span className="shrink-0">9. Số định danh cá nhân của chủ hộ:</span>
                <div className="flex items-center gap-1 font-mono font-bold text-[14px]">
                  {landlordCccdDigits.map((digit, idx) => (
                    <div 
                      key={idx}
                      className="w-6 h-7 border border-black flex items-center justify-center bg-white text-black font-bold"
                    >
                      {digit}
                    </div>
                  ))}
                </div>
              </div>

              {/* Mục 10: Nội dung đề nghị */}
              <div className="space-y-1 text-[13.5px]">
                <p>10. Nội dung đề nghị<sup>(2)</sup>:</p>
                <p className="border-b border-dotted border-black pl-4 font-semibold text-justify">
                  Đăng ký tạm trú cho công dân tại địa chỉ: Phòng trọ số {cleanRoom}, Nhà Trọ Phong Lan, Đường Lê Văn Chí, Khu phố 3, Phường Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh.
                </p>
                <div className="border-b border-dotted border-black w-full h-4" />
              </div>

              {/* Mục 11: Bảng thành viên cùng thay đổi */}
              <div className="space-y-1.5 pt-1">
                <p className="text-[13.5px]">11. Những thành viên trong hộ gia đình cùng thay đổi:</p>
                
                <div className="w-full">
                  <table className="w-full border-collapse border border-black text-center text-[12px]">
                    <thead>
                      <tr className="font-bold border-b border-black">
                        <th className="border border-black p-1 w-10">TT</th>
                        <th className="border border-black p-1">Họ, chữ đệm và tên</th>
                        <th className="border border-black p-1 w-24">Ngày, tháng, năm sinh</th>
                        <th className="border border-black p-1 w-16">Giới tính</th>
                        <th className="border border-black p-1 w-32">Số định danh cá nhân</th>
                        <th className="border border-black p-1 w-28">Mối quan hệ với chủ hộ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-black p-1.5 font-bold">1</td>
                        <td className="border border-black p-1.5 font-bold uppercase">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</td>
                        <td className="border border-black p-1.5">{dobDay}/{dobMonth}/{dobYear}</td>
                        <td className="border border-black p-1.5">Nam</td>
                        <td className="border border-black p-1.5 font-mono font-bold">{profile.cccd || '080092013210'}</td>
                        <td className="border border-black p-1.5">Người thuê trọ</td>
                      </tr>
                      <tr>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                      </tr>
                      <tr>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                        <td className="border border-black p-1.5">&nbsp;</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 4 Cột Ý kiến & Chữ ký chuẩn CT01 */}
              <div className="pt-4 pb-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11px] sm:text-[11.5px] leading-tight">
                  
                  {/* Cột 1 */}
                  <div className="space-y-1">
                    <p className="italic">.....,ngày...tháng...năm...</p>
                    <p className="font-bold uppercase">Ý KIẾN CỦA CHỦ HỘ<sup>(3)</sup></p>
                    <p className="italic text-[10px]">(Ký, ghi rõ họ tên)</p>
                    <div className="pt-8">
                      <p className="italic font-bold text-[11px]">(Đã ký)</p>
                      <p className="font-bold mt-1 text-[12px]">Bùi Trung Khải</p>
                    </div>
                  </div>

                  {/* Cột 2 */}
                  <div className="space-y-1">
                    <p className="italic">.....,ngày...tháng...năm...</p>
                    <p className="font-bold uppercase">Ý KIẾN CỦA CHỦ SỞ HỮU CHỖ Ở HỢP PHÁP<sup>(4)</sup></p>
                    <p className="italic text-[10px]">(Ký, ghi rõ họ tên)</p>
                    <div className="pt-8">
                      <p className="italic font-bold text-[11px]">(Đã ký)</p>
                      <p className="font-bold mt-1 text-[12px]">Bùi Trung Khải</p>
                    </div>
                  </div>

                  {/* Cột 3 */}
                  <div className="space-y-1">
                    <p className="italic">.....,ngày...tháng...năm...</p>
                    <p className="font-bold uppercase">Ý KIẾN CỦA CHA HOẶC MẸ HOẶC NGƯỜI GIÁM HỘ<sup>(5)</sup></p>
                    <p className="italic text-[10px]">(Ký, ghi rõ họ tên)</p>
                    <div className="pt-8">
                      <p className="italic text-[11px]">--</p>
                    </div>
                  </div>

                  {/* Cột 4 */}
                  <div className="space-y-1">
                    <p className="italic">.....,ngày...tháng...năm...</p>
                    <p className="font-bold uppercase">NGƯỜI KÊ KHAI<sup>(6)</sup></p>
                    <p className="italic text-[10px]">(Ký, ghi rõ họ tên)</p>
                    <div className="pt-8">
                      <p className="italic font-bold text-[11px]">(Đã ký)</p>
                      <p className="font-bold mt-1 uppercase text-[12px]">{profile.name || 'TRƯƠNG ĐÌNH TRƯỜNG AN'}</p>
                    </div>
                  </div>

                </div>
              </div>

              {/* Trang 2: Chú thích (7) chuẩn theo file PDF 1 */}
              <div className="border-t border-black pt-3 text-[11.5px] space-y-1.5">
                <p className="font-bold uppercase">(7) Thông tin bổ sung xác nhận chỗ ở hợp pháp:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-2">
                  <div>
                    <p>(7) Họ và tên: <span className="font-bold">Bùi Trung Khải</span></p>
                    <p>(7) Số định danh cá nhân: <span className="font-mono font-bold">079090001800</span></p>
                  </div>
                  <div>
                    <p>(7) Họ và tên: <span className="font-bold uppercase">{profile.name}</span></p>
                    <p>(7) Số định danh cá nhân: <span className="font-mono font-bold">{profile.cccd}</span></p>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>

    </div>
  );
}
