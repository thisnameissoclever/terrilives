from functools import lru_cache
import json,re

@lru_cache(maxsize=None)
def table(source,name):
    match=re.search(r'^(?:export )?const '+re.escape(name)+r'\b[^\n]*?=\s*',source,re.M)
    if match is None:raise ValueError('Missing table: '+name)
    body=source[match.end():]
    body=re.sub(r'(?m)^(\s*)(\d+):',r'\1"\2":',body)
    body=re.sub(r',\s*([}\]])',r'\1',body)
    value,end=json.JSONDecoder().raw_decode(body)
    if name=='BED_COVERAGE' and re.match(r'\s*\.map\(',body[end:]):
        pool=table(source,'COVERAGE_VALUES')
        value=[pool[index] for index in value]
    return value
