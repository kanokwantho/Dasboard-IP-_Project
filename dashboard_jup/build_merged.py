#!/usr/bin/env python3
"""
build_merged.py
รวมข้อมูล ipd_dashboard_data.json + จำนวนเตียง.xlsx + hosp_moph_top150.json
ผลลัพธ์: ipd_dashboard_merged.json (925 รพ.)
"""
import json, openpyxl, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))

def load_json(fname):
    with open(os.path.join(BASE, fname), encoding='utf-8') as f:
        return json.load(f)

def load_excel(fname):
    wb = openpyxl.load_workbook(os.path.join(BASE, fname))
    return wb.active

# Zone mapping tables
ZONE_NAME = {
    1: 'เขต 1 เชียงใหม่', 2: 'เขต 2 พิษณุโลก', 3: 'เขต 3 นครสวรรค์',
    4: 'เขต 4 สระบุรี',   5: 'เขต 5 ราชบุรี',  6: 'เขต 6 ระยอง',
    7: 'เขต 7 ขอนแก่น',  8: 'เขต 8 อุดรธานี', 9: 'เขต 9 นครราชสีมา',
    10:'เขต 10 อุบลราชธานี', 11:'เขต 11 สุราษฎร์ธานี',
    12:'เขต 12 สงขลา',   13:'เขต 13 กรุงเทพมหานคร'
}
ZONE_ID   = {i: f'zone_{i}' for i in range(1, 14)}
REGION    = {1:'north',2:'north',3:'north',4:'central',5:'central',6:'central',
             7:'northeast',8:'northeast',9:'northeast',10:'northeast',
             11:'south',12:'south',13:'central'}

