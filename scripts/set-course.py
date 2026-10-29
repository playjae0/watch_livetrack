"""Import one GPX track to the linked project's private course for the local device."""
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/set-course.py /path/to/course.gpx')
path = Path(sys.argv[1])
if path.stat().st_size > 5_000_000:
    raise SystemExit('GPX file exceeds 5 MB')
root = ET.parse(path).getroot()
ns = {'g': 'http://www.topografix.com/GPX/1/1'}
segments = []
for segment in root.findall('.//g:trkseg', ns):
    points = []
    for point in segment.findall('g:trkpt', ns):
        lat, lon = float(point.attrib['lat']), float(point.attrib['lon'])
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise SystemExit('GPX has an invalid coordinate')
        points.append([round(lat, 6), round(lon, 6)])
    if len(points) > 1:
        segments.append(points)
if not segments or sum(map(len, segments)) > 100_000:
    raise SystemExit('GPX track is empty or exceeds 100,000 points')
name_element = root.find('.//g:trk/g:name', ns)
name = (name_element.text or 'Planned course').strip() if name_element is not None else 'Planned course'
setup = (Path.home()/'.config/marathon-livetrack/device-setup.txt').read_text()
match = re.search(r'기기 ID:\s*([a-f0-9-]{36})', setup, re.I)
if not match:
    raise SystemExit('Device ID missing from local setup file')
data = json.dumps({'name': name[:120], 'segments': segments}, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
query = f"insert into public.courses(device_id,course) values ('{match.group(1)}','{data}'::jsonb) on conflict(device_id) do update set course=excluded.course,updated_at=now();"
fd, temp = tempfile.mkstemp(prefix='course-import-', suffix='.sql')
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(query)
    result = subprocess.run(['npx', '--yes', 'supabase', 'db', 'query', '--linked', '--file', temp], capture_output=True)
    if result.returncode:
        raise SystemExit('Course import failed; check Supabase login and linked project.')
finally:
    os.unlink(temp)
print(f'Course imported: {sum(map(len, segments))} points. Coordinates are not logged.')
