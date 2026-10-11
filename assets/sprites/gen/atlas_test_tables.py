from functools import lru_cache
import json,re
from pathlib import Path

from coverage_payload import decompress, restore

ROOT=Path(__file__).resolve().parents[3]
COVERAGE_TABLES=('BED_COVERAGE','COVERAGE_RECORDS','COVERAGE_VALUES','SPRITE_PAIR_MASKS','SEATING_MASKS','SHELF_COVERAGE','BATHROOM_MASKS')

@lru_cache(maxsize=None)
def coverage_bytes(file_name):
    """The decompressed coverage payload that coverage-file.ts names."""
    return decompress((ROOT/'web'/'public'/file_name).read_bytes())

def coverage_file_name():
    source=(ROOT/'web'/'src'/'render'/'coverage-file.ts').read_text()
    match=re.search(r"^export const COVERAGE_FILE_NAME = '([^']*)';",source,re.M)
    if match is None:raise ValueError('Missing COVERAGE_FILE_NAME')
    return match.group(1)

def with_values(value):
    """Coverage records as the generator built them, `values` included."""
    payload=coverage_bytes(coverage_file_name())
    if isinstance(value,dict):return {key:restore(record,payload) for key,record in value.items()}
    return [restore(record,payload) for record in value]

@lru_cache(maxsize=None)
def table(source,name):
    match=re.search(r'^(?:export )?const '+re.escape(name)+r'\b[^\n]*?=\s*',source,re.M)
    if match is None:raise ValueError('Missing table: '+name)
    body=source[match.end():]
    body=re.sub(r'(?m)^(\s*)(\d+):',r'\1"\2":',body)
    body=re.sub(r',\s*([}\]])',r'\1',body)
    value,end=json.JSONDecoder().raw_decode(body)
    # Historical sources name the shared pool COVERAGE_VALUES.
    mapped=re.match(r'\s*\.map\(index => (\w+)\[index\]!\)',body[end:])
    if name=='BED_COVERAGE' and mapped:
        pool=table(source,mapped.group(1))
        return [pool[index] for index in value]
    if name in COVERAGE_TABLES:value=with_values(value)
    return value