def main():
    print("Loading source files...")
    ipd  = load_json('ipd_dashboard_data.json')
    moph = load_json('hosp_moph_top150.json')
    xlsx_file = next(f for f in os.listdir(BASE) if f.endswith('.xlsx'))
    ws   = load_excel(xlsx_file)

    # --- Build lookup tables ---
    ipd_lookup  = {str(h['hcode']): h for h in ipd['hospitals']}
    moph_lookup = moph  # keyed by hcode string

    # --- Process Excel rows (base: 895 รพ.) ---
    merged = []
    seen   = set()

    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[2]:
            continue
        try:
            hcode = str(int(row[2]))
        except (ValueError, TypeError):
            hcode = str(row[2]).strip()
        if hcode in seen:
            continue
        seen.add(hcode)

        ez = int(row[0]) if row[0] else 0

        h = {
            # ---- Excel fields ----
            'hcode':            hcode,
            'hname':            str(row[3]) if row[3] else '',
            'excel_tier':       str(row[4]).strip() if row[4] else '',
            'tier':             str(row[4]).strip() if row[4] else '',
            'excel_zone':       ez,
            'zone':             ZONE_ID.get(ez, ''),
            'zone_name':        ZONE_NAME.get(ez, ''),
            'region':           REGION.get(ez, ''),
            'prov_th':          str(row[1]) if row[1] else '',
            'excel_province':   str(row[1]) if row[1] else '',
            'prov_en':          '',
            'prov_id':          '',
            'lat':              0.0,
            'lng':              0.0,
            'excel_beds':       int(row[5])    if row[5]  else 0,
            'beds':             int(row[5])    if row[5]  else 0,
            'excel_admit':      int(row[7])    if row[7]  else 0,
            'excel_patient_days': int(row[9]) if row[9]  else 0,
            'excel_bor':        float(row[10]) if row[10] else 0.0,
            'excel_cmi':        float(row[12]) if row[12] else 0.0,
            'excel_score':      float(row[15]) if row[15] else 0.0,
            # ---- IPD fields (will be filled below if available) ----
            'beds_ipd':         0,
            'occupied_beds':    0,
            'bor':              float(row[10]) if row[10] else 0.0,
            'status':           '',
            'status_th':        '',
            'status_color':     '',
            'total_services':   0,
            'monthly_avg':      0,
            'current_monthly':  0,
            'source':           'excel',
        }

        # Enrich from IPD dashboard (300 รพ. ใหญ่)
        if hcode in ipd_lookup:
            ip = ipd_lookup[hcode]
            h.update({
                'hname':           ip.get('hname', h['hname']),
                'prov_th':         ip.get('prov_th', h['prov_th']),
                'prov_en':         ip.get('prov_en', ''),
                'prov_id':         ip.get('prov_id', ''),
                'lat':             ip.get('lat', 0.0),
                'lng':             ip.get('lng', 0.0),
                'beds_ipd':        ip.get('beds', 0),
                'occupied_beds':   ip.get('occupied_beds', 0),
                'bor':             ip.get('bor', h['excel_bor']),
                'status':          ip.get('status', ''),
                'status_th':       ip.get('status_th', ''),
                'status_color':    ip.get('status_color', ''),
                'total_services':  ip.get('total_services', 0),
                'monthly_avg':     ip.get('monthly_avg', 0),
                'current_monthly': ip.get('current_monthly', 0),
                'source':          'excel+ipd',
            })

        # Enrich lat/lng from moph if still missing
        if (not h['lat'] or not h['lng']) and hcode in moph_lookup:
            m = moph_lookup[hcode]
            h['lat'] = m.get('lat', 0.0)
            h['lng'] = m.get('lng', 0.0)
            if not h['hname']:
                h['hname'] = m.get('name', '')

        # Compute BOR status label from excel_bor
        bor = h['excel_bor']
        if bor > 100:
            h.setdefault('status', 'CRITICAL_OVERLOAD')
            h.setdefault('status_th', 'วิกฤต')
            h.setdefault('status_color', '#ef4444')
        elif bor > 90:
            h.setdefault('status', 'NEAR_CAPACITY')
            h.setdefault('status_th', 'ใกล้เต็ม')
            h.setdefault('status_color', '#f97316')
        elif bor > 0:
            h.setdefault('status', 'AVAILABLE_CAPACITY')
            h.setdefault('status_th', 'รองรับได้')
            h.setdefault('status_color', '#10b981')

        merged.append(h)

    # --- Add IPD-only hospitals (ไม่มีใน Excel) ---
    for ip in ipd['hospitals']:
        hcode = str(ip['hcode'])
        if hcode in seen:
            continue
        seen.add(hcode)
        h = dict(ip)
        h['source']          = 'ipd_only'
        h['excel_tier']      = ''
        h['excel_beds']      = 0
        h['excel_bor']       = 0.0
        h['excel_cmi']       = 0.0
        h['excel_admit']     = 0
        h['excel_patient_days'] = 0
        h['excel_score']     = 0.0
        h['excel_zone']      = 0
        h['excel_province']  = ip.get('prov_th', '')
        h['beds_ipd']        = ip.get('beds', 0)
        # moph coords fallback
        if (not h.get('lat') or not h.get('lng')) and hcode in moph_lookup:
            m = moph_lookup[hcode]
            h['lat'] = m.get('lat', 0.0)
            h['lng'] = m.get('lng', 0.0)
        merged.append(h)

    # --- Summary ---
    from collections import Counter
    src_count = Counter(h['source'] for h in merged)
    with_coords = sum(1 for h in merged if h.get('lat') and h.get('lng'))
    with_bor    = sum(1 for h in merged if h.get('excel_bor', 0) > 0)
    crit        = sum(1 for h in merged if h.get('excel_bor', 0) > 100)

    print(f"Total merged hospitals : {len(merged)}")
    print(f"  excel+ipd            : {src_count['excel+ipd']}")
    print(f"  excel only           : {src_count['excel']}")
    print(f"  ipd only             : {src_count['ipd_only']}")
    print(f"With coordinates       : {with_coords}")
    print(f"With BOR (excel)       : {with_bor}")
    print(f"BOR > 100%  (critical) : {crit}")

    # --- Save ---
    ipd['hospitals'] = merged
    ipd['metadata']['total_hospitals_merged'] = len(merged)
    ipd['metadata']['merge_sources'] = {
        'excel_file': xlsx_file,
        'ipd_file': 'ipd_dashboard_data.json',
        'moph_file': 'hosp_moph_top150.json',
    }

    out_path = os.path.join(BASE, 'ipd_dashboard_merged.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(ipd, f, ensure_ascii=False, separators=(',', ':'))

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"Saved: ipd_dashboard_merged.json ({size_mb:.1f} MB)")

if __name__ == '__main__':
    main()
