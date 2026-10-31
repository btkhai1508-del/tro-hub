/** Landlord and address of each boarding house, split into the blanks of the legal forms. */
export type HouseKey = 'TRUNG_KIM' | 'LVC';

export interface HouseInfo {
  key: HouseKey;
  name: string;
  abbreviation: string;
  address: string;
  houseNumber: string;
  street: string;
  quarter: string;
  ward: string;
  landlord: string;
  landlordDob: string;
  landlordCccd: string;
  landlordPhone: string;
}

export const HOUSES: Record<HouseKey, HouseInfo> = {
  TRUNG_KIM: {
    key: 'TRUNG_KIM',
    name: 'NHÀ TRỌ TRUNG KIM',
    abbreviation: 'NTTK',
    address: '116/32 Đường 17, Khu phố 1, Phường Linh Xuân, TP. Hồ Chí Minh',
    houseNumber: '116/32',
    street: '17',
    quarter: '1',
    ward: 'Linh Xuân',
    landlord: 'Lương Thị Kim Phượng',
    landlordDob: '18/10/1973',
    landlordCccd: '024073000292',
    landlordPhone: '0903616569',
  },
  LVC: {
    key: 'LVC',
    name: 'NHÀ TRỌ 109/6',
    abbreviation: 'NT1096',
    address: '109/6 Lê Văn Chí, Khu phố 41, Phường Linh Xuân, TP. Hồ Chí Minh',
    houseNumber: '109/6',
    street: 'Lê Văn Chí',
    quarter: '41',
    ward: 'Linh Xuân',
    landlord: 'Bùi Trung Khải',
    landlordDob: '15/08/2005',
    landlordCccd: '079205019765',
    landlordPhone: '0902371800',
  },
};

export function houseFromRoom(room?: string): HouseInfo {
  return String(room || '').toUpperCase().includes('LVC') ? HOUSES.LVC : HOUSES.TRUNG_KIM;
}
