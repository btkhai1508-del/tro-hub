import { fetchSheetXlsx, parseSheetXmlRows, getMonthList } from './src/server/adminService';

(async () => {
  const months = await getMonthList();
  console.log('MONTHS', months);
  const zip = await fetchSheetXlsx();
  if (!zip) { console.log('no zip'); return; }
  const wb = zip.readAsText('xl/workbook.xml');
  console.log('SHEETS', (wb.match(/name="([^"]+)"/g) || []).join(' | '));
  const target = process.argv[2] || months[months.length - 1];
  const { rows } = await parseSheetXmlRows(zip, target);
  for (const r of rows.slice(0, 60)) {
    const cells = Object.entries(r.cells)
      .filter(([k]) => /^(A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|S)$/.test(k))
      .map(([k, v]: any) => `${k}=${v.value}`)
      .join(' ');
    if (cells) console.log(r.rowNumber, cells);
  }
})();
